// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC4626, ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";

import {IPriceReference} from "./interfaces/IPriceReference.sol";
import {ISessionClock} from "./interfaces/ISessionClock.sol";
import {RangeMath} from "./libraries/RangeMath.sol";
import {VaultPoolOps} from "./libraries/VaultPoolOps.sol";
import {OffmintParams} from "./libraries/OffmintParams.sol";

/// @title OffmintVault — the per-stock weekend engine (SPEC §6)
/// @notice Holders deposit STOCK (ERC-4626). When minting closes for the weekend, `arm` posts a LADDER of up to four
///         one-sided Uniswap v4 range orders of part of the STOCK above the last reference price (SPEC §5.0). If a
///         weekend supply crunch pushes the pool into the ladder, the vault sells slices at rising premiums. `lock`
///         pulls fully-sold rungs (any time) or every rung (just before the Monday reopen) so fills are not reversed
///         by the mint-driven sell-off, and `settle` buys the STOCK back once the reference is fresh, capped at
///         price * (1 + slippage) so a real Monday gap-up can never force a bad buyback.
/// @dev Price source is an `IPriceReference` (Chainlink adapter, or the Robinhood-API `PushPriceReference` for new
///      listings without a feed): the vault neither knows nor cares which (SPEC §3.6). Talks to the PoolManager
///      directly via unlock/unlockCallback (the chain's UniversalRouter uses a non-standard swap struct). Time is
///      block.timestamp only. No arbitrary calls; no path moves assets to the owner or keeper. Outbound transfers:
///      ERC-4626 redemptions, `redeemMixed`, and the performance fee to the immutable `feeRecipient`.
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
        REMOVE,
        RETRY
    }

    /// @notice Per-rung record of an epoch (SPEC §6.4).
    struct RungResult {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bool removed; // pulled by lock / settle / unwind (or never placed)
        uint256 stockDeployed;
        uint256 stockBack;
        uint256 usdgReceived;
    }

    struct Epoch {
        uint64 id;
        uint64 armedAt;
        uint64 windowEnd;
        uint64 settledAt; // settle / emergencyUnwind time; starts the retry window
        uint256 p0; // reference price at arm
        uint8 priceDecimals; // decimals of p0 (from the price reference)
        uint8 rungs; // number of rungs in this epoch's ladder
        uint256 stockBefore; // vault STOCK before arm (incl. undeployed)
        uint256 stockDeployed;
        uint256 stockBack; // STOCK returned from all rungs (incl. fees)
        uint256 usdgReceived; // USDG returned from all rungs (fills + fees)
        uint256 stockBought; // from buyback(s)
        uint256 usdgLeft;
        int256 pnlStock; // stockAfter - stockBefore, before fee
        uint256 feeStock;
    }

    // ------------------------------------------------------------------ constants

    uint256 internal constant BPS = 10_000;
    uint256 public constant RETRY_WINDOW = 48 hours;
    uint256 public constant EMERGENCY_DELAY = 96 hours;
    /// @notice Anyone may pull every remaining rung from this long before the Monday reopen.
    uint256 public constant LOCK_LEAD = 15 minutes;
    /// @notice USDG left below this (raw units) counts as fully bought back; it rolls into the next buyback.
    uint256 public constant USDG_DUST = 100;

    // ------------------------------------------------------------------ immutables

    IPoolManager public immutable poolManager;
    ISessionClock public immutable clock;
    /// @notice Price source: Chainlink adapter or PushPriceReference (SPEC §3.6). Health checks live in the adapter.
    IPriceReference public immutable priceRef;
    IERC20 public immutable usdg;
    address public immutable feeRecipient;
    /// @notice address(0): community instance, open to anyone. Otherwise the only address that may deposit/mint
    ///         (MetaVault's exclusive instance, SPEC §6.1 / §6.5.3), so the two kinds of capital never share a vault.
    address public immutable restrictedDepositor;
    bool public immutable stockIsCurrency0;
    uint8 internal immutable _stockDecimals;
    uint8 internal immutable _usdDecimals;

    // ------------------------------------------------------------------ storage

    PoolKey internal _poolKey;
    OffmintParams.Params public params;
    RangeMath.Rung[] internal _defaultLadder;
    address public keeper;
    bool public depositsPaused;
    State public state;
    uint256 public epochCount;
    mapping(uint256 => Epoch) internal _epochs;
    mapping(uint256 => RungResult[]) internal _rungResults;

    // ------------------------------------------------------------------ events / errors

    event Armed(uint256 indexed id, uint256 p0, uint256 rungs, uint256 stockDeployed);
    event RungArmed(
        uint256 indexed id, uint256 rung, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 stock
    );
    event RungRemoved(uint256 indexed id, uint256 rung, uint256 stockBack, uint256 usdgReceived);
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
    event ParamsUpdated(OffmintParams.Params p);
    event LadderUpdated(RangeMath.Rung[] ladder);
    event KeeperUpdated(address keeper);
    event DepositsPaused(bool paused);

    error WrongState();
    error NotWindow();
    error TooEarly();
    error OracleStale();
    error OracleNotFrozen();
    error ParamOutOfBounds();
    error NotKeeper();
    error SlippageMinOut();
    error OnlyPoolManager();
    error BadConfig();
    error NotDepositor();

    // ------------------------------------------------------------------ constructor

    struct Config {
        IPoolManager poolManager;
        ISessionClock clock;
        IPriceReference priceRef;
        IERC20 stock;
        IERC20 usdg;
        PoolKey poolKey;
        address owner;
        address keeper;
        address feeRecipient;
        string ticker;
        address restrictedDepositor;
    }

    constructor(Config memory c)
        ERC4626(c.stock)
        ERC20(
            string.concat("Offmint ", c.ticker),
            string.concat(c.restrictedDepositor == address(0) ? "ob" : "mb", c.ticker)
        )
        Ownable(c.owner)
    {
        address s = address(c.stock);
        address u = address(c.usdg);
        address c0 = Currency.unwrap(c.poolKey.currency0);
        address c1 = Currency.unwrap(c.poolKey.currency1);
        bool s0 = c0 == s && c1 == u;
        if (!s0 && !(c0 == u && c1 == s)) revert BadConfig();
        // hook-free pools only: a hook could block addLiquidity or skim the position
        if (address(c.poolKey.hooks) != address(0) || address(c.priceRef) == address(0)) revert BadConfig();
        if (
            c.keeper == address(0) || c.feeRecipient == address(0) || c.feeRecipient == c.owner
                || c.feeRecipient == c.keeper
        ) {
            revert BadConfig();
        }

        poolManager = c.poolManager;
        clock = c.clock;
        priceRef = c.priceRef;
        usdg = c.usdg;
        feeRecipient = c.feeRecipient;
        restrictedDepositor = c.restrictedDepositor;
        stockIsCurrency0 = s0;
        _stockDecimals = IERC20Metadata(s).decimals();
        _usdDecimals = IERC20Metadata(u).decimals();
        _poolKey = c.poolKey;
        keeper = c.keeper;

        _setParams(OffmintParams.defaults());
        _setLadder(RangeMath.defaultLadder());
    }

    // ================================================================== lifecycle

    /// @notice Post the weekend ladder. Keeper-only until `windowStart + armGrace`, then anyone (defaults used).
    /// @param rungs Keeper ladder: valid (SPEC §5.0) and at least as conservative as the default
    ///              (first rung's premium >= the default first rung's premium). Ignored for permissionless calls.
    /// @param deployBps Share of vault STOCK to deploy; at most the default. Ignored for permissionless calls.
    function arm(RangeMath.Rung[] calldata rungs, uint16 deployBps) external nonReentrant {
        if (state != State.OPEN) revert WrongState();
        RangeMath.Rung[] memory ladder = _armParams(rungs, deployBps);
        if (msg.sender != keeper) deployBps = params.defaultDeployBps;
        (uint256 p0, uint8 pd) = _armOracle();
        uint256 stockBefore = IERC20(asset()).balanceOf(address(this));
        uint256 id = epochCount + 1;
        (RangeMath.RungPosition[] memory ps, VaultPoolOps.Pos[] memory pos) =
            _buildLadder(id, p0, pd, ladder, stockBefore * deployBps / BPS);
        uint256[] memory owed = abi.decode(poolManager.unlock(abi.encode(Action.ARM, abi.encode(pos))), (uint256[]));
        _recordArm(id, p0, pd, stockBefore, ps, owed);
    }

    /// @dev Single-sided rung positions for this epoch (SPEC §5.0; math in the linked RangeMath library).
    function _buildLadder(uint256 id, uint256 p0, uint8 pd, RangeMath.Rung[] memory ladder, uint256 amount)
        internal
        view
        returns (RangeMath.RungPosition[] memory ps, VaultPoolOps.Pos[] memory pos)
    {
        (, int24 cur,,) = poolManager.getSlot0(_poolKey.toId());
        ps = RangeMath.ladderPositions(p0, ladder, cur, _poolKey.tickSpacing, _decimals(pd), stockIsCurrency0, amount);
        pos = new VaultPoolOps.Pos[](ps.length);
        for (uint256 i = 0; i < ps.length; i++) {
            pos[i] = VaultPoolOps.Pos(ps[i].tickLower, ps[i].tickUpper, ps[i].liquidity, _salt(id, i));
        }
    }

    /// @dev Stores the epoch and its per-rung results after the ARM unlock.
    function _recordArm(
        uint256 id,
        uint256 p0,
        uint8 pd,
        uint256 stockBefore,
        RangeMath.RungPosition[] memory ps,
        uint256[] memory owed
    ) internal {
        epochCount = id;
        Epoch storage e = _epochs[id];
        e.id = uint64(id);
        e.armedAt = uint64(block.timestamp);
        e.windowEnd = uint64(clock.windowEnd(block.timestamp));
        e.p0 = p0;
        e.priceDecimals = pd;
        e.rungs = uint8(ps.length);
        e.stockBefore = stockBefore;
        uint256 deployed = 0;
        RungResult[] storage rs = _rungResults[id];
        for (uint256 i = 0; i < ps.length; i++) {
            RungResult storage r = rs.push();
            r.tickLower = ps[i].tickLower;
            r.tickUpper = ps[i].tickUpper;
            r.liquidity = ps[i].liquidity;
            r.removed = ps[i].liquidity == 0;
            r.stockDeployed = owed[i];
            deployed += owed[i];
            if (ps[i].liquidity != 0) {
                emit RungArmed(id, i, ps[i].tickLower, ps[i].tickUpper, ps[i].liquidity, owed[i]);
            }
        }
        e.stockDeployed = deployed;
        state = State.ARMED;
        emit Armed(id, p0, ps.length, deployed);
    }

    /// @notice Pull rungs without trading, keeping whatever they hold (anyone).
    /// @dev Any time while ARMED: every rung the pool has traded fully through (100% USDG, the sale is done).
    ///      From `windowEnd - LOCK_LEAD`: every remaining rung. Stops a Monday mint-driven sell-off from buying the
    ///      STOCK back inside the ladder.
    function lock() external nonReentrant {
        if (state != State.ARMED) revert WrongState();
        Epoch storage e = _epochs[epochCount];
        bool nearOpen = block.timestamp + LOCK_LEAD >= e.windowEnd;
        (, int24 cur,,) = poolManager.getSlot0(_poolKey.toId());
        RungResult[] storage rs = _rungResults[e.id];
        bool[] memory pick = new bool[](rs.length);
        bool any = false;
        for (uint256 i = 0; i < rs.length; i++) {
            if (rs[i].removed) continue;
            bool sold = stockIsCurrency0 ? cur >= rs[i].tickUpper : cur < rs[i].tickLower;
            if (nearOpen || sold) pick[i] = any = true;
        }
        if (!any) revert TooEarly();
        _removeRungs(e, pick, false, 0);
    }

    /// @notice After reopen with a fresh reference: pull every remaining rung and buy STOCK back with all USDG, capped
    ///         at price * (1 + buybackSlippageBps). Keeper-only until `windowEnd + settleDelay + settleGrace`.
    /// @param minStockOut Keeper's floor on STOCK bought; ignored for permissionless calls (the cap still applies).
    /// @return bought STOCK bought back in this call (lets the keeper simulate before sending).
    function settle(uint256 minStockOut) external nonReentrant returns (uint256 bought) {
        if (state != State.ARMED) revert WrongState();
        Epoch storage e = _epochs[epochCount];
        OffmintParams.Params memory p = params;
        uint256 openAt = uint256(e.windowEnd) + p.settleDelay;
        if (block.timestamp < openAt) revert TooEarly();
        if (msg.sender != keeper) {
            if (block.timestamp < openAt + p.settleGrace) revert NotKeeper();
            minStockOut = 0;
        }
        uint160 sqrtCap = _freshCap(e.windowEnd, p);
        bought = _removeRungs(e, _remaining(e), true, sqrtCap);
        if (bought < minStockOut) revert SlippageMinOut();
        e.stockBought = bought;
        e.settledAt = uint64(block.timestamp);
        _afterBuyback(e);
        _emitSettled(e);
    }

    /// @notice Retry the buyback after a capped (partial) settle. Anyone, with a fresh reference.
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
        bought = abi.decode(poolManager.unlock(abi.encode(Action.RETRY, abi.encode(sqrtCap))), (uint256));
        if (bought < minStockOut) revert SlippageMinOut();
        e.stockBought += bought;
        _afterBuyback(e);
        emit BuybackRetried(e.id, bought, e.usdgLeft);
    }

    /// @notice Liveness escape: if the reference never comes back fresh, anyone can pull every rung after
    ///         windowEnd + EMERGENCY_DELAY. No swap; the vault moves to PENDING_BUYBACK (or OPEN if nothing sold).
    function emergencyUnwind() external nonReentrant {
        if (state != State.ARMED) revert WrongState();
        Epoch storage e = _epochs[epochCount];
        if (block.timestamp < uint256(e.windowEnd) + EMERGENCY_DELAY) revert TooEarly();
        _removeRungs(e, _remaining(e), false, 0);
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
    /// @param shares Shares to burn (caller's).
    /// @param to Receiver of STOCK and USDG.
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
    /// @dev Pool plumbing runs in the linked VaultPoolOps library via delegatecall, i.e. as this vault.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (Action action, bytes memory args) = abi.decode(data, (Action, bytes));
        VaultPoolOps.Ctx memory c = VaultPoolOps.Ctx(poolManager, _poolKey, stockIsCurrency0, asset(), address(usdg));
        if (action == Action.ARM) {
            return abi.encode(VaultPoolOps.armRungs(c, abi.decode(args, (VaultPoolOps.Pos[]))));
        }
        if (action == Action.REMOVE) {
            (VaultPoolOps.Pos[] memory pos, bool buyback, uint160 sqrtCap) =
                abi.decode(args, (VaultPoolOps.Pos[], bool, uint160));
            (uint256[] memory s, uint256[] memory u, uint256 bought) =
                VaultPoolOps.removeRungs(c, pos, buyback, sqrtCap);
            return abi.encode(s, u, bought);
        }
        return abi.encode(VaultPoolOps.retry(c, abi.decode(args, (uint160)))); // RETRY
    }

    // ================================================================== ERC-4626 gating

    /// @notice STOCK held by the vault, plus STOCK still sitting in live rungs while ARMED (display only;
    ///         deposits and withdrawals are disabled outside OPEN).
    function totalAssets() public view override returns (uint256) {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        if (state == State.ARMED) {
            RungResult[] storage rs = _rungResults[epochCount];
            for (uint256 i = 0; i < rs.length; i++) {
                if (!rs[i].removed) bal += rs[i].stockDeployed;
            }
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

    /// @dev A restricted instance only accepts its one depositor (deposit and mint both land here).
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (restrictedDepositor != address(0) && caller != restrictedDepositor) revert NotDepositor();
        super._deposit(caller, receiver, assets, shares);
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }

    // ================================================================== admin (bounded)

    /// @notice Update parameters; every field is bounded (SPEC §6.5).
    function setParams(OffmintParams.Params calldata p) external onlyOwner {
        _setParams(p);
    }

    /// @notice Replace the default ladder (validated: SPEC §5.0). Only while OPEN, so an armed epoch never changes.
    function setDefaultLadder(RangeMath.Rung[] calldata ladder) external onlyOwner {
        if (state != State.OPEN) revert WrongState();
        _setLadder(ladder);
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
    function getParams() external view returns (OffmintParams.Params memory) {
        return params;
    }

    /// @notice The default ladder used for permissionless arms.
    function defaultLadder() external view returns (RangeMath.Rung[] memory) {
        return _defaultLadder;
    }

    /// @notice Latest epoch (zeroed before the first arm).
    function currentEpoch() external view returns (Epoch memory) {
        return _epochs[epochCount];
    }

    /// @notice Epoch by id (1-based).
    function epochs(uint256 id) external view returns (Epoch memory) {
        return _epochs[id];
    }

    /// @notice Per-rung results of an epoch.
    function epochRungs(uint256 id) external view returns (RungResult[] memory) {
        return _rungResults[id];
    }

    /// @notice The STOCK/USDG pool this vault trades in.
    function poolKey() external view returns (PoolKey memory) {
        return _poolKey;
    }

    // ================================================================== internals

    function _setParams(OffmintParams.Params memory p) internal {
        OffmintParams.validate(p); // reverts OffmintParams.ParamOutOfBounds outside the SPEC §6.5 bounds
        params = p;
        emit ParamsUpdated(p);
    }

    function _setLadder(RangeMath.Rung[] memory ladder) internal {
        RangeMath.validateLadder(ladder); // 1-4 rungs, shares = 10000, >= 5% floor, ascending, non-overlapping
        delete _defaultLadder;
        for (uint256 i = 0; i < ladder.length; i++) {
            _defaultLadder.push(ladder[i]);
        }
        emit LadderUpdated(ladder);
    }

    /// @dev Window, caller and bounds checks for `arm`; non-keepers get the default ladder.
    function _armParams(RangeMath.Rung[] calldata rungs, uint16 deployBps)
        internal
        view
        returns (RangeMath.Rung[] memory ladder)
    {
        OffmintParams.Params memory p = params;
        if (!clock.inWeekendWindow(block.timestamp)) revert NotWindow();
        uint256 ws = clock.windowStart(block.timestamp);
        if (block.timestamp < ws + p.armDelay) revert TooEarly();
        uint256 last = epochCount;
        if (last != 0 && _epochs[last].armedAt >= ws) revert WrongState(); // one epoch per window
        if (msg.sender != keeper) {
            if (block.timestamp < ws + p.armGrace) revert NotKeeper();
            return _defaultLadder;
        }
        ladder = rungs;
        RangeMath.validateLadder(ladder);
        // the keeper can only be MORE conservative: first rung at or above the default premium, never deploy more
        if (ladder[0].premiumBps < _defaultLadder[0].premiumBps || deployBps == 0 || deployBps > p.defaultDeployBps) {
            revert ParamOutOfBounds();
        }
    }

    /// @dev Reference must be frozen (market closed) but have printed recently before the window (SPEC §4).
    function _armOracle() internal view returns (uint256 p0, uint8 pd) {
        uint256 updatedAt;
        (p0, pd, updatedAt) = _readPrice();
        if (block.timestamp - updatedAt < params.minFrozen) revert OracleNotFrozen();
        if (updatedAt + params.maxPreCloseAge < clock.windowStart(block.timestamp)) revert OracleStale();
    }

    /// @dev Health checks (answer > 0, issuer oraclePaused, sequencer / halt flag) live in the reference adapter.
    function _readPrice() internal view returns (uint256 price, uint8 decimals, uint256 updatedAt) {
        (price, decimals, updatedAt) = priceRef.read();
        if (price == 0) revert OracleStale();
    }

    /// @dev Fresh-reference rule for settle / retry, returning the buyback price cap as a sqrtPrice.
    function _freshCap(uint256 windowEnd, OffmintParams.Params memory p) internal view returns (uint160) {
        (uint256 price, uint8 pd, uint256 updatedAt) = _readPrice();
        if (updatedAt < windowEnd || block.timestamp - updatedAt > p.maxFreshAge) revert OracleStale();
        return RangeMath.buybackSqrtCap(price, p.buybackSlippageBps, _decimals(pd), stockIsCurrency0);
    }

    /// @dev Pull the picked rungs (and optionally buy back), record per-rung and epoch totals.
    function _removeRungs(Epoch storage e, bool[] memory pick, bool buyback, uint160 sqrtCap)
        internal
        returns (uint256 bought)
    {
        RungResult[] storage rs = _rungResults[e.id];
        VaultPoolOps.Pos[] memory pos = new VaultPoolOps.Pos[](rs.length);
        for (uint256 i = 0; i < rs.length; i++) {
            if (pick[i]) pos[i] = VaultPoolOps.Pos(rs[i].tickLower, rs[i].tickUpper, rs[i].liquidity, _salt(e.id, i));
        }
        (uint256[] memory s, uint256[] memory u, uint256 b) = abi.decode(
            poolManager.unlock(abi.encode(Action.REMOVE, abi.encode(pos, buyback, sqrtCap))),
            (uint256[], uint256[], uint256)
        );
        for (uint256 i = 0; i < rs.length; i++) {
            if (!pick[i]) continue;
            rs[i].removed = true;
            rs[i].stockBack = s[i];
            rs[i].usdgReceived = u[i];
            e.stockBack += s[i];
            e.usdgReceived += u[i];
            emit RungRemoved(e.id, i, s[i], u[i]);
        }
        return b;
    }

    /// @dev Mask of rungs still live (not yet removed).
    function _remaining(Epoch storage e) internal view returns (bool[] memory pick) {
        RungResult[] storage rs = _rungResults[e.id];
        pick = new bool[](rs.length);
        for (uint256 i = 0; i < rs.length; i++) {
            pick[i] = !rs[i].removed;
        }
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

    function _emitSettled(Epoch storage e) internal {
        emit Settled(e.id, e.stockBack, e.usdgReceived, e.stockBought, e.usdgLeft, e.pnlStock, e.feeStock);
    }

    /// @dev Unique position salt per (epoch, rung).
    function _salt(uint256 id, uint256 rung) internal pure returns (bytes32) {
        return bytes32((id << 8) | rung);
    }

    function _decimals(uint8 priceDecimals) internal view returns (RangeMath.Decimals memory) {
        return RangeMath.Decimals({feed: priceDecimals, stock: _stockDecimals, usd: _usdDecimals});
    }
}
