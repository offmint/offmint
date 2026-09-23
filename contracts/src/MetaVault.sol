// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ISessionClock} from "./interfaces/ISessionClock.sol";
import {IPriceReference} from "./interfaces/IPriceReference.sol";
import {OffmintVault} from "./OffmintVault.sol";
import {RangeMath} from "./libraries/RangeMath.sol";
import {VaultPoolOps} from "./libraries/VaultPoolOps.sol";

/// @notice Where MetaVault finds each basket ticker's OffmintVault (implemented by VaultFactory).
interface IVaultRegistry {
    function vaultFor(address stock) external view returns (address);
}

/// @title MetaVault — the USDG basket vault that drives the per-ticker OffmintVaults (SPEC §6.5)
/// @notice Deposit and withdraw USDG. Each week the keeper may SELECT a few basket tickers and BUY-IN, commit the STOCK
///         into that ticker's OffmintVault before its weekend ladder is armed, then UNWIND back to USDG after settle.
///         This is NOT market-neutral: between BUY-IN and UNWIND the vault holds volatile, thinly traded stock
///         (SPEC §6.5.5). The bounded params below limit the damage; they do not remove the risk.
/// @dev State machine (§6.5.1a): IDLE iff `openPositionCount == 0`. Deposits and withdrawals only in IDLE.
///      Every swap is the same capped exact-input primitive (`VaultPoolOps.swapExact`) that settle's buyback uses,
///      with a pre-check AND the same cap as `sqrtPriceLimitX96`, so a same-block sandwich can only partial-fill it.
///      The cap bounds the pool price; the pool's LP fee is paid on top (as with settle's buyback).
contract MetaVault is ERC4626, Ownable2Step, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for *;
    using StateLibrary for IPoolManager;

    // ------------------------------------------------------------------ types

    enum Phase {
        NONE,
        BOUGHT, // STOCK held directly, stop-loss window open
        COMMITTED, // STOCK deposited into the ticker's OffmintVault (weekend ladder); stop-loss no longer applies
        UNWINDING // STOCK held directly again, being sold back to USDG
    }

    /// @notice One live entry per funded candidate (SPEC §6.5.3); deleted once fully unwound.
    struct BasketPosition {
        address stock;
        Phase phase;
        uint8 priceDecimals; // decimals of buyInPrice
        uint64 buyInAt;
        uint64 weekendEnd; // end of the weekend window this position is for
        uint256 stockAmount; // STOCK held directly (BOUGHT / UNWINDING)
        uint256 obShares; // OffmintVault shares held (COMMITTED)
        uint256 buyInPrice; // reference price at BUY-IN (USD per whole STOCK)
        uint256 usdgSpent;
        uint256 usdgBack;
    }

    /// @notice Bounded parameters (SPEC §6.5.3).
    struct Params {
        uint8 maxConcurrent; // <= 3
        uint16 allocBps; // <= 5000, share of the cycle's starting USDG per pick
        uint16 buyInSlippageBps; // <= 100
        uint16 unwindSlippageBps; // <= 100
        uint16 earlyUnwindThresholdBps; // 500..1500
        uint16 weeklyLossCapBps; // <= 2000
        uint16 txFeeBps; // <= 200, on deposit and withdraw
        uint16 blacklistDays; // 7..90
        uint32 maxRefAge; // 1h..3d, freshness of the reference for BUY-IN / stop-loss / UNWIND
    }

    uint256 internal constant BPS = 10_000;
    /// @dev A position whose remaining STOCK is worth less than this (USDG raw units) counts as unwound.
    uint256 public constant DUST_USDG = 10_000;

    // ------------------------------------------------------------------ state

    IPoolManager public immutable poolManager;
    ISessionClock public immutable clock;
    IVaultRegistry public immutable registry;
    address public immutable feeRecipient;
    uint8 internal immutable _usdDecimals;

    Params public params;
    address public keeper;

    uint256 public openPositionCount;
    uint256 public cycleBase; // USDG balance when the current cycle started
    uint64 public cycleWeekendEnd;
    address[] internal _open;
    mapping(address stock => BasketPosition) internal _pos;
    mapping(address stock => uint256 until) public blacklistedUntil;

    // ------------------------------------------------------------------ events / errors

    event CycleStarted(uint64 weekendEnd, uint256 cycleBase);
    event CycleEnded(uint64 weekendEnd);
    event BuyIn(address indexed stock, uint256 usdgSpent, uint256 stockBought, uint256 buyInPrice);
    event Committed(address indexed stock, address vault, uint256 stockAmount, uint256 obShares);
    event Redeemed(address indexed stock, uint256 stockOut, uint256 usdgOut);
    event Unwound(address indexed stock, uint256 stockSold, uint256 usdgReceived, uint256 stockLeft);
    event EarlyUnwind(address indexed stock, uint256 buyInPrice, uint256 exitPrice, uint256 lossUsdg, uint256 lossBps);
    event PositionClosed(address indexed stock, uint256 usdgSpent, uint256 usdgBack, uint256 lossBps, bool blacklisted);
    event ParamsUpdated(Params p);
    event KeeperUpdated(address keeper);

    error WrongState();
    error NotKeeper();
    error NotWindow();
    error TooEarly();
    error Blacklisted();
    error NoVault();
    error TooMany();
    error OverAlloc();
    error AboveCap();
    error NotTriggered();
    error OracleStale();
    error ParamOutOfBounds();
    error OnlyPoolManager();
    error BadConfig();

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }

    /// @param usdg_ the vault asset (USDG)
    /// @param registry_ ticker -> OffmintVault lookup (VaultFactory)
    constructor(
        IERC20 usdg_,
        IPoolManager poolManager_,
        ISessionClock clock_,
        IVaultRegistry registry_,
        address owner_,
        address keeper_,
        address feeRecipient_
    ) ERC4626(usdg_) ERC20("Offmint MetaVault", "omMETA") Ownable(owner_) {
        if (
            keeper_ == address(0) || feeRecipient_ == address(0) || feeRecipient_ == owner_ || feeRecipient_ == keeper_
                || address(registry_) == address(0)
        ) revert BadConfig();
        poolManager = poolManager_;
        clock = clock_;
        registry = registry_;
        feeRecipient = feeRecipient_;
        keeper = keeper_;
        _usdDecimals = IERC20Metadata(address(usdg_)).decimals();
        _setParams(defaultParams());
    }

    /// @notice SPEC §6.5.3 defaults.
    function defaultParams() public pure returns (Params memory) {
        return Params({
            maxConcurrent: 2,
            allocBps: 3000,
            buyInSlippageBps: 100,
            unwindSlippageBps: 100,
            earlyUnwindThresholdBps: 800,
            weeklyLossCapBps: 1000,
            txFeeBps: 50,
            blacklistDays: 28,
            maxRefAge: 1 days
        });
    }

    // ================================================================== weekly cycle

    /// @notice BUY-IN (keeper): swap up to `usdgAmount` USDG for `stock`, capped at reference × (1 + buyInSlippageBps).
    ///         Reverts if the pool is already above the cap (pre-check); the same cap is the swap's price limit, so the
    ///         fill can only be partial, never worse. Starts a cycle when IDLE.
    /// @param stock a basket STOCK with an OffmintVault in the registry
    /// @param usdgAmount at most allocBps of the cycle's starting USDG
    function buyIn(address stock, uint256 usdgAmount) external nonReentrant onlyKeeper {
        BasketPosition storage p = _pos[stock];
        if (p.phase != Phase.NONE) revert WrongState();
        if (block.timestamp < blacklistedUntil[stock]) revert Blacklisted();
        if (clock.inWeekendWindow(block.timestamp)) revert NotWindow();
        OffmintVault v = _vault(stock);
        uint64 we = uint64(clock.windowEnd(block.timestamp + 7 days)); // the coming weekend (Mon-Fri call)

        Params memory pr = params;
        if (openPositionCount == 0) {
            cycleBase = IERC20(asset()).balanceOf(address(this));
            cycleWeekendEnd = we;
            emit CycleStarted(we, cycleBase);
        } else if (cycleWeekendEnd != we) {
            revert WrongState(); // a slow unwind from last week is still open
        }
        if (openPositionCount >= pr.maxConcurrent) revert TooMany();
        if (usdgAmount == 0 || usdgAmount * BPS > cycleBase * pr.allocBps) revert OverAlloc();

        (uint256 price, uint8 pd) = _freshPrice(v, 0);
        RangeMath.Decimals memory d = _decimals(v, pd);
        bool s0 = v.stockIsCurrency0();
        uint160 cap = RangeMath.buybackSqrtCap(price, pr.buyInSlippageBps, d, s0);
        (uint160 sp,,,) = poolManager.getSlot0(v.poolKey().toId());
        if (s0 ? sp >= cap : sp <= cap) revert AboveCap(); // (1) pre-check: don't chase a squeeze already under way

        (uint256 spent, uint256 bought) = _swap(stock, true, usdgAmount, cap); // (2) same cap at execution
        if (bought == 0) revert AboveCap();

        p.stock = stock;
        p.phase = Phase.BOUGHT;
        p.priceDecimals = pd;
        p.buyInAt = uint64(block.timestamp);
        p.weekendEnd = we;
        p.stockAmount = bought;
        p.buyInPrice = price;
        p.usdgSpent = spent;
        _open.push(stock);
        openPositionCount++;
        emit BuyIn(stock, spent, bought, price);
    }

    /// @notice STOP-LOSS (anyone), only between BUY-IN and commit: if the reference has fallen to
    ///         buyInPrice × (1 − earlyUnwindThresholdBps), sell the position now. Reverts while the reference is
    ///         paused / halted (a corporate-action multiplier jump must not look like a crash). The realized loss
    ///         counts toward `weeklyLossCapBps` like any other.
    function triggerEarlyUnwind(address stock) external nonReentrant {
        BasketPosition storage p = _pos[stock];
        if (p.phase != Phase.BOUGHT) revert WrongState();
        OffmintVault v = _vault(stock);
        (uint256 price, uint8 pd) = _freshPrice(v, 0); // reverts if paused / halted / sequencer down
        if (pd != p.priceDecimals) revert BadConfig();
        if (price * BPS > p.buyInPrice * (BPS - params.earlyUnwindThresholdBps)) revert NotTriggered();

        p.phase = Phase.UNWINDING;
        uint256 stockIn = p.stockAmount;
        uint256 usdOut = _sell(p, v, price, pd);
        // exit price in reference units: USDG per whole STOCK, scaled to the reference's decimals
        uint256 exitPrice = stockIn == p.stockAmount ? 0 : _unitPrice(v, stockIn - p.stockAmount, usdOut, pd);
        uint256 lossBps = exitPrice >= p.buyInPrice ? 0 : (p.buyInPrice - exitPrice) * BPS / p.buyInPrice;
        uint256 lossUsdg = p.usdgBack >= p.usdgSpent ? 0 : p.usdgSpent - p.usdgBack;
        emit EarlyUnwind(stock, p.buyInPrice, exitPrice, lossUsdg, lossBps);
        _maybeClose(p, v, price, pd);
    }

    /// @notice ARM step (keeper): deposit the position's STOCK into the ticker's OffmintVault before its weekend
    ///         ladder is armed. From here §6's unchanged arm/lock/settle logic takes over; the stop-loss window closes.
    function commit(address stock) external nonReentrant onlyKeeper {
        BasketPosition storage p = _pos[stock];
        if (p.phase != Phase.BOUGHT) revert WrongState();
        if (block.timestamp >= p.weekendEnd) revert TooEarly();
        OffmintVault v = _vault(stock);
        IERC20(stock).forceApprove(address(v), p.stockAmount);
        uint256 shares = v.deposit(p.stockAmount, address(this)); // reverts unless the sub-vault is OPEN
        emit Committed(stock, address(v), p.stockAmount, shares);
        p.obShares = shares;
        p.stockAmount = 0;
        p.phase = Phase.COMMITTED;
    }

    /// @notice UNWIND: redeem from the OffmintVault once its weekend is over and it is OPEN (or OPEN_MIXED), then sell
    ///         the STOCK for USDG no lower than reference × (1 − unwindSlippageBps). Partial fills keep the rest for a
    ///         later call. Anyone after the weekend; the keeper may also abort a BOUGHT position earlier.
    function unwind(address stock) external nonReentrant {
        BasketPosition storage p = _pos[stock];
        if (p.phase == Phase.NONE) revert WrongState();
        OffmintVault v = _vault(stock);
        bool over = block.timestamp >= p.weekendEnd;
        if (!over && (p.phase != Phase.BOUGHT || msg.sender != keeper)) revert TooEarly();

        if (p.phase == Phase.COMMITTED) {
            OffmintVault.State st = v.state();
            uint256 usdOut = 0;
            if (st == OffmintVault.State.OPEN) {
                p.stockAmount = v.redeem(p.obShares, address(this), address(this));
            } else if (st == OffmintVault.State.OPEN_MIXED) {
                (p.stockAmount, usdOut) = v.redeemMixed(p.obShares, address(this));
                p.usdgBack += usdOut;
            } else {
                revert WrongState(); // still ARMED / PENDING_BUYBACK
            }
            emit Redeemed(stock, p.stockAmount, usdOut);
            p.obShares = 0;
        }
        p.phase = Phase.UNWINDING;
        // after the weekend, only a post-reopen print counts (same rule as settle)
        (uint256 price, uint8 pd) = _freshPrice(v, over ? p.weekendEnd : 0);
        _sell(p, v, price, pd);
        _maybeClose(p, v, price, pd);
    }

    // ================================================================== NAV (SPEC §6.5.1b)

    /// @notice USDG + every open position valued at its ticker's own reference price (the same one its OffmintVault
    ///         uses). Deposits/withdrawals only happen in IDLE, where this is just the USDG balance; the multi-term sum
    ///         is for display. If a reference reverts (paused), that position is shown at its buy-in price.
    function totalAssets() public view override returns (uint256 total) {
        total = IERC20(asset()).balanceOf(address(this));
        for (uint256 i = 0; i < _open.length; i++) {
            BasketPosition storage p = _pos[_open[i]];
            OffmintVault v = OffmintVault(registry.vaultFor(p.stock));
            uint256 units = p.phase == Phase.COMMITTED ? v.convertToAssets(p.obShares) : p.stockAmount;
            (uint256 price, uint8 pd) = (p.buyInPrice, p.priceDecimals);
            try v.priceRef().read() returns (uint256 px, uint8 d, uint256) {
                (price, pd) = (px, d);
            } catch {}
            total += _value(v, units, price, pd);
        }
    }

    function maxDeposit(address a) public view override returns (uint256) {
        return openPositionCount == 0 ? super.maxDeposit(a) : 0;
    }

    function maxMint(address a) public view override returns (uint256) {
        return openPositionCount == 0 ? super.maxMint(a) : 0;
    }

    function maxWithdraw(address a) public view override returns (uint256) {
        return openPositionCount == 0 ? super.maxWithdraw(a) : 0;
    }

    function maxRedeem(address a) public view override returns (uint256) {
        return openPositionCount == 0 ? super.maxRedeem(a) : 0;
    }

    // ------------------------------------------------------------------ txFeeBps (entry + exit fee, in assets)

    /// @dev Standard ERC-4626 fee-vault pattern: previews and `_deposit`/`_withdraw` use the same fee math, so shares
    ///      are always minted/burned against the net amount and a deposit→withdraw round trip pays the fee twice.
    function previewDeposit(uint256 assets) public view override returns (uint256) {
        return super.previewDeposit(assets - _feeOnTotal(assets));
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        uint256 assets = super.previewMint(shares);
        return assets + _feeOnRaw(assets);
    }

    function previewWithdraw(uint256 assets) public view override returns (uint256) {
        return super.previewWithdraw(assets + _feeOnRaw(assets));
    }

    function previewRedeem(uint256 shares) public view override returns (uint256) {
        uint256 assets = super.previewRedeem(shares);
        return assets - _feeOnTotal(assets);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        uint256 fee = _feeOnTotal(assets);
        super._deposit(caller, receiver, assets, shares);
        if (fee > 0) IERC20(asset()).safeTransfer(feeRecipient, fee);
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
    {
        uint256 fee = _feeOnRaw(assets);
        super._withdraw(caller, receiver, owner_, assets, shares);
        if (fee > 0) IERC20(asset()).safeTransfer(feeRecipient, fee);
    }

    function _feeOnRaw(uint256 assets) internal view returns (uint256) {
        return Math.mulDiv(assets, params.txFeeBps, BPS, Math.Rounding.Ceil);
    }

    function _feeOnTotal(uint256 assets) internal view returns (uint256) {
        return Math.mulDiv(assets, params.txFeeBps, params.txFeeBps + BPS, Math.Rounding.Ceil);
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ================================================================== unlock callback

    /// @inheritdoc IUnlockCallback
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (address stock, bool buyStock, uint256 amount, uint160 limit) =
            abi.decode(data, (address, bool, uint256, uint160));
        OffmintVault v = _vault(stock);
        VaultPoolOps.Ctx memory c = VaultPoolOps.Ctx(poolManager, v.poolKey(), v.stockIsCurrency0(), stock, asset());
        (uint256 amountIn, uint256 amountOut) = VaultPoolOps.swapExact(c, buyStock, amount, limit);
        return abi.encode(amountIn, amountOut);
    }

    // ================================================================== admin (bounded)

    /// @notice Update bounded params (owner, IDLE only).
    function setParams(Params calldata p) external onlyOwner {
        if (openPositionCount != 0) revert WrongState();
        _setParams(p);
    }

    /// @notice Replace the keeper (owner).
    function setKeeper(address k) external onlyOwner {
        if (k == address(0) || k == feeRecipient) revert BadConfig();
        keeper = k;
        emit KeeperUpdated(k);
    }

    // ================================================================== views

    /// @notice Stocks with an open position this cycle.
    function openPositions() external view returns (address[] memory) {
        return _open;
    }

    /// @notice A position (zeroed if none).
    function position(address stock) external view returns (BasketPosition memory) {
        return _pos[stock];
    }

    /// @notice All params.
    function getParams() external view returns (Params memory) {
        return params;
    }

    // ================================================================== internals

    function _setParams(Params memory p) internal {
        if (
            p.maxConcurrent == 0 || p.maxConcurrent > 3 || p.allocBps == 0 || p.allocBps > 5000
                || p.buyInSlippageBps > 100 || p.unwindSlippageBps > 100 || p.earlyUnwindThresholdBps < 500
                || p.earlyUnwindThresholdBps > 1500 || p.weeklyLossCapBps > 2000 || p.txFeeBps > 200
                || p.blacklistDays < 7 || p.blacklistDays > 90 || p.maxRefAge < 1 hours || p.maxRefAge > 3 days
        ) revert ParamOutOfBounds();
        params = p;
        emit ParamsUpdated(p);
    }

    function _vault(address stock) internal view returns (OffmintVault v) {
        v = OffmintVault(registry.vaultFor(stock));
        if (address(v) == address(0)) revert NoVault();
    }

    /// @dev Read through the ticker's own price reference (reverts if paused / halted / sequencer down); must be recent
    ///      and, if `notBefore` is set, printed at or after it.
    function _freshPrice(OffmintVault v, uint256 notBefore) internal view returns (uint256 price, uint8 pd) {
        uint256 updatedAt;
        (price, pd, updatedAt) = v.priceRef().read();
        if (price == 0 || updatedAt < notBefore || block.timestamp - updatedAt > params.maxRefAge) {
            revert OracleStale();
        }
    }

    /// @dev Sell the position's STOCK down to reference × (1 − unwindSlippageBps); records proceeds.
    function _sell(BasketPosition storage p, OffmintVault v, uint256 price, uint8 pd)
        internal
        returns (uint256 usdOut)
    {
        bool s0 = v.stockIsCurrency0();
        uint256 floorUsd = price * (BPS - params.unwindSlippageBps) / BPS;
        // S0: sqrt falls as we sell -> round the limit UP (never below the floor). S1: mirror.
        uint160 limit = RangeMath.usdToSqrtPriceX96(floorUsd, _decimals(v, pd), s0, s0);
        uint256 stockIn;
        (stockIn, usdOut) = _swap(p.stock, false, p.stockAmount, limit);
        p.stockAmount -= stockIn;
        p.usdgBack += usdOut;
        emit Unwound(p.stock, stockIn, usdOut, p.stockAmount);
    }

    /// @dev Close the position once what is left is dust; apply the loss cap (blacklist) and end the cycle if last.
    function _maybeClose(BasketPosition storage p, OffmintVault v, uint256 price, uint8 pd) internal {
        if (_value(v, p.stockAmount, price, pd) >= DUST_USDG) return;
        address stock = p.stock;
        uint256 lossBps = p.usdgBack >= p.usdgSpent ? 0 : (p.usdgSpent - p.usdgBack) * BPS / p.usdgSpent;
        bool bl = lossBps > params.weeklyLossCapBps;
        if (bl) blacklistedUntil[stock] = block.timestamp + uint256(params.blacklistDays) * 1 days;
        emit PositionClosed(stock, p.usdgSpent, p.usdgBack, lossBps, bl);

        delete _pos[stock];
        for (uint256 i = 0; i < _open.length; i++) {
            if (_open[i] == stock) {
                _open[i] = _open[_open.length - 1];
                _open.pop();
                break;
            }
        }
        if (--openPositionCount == 0) emit CycleEnded(cycleWeekendEnd);
    }

    /// @dev Pool context is rebuilt inside the callback from the registry.
    function _swap(address stock, bool buyStock, uint256 amount, uint160 limit)
        internal
        returns (uint256 amountIn, uint256 amountOut)
    {
        return abi.decode(poolManager.unlock(abi.encode(stock, buyStock, amount, limit)), (uint256, uint256));
    }

    /// @dev STOCK raw units -> USDG raw units at `price` (USD per whole STOCK, `pd` decimals).
    function _value(OffmintVault v, uint256 units, uint256 price, uint8 pd) internal view returns (uint256) {
        if (units == 0) return 0;
        return
            Math.mulDiv(units, price * 10 ** _usdDecimals, 10 ** (uint256(pd) + IERC20Metadata(v.asset()).decimals()));
    }

    /// @dev Realized USDG per whole STOCK, in `pd` decimals.
    function _unitPrice(OffmintVault v, uint256 stockIn, uint256 usdOut, uint8 pd) internal view returns (uint256) {
        return
            Math.mulDiv(
                usdOut, 10 ** (uint256(pd) + IERC20Metadata(v.asset()).decimals()), stockIn * 10 ** _usdDecimals
            );
    }

    function _decimals(OffmintVault v, uint8 pd) internal view returns (RangeMath.Decimals memory) {
        return RangeMath.Decimals({feed: pd, stock: IERC20Metadata(v.asset()).decimals(), usd: _usdDecimals});
    }
}
