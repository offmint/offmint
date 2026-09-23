// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";

import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {IStockToken} from "./interfaces/IStockToken.sol";
import {ISessionClock} from "./interfaces/ISessionClock.sol";
import {RangeMath} from "./libraries/RangeMath.sol";

/// @title OffmintVault
/// @notice Weekend float vault for one Robinhood Chain stock token.
///         Mon–Fri: holders deposit STOCK (ERC-4626). When minting closes for the weekend, `arm` posts a one-sided
///         Uniswap v4 range order of part of the STOCK above the last Chainlink price (+ premium). If a weekend supply
///         crunch pushes the pool into the band, the vault sells at a premium. `lock` pulls the position before the
///         Monday reopen so fills are not reversed by the mint-driven sell-off, and `settle` buys the STOCK back
///         once the oracle is fresh, capped at feed * (1 + slippage).
/// @dev Talks to the PoolManager directly through unlock/unlockCallback (the chain's UniversalRouter uses a
///      non-standard swap struct). Time is block.timestamp only. No arbitrary calls; no path moves assets to the
///      owner or keeper. The only outbound transfers are ERC-4626 redemptions, `redeemMixed`, and the performance
///      fee to the immutable `feeRecipient`.
contract OffmintVault is ERC4626, Ownable2Step, ReentrancyGuardTransient, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    // ------------------------------------------------------------------ types

    enum State {
        OPEN,
        ARMED,
        PENDING_BUYBACK,
        OPEN_MIXED
    }

    enum Action {
        ARM,
        LOCK,
        SETTLE,
        RETRY,
        UNWIND
    }

    /// @dev Position identifiers passed through unlock().
    struct Pos {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bytes32 salt;
    }

    struct Params {
        uint16 defaultPremiumBps;
        uint16 defaultWidthBps;
        uint16 defaultDeployBps;
        uint16 buybackSlippageBps;
        uint16 perfFeeBps;
        uint32 armDelay;
        uint32 minFrozen;
        uint32 maxPreCloseAge;
        uint32 settleDelay;
        uint32 maxFreshAge;
        uint32 armGrace;
        uint32 settleGrace;
    }

    struct Epoch {
        uint64 id;
        uint64 armedAt;
        uint64 windowEnd;
        uint64 settledAt; // settle / emergencyUnwind time; starts the retry window
        uint256 p0; // feed answer at arm
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bytes32 salt;
        bool locked; // position already removed (lock / settle / unwind)
        uint256 stockBefore; // vault STOCK before arm (incl. undeployed)
        uint256 stockDeployed;
        uint256 stockBack; // STOCK returned from the position (incl. fees)
        uint256 usdgReceived; // USDG returned from the position (fills + fees)
        uint256 stockBought; // from buyback(s)
        uint256 usdgLeft;
        int256 pnlStock; // stockAfter - stockBefore, before fee
        uint256 feeStock;
    }

    // ------------------------------------------------------------------ constants

    uint256 internal constant BPS = 10_000;
    uint256 public constant SEQ_GRACE = 3600;
    uint256 public constant RETRY_WINDOW = 48 hours;
    uint256 public constant EMERGENCY_DELAY = 96 hours;
    /// @notice Anyone may `lock` from this long before the Monday reopen.
    uint256 public constant LOCK_LEAD = 15 minutes;
    /// @notice USDG left below this (raw units) counts as fully bought back; it rolls into the next buyback.
    uint256 public constant USDG_DUST = 100;

    // ------------------------------------------------------------------ immutables

    IPoolManager public immutable poolManager;
    ISessionClock public immutable clock;
    AggregatorV3Interface public immutable feed;
    /// @notice L2 sequencer uptime feed; address(0) disables the check (none is listed for Robinhood Chain yet).
    AggregatorV3Interface public immutable sequencerFeed;
    IERC20 public immutable usdg;
    address public immutable feeRecipient;
    bool public immutable stockIsCurrency0;
    uint8 internal immutable _feedDecimals;
    uint8 internal immutable _stockDecimals;
    uint8 internal immutable _usdDecimals;

    // ------------------------------------------------------------------ storage

    PoolKey internal _poolKey;
    Params public params;
    address public keeper;
    bool public depositsPaused;
    State public state;
    uint256 public epochCount;
    mapping(uint256 => Epoch) internal _epochs;

    // ------------------------------------------------------------------ events / errors

    event Armed(
        uint256 indexed id, uint256 p0, int24 tickLower, int24 tickUpper, uint256 stockDeployed, uint128 liquidity
    );
    event Locked(uint256 indexed id, uint256 stockBack, uint256 usdgReceived);
    event Settled(
        uint256 indexed id,
        uint256 stockBack,
        uint256 usdgReceived,
        uint256 stockBought,
        uint256 usdgLeft,
        int256 pnlStock,
        uint256 feeStock
    );
    event BuybackRetried(uint256 indexed id, uint256 stockBought, uint256 usdgLeft);
    event EmergencyUnwound(uint256 indexed id);
    event BuybackExpired(uint256 indexed id);
    event MixedRedeemed(address indexed owner, address indexed to, uint256 shares, uint256 stockOut, uint256 usdgOut);
    event ParamsUpdated(Params p);
    event KeeperUpdated(address keeper);
    event DepositsPaused(bool paused);

    error WrongState();
    error NotWindow();
    error TooEarly();
    error OracleStale();
    error OracleNotFrozen();
    error OraclePaused();
    error SequencerDown();
    error ParamOutOfBounds();
    error NotKeeper();
    error RangeInvalid();
    error NotSingleSided();
    error SlippageMinOut();
    error OnlyPoolManager();
    error BadConfig();

    // ------------------------------------------------------------------ constructor

    struct Config {
        IPoolManager poolManager;
        ISessionClock clock;
        AggregatorV3Interface feed;
        AggregatorV3Interface sequencerFeed;
        IERC20 stock;
        IERC20 usdg;
        PoolKey poolKey;
        address owner;
        address keeper;
        address feeRecipient;
        string ticker;
    }

    constructor(Config memory c)
        ERC4626(c.stock)
        ERC20(string.concat("Offmint ", c.ticker), string.concat("om", c.ticker))
        Ownable(c.owner)
    {
        address s = address(c.stock);
        address u = address(c.usdg);
        address c0 = Currency.unwrap(c.poolKey.currency0);
        address c1 = Currency.unwrap(c.poolKey.currency1);
        bool s0 = c0 == s && c1 == u;
        if (!s0 && !(c0 == u && c1 == s)) revert BadConfig();
        // hook-free pools only: a hook could block addLiquidity or skim the position
        if (address(c.poolKey.hooks) != address(0)) revert BadConfig();
        if (
            c.keeper == address(0) || c.feeRecipient == address(0) || c.feeRecipient == c.owner
                || c.feeRecipient == c.keeper
        ) {
            revert BadConfig();
        }

        poolManager = c.poolManager;
        clock = c.clock;
        feed = c.feed;
        sequencerFeed = c.sequencerFeed;
        usdg = c.usdg;
        feeRecipient = c.feeRecipient;
        stockIsCurrency0 = s0;
        _feedDecimals = c.feed.decimals();
        _stockDecimals = IERC20Metadata(s).decimals();
        _usdDecimals = IERC20Metadata(u).decimals();
        _poolKey = c.poolKey;
        keeper = c.keeper;

        _setParams(
            Params({
                defaultPremiumBps: 1000,
                defaultWidthBps: 5000,
                defaultDeployBps: 3000,
                buybackSlippageBps: 100,
                perfFeeBps: 1000,
                armDelay: 5 minutes,
                minFrozen: 15 minutes,
                maxPreCloseAge: 6 hours,
                settleDelay: 1 hours,
                maxFreshAge: 1 hours,
                armGrace: 2 hours,
                settleGrace: 6 hours
            })
        );
    }

    // ================================================================== lifecycle

    /// @notice Post the weekend range order. Keeper-only until `windowStart + armGrace`, then anyone (defaults used).
    /// @param premiumBps Band start above P0; keeper may only be more conservative than the default.
    /// @param widthBps Band width; within [1000, 10000].
    /// @param deployBps Share of vault STOCK to deploy; at most the default.
    function arm(uint16 premiumBps, uint16 widthBps, uint16 deployBps) external nonReentrant {
        if (state != State.OPEN) revert WrongState();
        (premiumBps, widthBps, deployBps) = _armParams(premiumBps, widthBps, deployBps);
        uint256 p0 = _armOracle();
        uint256 stockBefore = IERC20(asset()).balanceOf(address(this));
        Pos memory ps = _buildPosition(p0, premiumBps, widthBps, stockBefore * deployBps / BPS);
        uint256 deployed = abi.decode(poolManager.unlock(abi.encode(Action.ARM, abi.encode(ps))), (uint256));

        uint256 id = uint256(uint256(ps.salt));
        epochCount = id;
        Epoch storage e = _epochs[id];
        e.id = uint64(id);
        e.armedAt = uint64(block.timestamp);
        e.windowEnd = uint64(clock.windowEnd(block.timestamp));
        e.p0 = p0;
        e.tickLower = ps.tickLower;
        e.tickUpper = ps.tickUpper;
        e.liquidity = ps.liquidity;
        e.salt = ps.salt;
        e.stockBefore = stockBefore;
        e.stockDeployed = deployed;
        state = State.ARMED;
        emit Armed(id, p0, ps.tickLower, ps.tickUpper, deployed, ps.liquidity);
    }

    /// @dev Window, caller and bounds checks for `arm`; non-keepers get the defaults.
    function _armParams(uint16 premiumBps, uint16 widthBps, uint16 deployBps)
        internal
        view
        returns (uint16, uint16, uint16)
    {
        Params memory p = params;
        if (!clock.inWeekendWindow(block.timestamp)) revert NotWindow();
        uint256 ws = clock.windowStart(block.timestamp);
        if (block.timestamp < ws + p.armDelay) revert TooEarly();
        if (msg.sender != keeper) {
            if (block.timestamp < ws + p.armGrace) revert NotKeeper();
            (premiumBps, widthBps, deployBps) = (p.defaultPremiumBps, p.defaultWidthBps, p.defaultDeployBps);
        }
        if (
            premiumBps < p.defaultPremiumBps || widthBps < 1000 || widthBps > 10_000 || deployBps == 0
                || deployBps > p.defaultDeployBps
        ) revert ParamOutOfBounds();
        uint256 last = epochCount;
        if (last != 0 && _epochs[last].armedAt >= ws) revert WrongState(); // one epoch per window
        return (premiumBps, widthBps, deployBps);
    }

    /// @dev Oracle must be frozen (market closed) but have printed recently before the window (SPEC §4).
    function _armOracle() internal view returns (uint256 p0) {
        uint256 updatedAt;
        (p0, updatedAt) = _readFeed();
        if (block.timestamp - updatedAt < params.minFrozen) revert OracleNotFrozen();
        if (updatedAt + params.maxPreCloseAge < clock.windowStart(block.timestamp)) revert OracleStale();
    }

    /// @dev One-sided range above P0 * (1 + premium) holding `amount` STOCK (SPEC §5.2).
    function _buildPosition(uint256 p0, uint16 premiumBps, uint16 widthBps, uint256 amount)
        internal
        view
        returns (Pos memory ps)
    {
        if (amount == 0) revert ParamOutOfBounds();
        (, int24 cur,,) = poolManager.getSlot0(_poolKey.toId());
        (ps.tickLower, ps.tickUpper, ps.liquidity) = RangeMath.sellPosition(
            p0, premiumBps, widthBps, cur, _poolKey.tickSpacing, _decimals(), stockIsCurrency0, amount
        );
        if (ps.liquidity == 0) revert RangeInvalid();
        ps.salt = bytes32(epochCount + 1);
    }

    /// @notice Remove the position without trading, keeping whatever it holds (anyone).
    /// @dev Allowed once the pool trades beyond the top of the band (position is 100% USDG, the sale is done), or
    ///      from `windowEnd - LOCK_LEAD`. Stops a Monday mint-driven sell-off from buying the STOCK back inside the band.
    function lock() external nonReentrant {
        if (state != State.ARMED) revert WrongState();
        Epoch storage e = _epochs[epochCount];
        if (e.locked) revert WrongState();
        if (block.timestamp + LOCK_LEAD < e.windowEnd && !_fullySold(e)) revert TooEarly();
        bytes memory res = poolManager.unlock(abi.encode(Action.LOCK, abi.encode(_pos(e))));
        (uint256 stockBack, uint256 usdgBack) = abi.decode(res, (uint256, uint256));
        e.locked = true;
        e.stockBack = stockBack;
        e.usdgReceived = usdgBack;
        emit Locked(e.id, stockBack, usdgBack);
    }

    /// @notice After reopen with a fresh oracle: remove the position (if still live) and buy STOCK back with all USDG,
    ///         capped at freshPrice * (1 + buybackSlippageBps). Keeper-only until `windowEnd + settleDelay + settleGrace`.
    /// @param minStockOut Keeper's floor on STOCK bought; ignored for permissionless calls (the cap still applies).
    /// @return bought STOCK bought back in this call (lets the keeper simulate before sending).
    function settle(uint256 minStockOut) external nonReentrant returns (uint256 bought) {
        if (state != State.ARMED) revert WrongState();
        Epoch storage e = _epochs[epochCount];
        Params memory p = params;
        uint256 openAt = uint256(e.windowEnd) + p.settleDelay;
        if (block.timestamp < openAt) revert TooEarly();
        bool isKeeper = msg.sender == keeper;
        if (!isKeeper) {
            if (block.timestamp < openAt + p.settleGrace) revert NotKeeper();
            minStockOut = 0;
        }
        uint160 sqrtCap = _freshCap(e.windowEnd, p);

        bool wasLocked = e.locked;
        bytes memory res = poolManager.unlock(abi.encode(Action.SETTLE, abi.encode(wasLocked, _pos(e), sqrtCap)));
        uint256 stockBack;
        uint256 usdgBack;
        (stockBack, usdgBack, bought) = abi.decode(res, (uint256, uint256, uint256));
        if (bought < minStockOut) revert SlippageMinOut();
        if (!wasLocked) {
            e.locked = true;
            e.stockBack = stockBack;
            e.usdgReceived = usdgBack;
        }
        e.stockBought = bought;
        e.settledAt = uint64(block.timestamp);
        _afterBuyback(e);
        _emitSettled(e);
    }

    function _emitSettled(Epoch storage e) internal {
        emit Settled(e.id, e.stockBack, e.usdgReceived, e.stockBought, e.usdgLeft, e.pnlStock, e.feeStock);
    }

    /// @notice Retry the buyback after a capped (partial) settle. Anyone, with a fresh oracle.
    ///         Callable in PENDING_BUYBACK (within RETRY_WINDOW) and in OPEN_MIXED (to restore OPEN).
    /// @param minStockOut Caller's floor on STOCK bought.
    /// @return bought STOCK bought back in this call.
    function retryBuyback(uint256 minStockOut) external nonReentrant returns (uint256 bought) {
        Epoch storage e = _epochs[epochCount];
        if (state == State.PENDING_BUYBACK) {
            if (block.timestamp > uint256(e.settledAt) + RETRY_WINDOW) revert WrongState();
        } else if (state != State.OPEN_MIXED) {
            revert WrongState();
        }
        uint160 sqrtCap = _freshCap(e.windowEnd, params);
        bytes memory res = poolManager.unlock(abi.encode(Action.RETRY, abi.encode(sqrtCap)));
        bought = abi.decode(res, (uint256));
        if (bought < minStockOut) revert SlippageMinOut();
        e.stockBought += bought;
        _afterBuyback(e);
        emit BuybackRetried(e.id, bought, e.usdgLeft);
    }

    /// @notice Liveness escape: if the oracle never comes back fresh, anyone can pull the position after
    ///         windowEnd + EMERGENCY_DELAY. No swap; the vault moves to PENDING_BUYBACK (or OPEN if nothing sold).
    function emergencyUnwind() external nonReentrant {
        if (state != State.ARMED) revert WrongState();
        Epoch storage e = _epochs[epochCount];
        if (block.timestamp < uint256(e.windowEnd) + EMERGENCY_DELAY) revert TooEarly();
        if (!e.locked) {
            bytes memory res = poolManager.unlock(abi.encode(Action.UNWIND, abi.encode(_pos(e))));
            (e.stockBack, e.usdgReceived) = abi.decode(res, (uint256, uint256));
            e.locked = true;
        }
        e.settledAt = uint64(block.timestamp);
        _afterBuyback(e);
        emit EmergencyUnwound(e.id);
    }

    /// @notice After RETRY_WINDOW without a full buyback, open the vault for pro-rata STOCK + USDG exits (anyone).
    function expireBuyback() external nonReentrant {
        if (state != State.PENDING_BUYBACK) revert WrongState();
        Epoch storage e = _epochs[epochCount];
        if (block.timestamp <= uint256(e.settledAt) + RETRY_WINDOW) revert TooEarly();
        state = State.OPEN_MIXED;
        emit BuybackExpired(e.id);
    }

    /// @notice OPEN_MIXED exit: burn `shares` for a pro-rata slice of the vault's STOCK and USDG.
    function redeemMixed(uint256 shares, address to) external nonReentrant returns (uint256 stockOut, uint256 usdgOut) {
        if (state != State.OPEN_MIXED) revert WrongState();
        // same virtual-share denominator as ERC-4626 conversions, so the offset keeps protecting against donations
        uint256 supply = totalSupply() + 10 ** _decimalsOffset();
        stockOut = IERC20(asset()).balanceOf(address(this)) * shares / supply;
        usdgOut = usdg.balanceOf(address(this)) * shares / supply;
        _burn(msg.sender, shares);
        IERC20(asset()).safeTransfer(to, stockOut);
        usdg.safeTransfer(to, usdgOut);
        emit MixedRedeemed(msg.sender, to, shares, stockOut, usdgOut);
    }

    // ================================================================== unlock callback

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (Action action, bytes memory args) = abi.decode(data, (Action, bytes));

        if (action == Action.ARM) {
            Pos memory ps = abi.decode(args, (Pos));
            (BalanceDelta delta,) = poolManager.modifyLiquidity(_poolKey, _mlp(ps, int256(uint256(ps.liquidity))), "");
            (int128 dStock, int128 dUsd) = _split(delta);
            if (dUsd != 0 || dStock >= 0) revert NotSingleSided();
            _settleDeltas();
            return abi.encode(uint256(uint128(-dStock)));
        }
        if (action == Action.LOCK || action == Action.UNWIND) {
            (uint256 s, uint256 u) = _remove(abi.decode(args, (Pos)));
            _settleDeltas();
            return abi.encode(s, u);
        }
        if (action == Action.SETTLE) {
            (bool wasLocked, Pos memory ps, uint160 sqrtCap) = abi.decode(args, (bool, Pos, uint160));
            (uint256 s, uint256 u) = wasLocked ? (0, 0) : _remove(ps);
            uint256 bought = _buyback(sqrtCap);
            _settleDeltas();
            return abi.encode(s, u, bought);
        }
        // RETRY
        uint160 cap = abi.decode(args, (uint160));
        uint256 got = _buyback(cap);
        _settleDeltas();
        return abi.encode(got);
    }

    // ================================================================== ERC-4626 gating

    /// @notice STOCK held by the vault, plus STOCK still sitting in a live position while ARMED (display only;
    ///         deposits and withdrawals are disabled outside OPEN).
    function totalAssets() public view override returns (uint256) {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        if (state == State.ARMED) {
            Epoch storage e = _epochs[epochCount];
            if (!e.locked) bal += e.stockDeployed;
        }
        return bal;
    }

    function maxDeposit(address a) public view override returns (uint256) {
        return state == State.OPEN && !depositsPaused ? super.maxDeposit(a) : 0;
    }

    function maxMint(address a) public view override returns (uint256) {
        return state == State.OPEN && !depositsPaused ? super.maxMint(a) : 0;
    }

    function maxWithdraw(address a) public view override returns (uint256) {
        return state == State.OPEN ? super.maxWithdraw(a) : 0;
    }

    function maxRedeem(address a) public view override returns (uint256) {
        return state == State.OPEN ? super.maxRedeem(a) : 0;
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }

    // ================================================================== admin (bounded)

    /// @notice Update parameters; every field is bounded (SPEC §6.5).
    function setParams(Params calldata p) external onlyOwner {
        _setParams(p);
    }

    /// @notice Set the keeper (arm/settle before grace). The keeper can never move vault funds.
    function setKeeper(address k) external onlyOwner {
        if (k == address(0) || k == feeRecipient) revert BadConfig();
        keeper = k;
        emit KeeperUpdated(k);
    }

    /// @notice Pause new deposits (withdrawals are unaffected).
    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPaused(paused);
    }

    // ================================================================== views

    /// @notice Current parameters as a struct.
    function getParams() external view returns (Params memory) {
        return params;
    }

    /// @notice Latest epoch (zeroed before the first arm).
    function currentEpoch() external view returns (Epoch memory) {
        return _epochs[epochCount];
    }

    /// @notice Epoch by id (1-based).
    function epochs(uint256 id) external view returns (Epoch memory) {
        return _epochs[id];
    }

    /// @notice The STOCK/USDG pool this vault trades in.
    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    // ================================================================== internals

    function _setParams(Params memory p) internal {
        if (
            p.defaultPremiumBps < 500 || p.defaultWidthBps < 1000 || p.defaultWidthBps > 10_000
                || p.defaultDeployBps == 0 || p.defaultDeployBps > 5000 || p.buybackSlippageBps > 300
                || p.perfFeeBps > 2000 || p.armDelay < 1 minutes || p.armDelay > 1 hours || p.minFrozen < 5 minutes
                || p.minFrozen > 2 hours || p.maxPreCloseAge < 1 hours || p.maxPreCloseAge > 12 hours
                || p.settleDelay < 30 minutes || p.settleDelay > 12 hours || p.maxFreshAge < 5 minutes
                || p.maxFreshAge > 2 hours || p.armGrace > 12 hours || p.settleGrace > 12 hours
        ) revert ParamOutOfBounds();
        params = p;
        emit ParamsUpdated(p);
    }

    /// @dev Feed read with the checks that apply to every action (SPEC §4).
    function _readFeed() internal view returns (uint256 price, uint256 updatedAt) {
        if (address(sequencerFeed) != address(0)) {
            (, int256 status, uint256 startedAt,,) = sequencerFeed.latestRoundData();
            if (status != 0 || startedAt == 0 || block.timestamp - startedAt <= SEQ_GRACE) revert SequencerDown();
        }
        if (IStockToken(asset()).oraclePaused()) revert OraclePaused();
        (, int256 answer,, uint256 ts,) = feed.latestRoundData();
        if (answer <= 0) revert OracleStale();
        return (uint256(answer), ts);
    }

    /// @dev Fresh-oracle rule for settle / retry, returning the buyback price cap as a sqrtPrice.
    function _freshCap(uint256 windowEnd, Params memory p) internal view returns (uint160) {
        (uint256 price, uint256 updatedAt) = _readFeed();
        if (updatedAt < windowEnd || block.timestamp - updatedAt > p.maxFreshAge) revert OracleStale();
        return RangeMath.buybackSqrtCap(price, p.buybackSlippageBps, _decimals(), stockIsCurrency0);
    }

    /// @dev Final accounting once a buyback attempt ran (or the position was unwound without one).
    function _afterBuyback(Epoch storage e) internal {
        uint256 left = usdg.balanceOf(address(this));
        e.usdgLeft = left;
        if (left > USDG_DUST) {
            if (state == State.ARMED) state = State.PENDING_BUYBACK;
            return;
        }
        // performance fee only on a normal close; OPEN_MIXED redemptions break the stockBefore baseline
        if (state != State.OPEN_MIXED) {
            uint256 stockNow = IERC20(asset()).balanceOf(address(this));
            int256 pnl = int256(stockNow) - int256(e.stockBefore);
            e.pnlStock = pnl;
            if (pnl > 0) {
                uint256 fee = uint256(pnl) * params.perfFeeBps / BPS;
                e.feeStock = fee;
                if (fee > 0) IERC20(asset()).safeTransfer(feeRecipient, fee);
            }
        }
        state = State.OPEN;
    }

    /// @dev Position is 100% USDG once the pool trades beyond the sell side of the range.
    ///      Tick form: S0 sqrtP >= sqrt(tickUpper) <=> tick >= tickUpper; S1 uses tick < tickLower (strictly beyond).
    function _fullySold(Epoch storage e) internal view returns (bool) {
        (, int24 cur,,) = poolManager.getSlot0(_poolKey.toId());
        return stockIsCurrency0 ? cur >= e.tickUpper : cur < e.tickLower;
    }

    /// @dev Burn the whole position; returns (stock, usdg) credited (principal + fees).
    function _remove(Pos memory ps) internal returns (uint256, uint256) {
        (BalanceDelta delta,) = poolManager.modifyLiquidity(_poolKey, _mlp(ps, -int256(uint256(ps.liquidity))), "");
        (int128 dStock, int128 dUsd) = _split(delta);
        return (uint256(uint128(dStock)), uint256(uint128(dUsd)));
    }

    /// @dev Swap all USDG (PoolManager credit + vault balance) for STOCK, stopping at `sqrtCap` (partial fill, no revert).
    function _buyback(uint160 sqrtCap) internal returns (uint256 bought) {
        Currency cu = Currency.wrap(address(usdg));
        int256 credit = poolManager.currencyDelta(address(this), cu);
        uint256 usdIn = usdg.balanceOf(address(this)) + (credit > 0 ? uint256(credit) : 0);
        if (usdIn == 0) return 0;
        bool zeroForOne = !stockIsCurrency0; // pay USDG
        (uint160 sp,,,) = poolManager.getSlot0(_poolKey.toId());
        // pool already at/through the cap: nothing can be bought inside the limit
        if (zeroForOne ? sp <= sqrtCap : sp >= sqrtCap) return 0;
        BalanceDelta delta = poolManager.swap(
            _poolKey,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne, amountSpecified: -int256(usdIn), sqrtPriceLimitX96: sqrtCap
            }),
            ""
        );
        (int128 dStock,) = _split(delta);
        bought = dStock > 0 ? uint256(uint128(dStock)) : 0;
    }

    /// @dev Clear this contract's open deltas: take credits, pay debts from the vault balance.
    function _settleDeltas() internal {
        _clear(Currency.wrap(asset()));
        _clear(Currency.wrap(address(usdg)));
    }

    function _clear(Currency c) internal {
        int256 d = poolManager.currencyDelta(address(this), c);
        if (d > 0) {
            poolManager.take(c, address(this), uint256(d));
        } else if (d < 0) {
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).safeTransfer(address(poolManager), uint256(-d));
            poolManager.settle();
        }
    }

    function _pos(Epoch storage e) internal view returns (Pos memory) {
        return Pos(e.tickLower, e.tickUpper, e.liquidity, e.salt);
    }

    function _mlp(Pos memory ps, int256 delta) internal pure returns (IPoolManager.ModifyLiquidityParams memory) {
        return IPoolManager.ModifyLiquidityParams({
            tickLower: ps.tickLower, tickUpper: ps.tickUpper, liquidityDelta: delta, salt: ps.salt
        });
    }

    function _split(BalanceDelta d) internal view returns (int128 dStock, int128 dUsd) {
        return stockIsCurrency0 ? (d.amount0(), d.amount1()) : (d.amount1(), d.amount0());
    }

    function _decimals() internal view returns (RangeMath.Decimals memory) {
        return RangeMath.Decimals({feed: _feedDecimals, stock: _stockDecimals, usd: _usdDecimals});
    }
}
