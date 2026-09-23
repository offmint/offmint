// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

import {OffmintVault} from "../src/OffmintVault.sol";
import {SessionClock} from "../src/clock/SessionClock.sol";
import {RangeMath} from "../src/libraries/RangeMath.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {ISessionClock} from "../src/interfaces/ISessionClock.sol";

/// @dev Full-cycle tests against a locally deployed v4 PoolManager. Every test runs in both pool orientations
///      (VaultS0Test: STOCK is currency0, VaultS1Test: STOCK is currency1).
abstract contract VaultSetup is Deployers {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 constant SAT = 1790380800; // Sat 26 Sep 2026 00:00 UTC
    uint256 constant MON = SAT + 2 days;
    uint256 constant P0 = 30e8; // $30, 8-dec feed

    address owner = makeAddr("owner");
    address keeperAddr = makeAddr("keeper");
    address feeTo = makeAddr("feeTo");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address rando = makeAddr("rando");

    MockStockToken stock;
    MockUSDG usd;
    MockFeed feed;
    SessionClock clock;
    OffmintVault vault;
    bool s0;
    RangeMath.Decimals dec = RangeMath.Decimals({feed: 8, stock: 18, usd: 6});

    function stockFirst() internal pure virtual returns (bool);

    function setUp() public virtual {
        vm.warp(SAT - 1 days + 12 hours); // Friday noon
        deployFreshManagerAndRouters();

        stock = new MockStockToken(address(this), "Tesla", "TSLA");
        address usdAt = stockFirst() ? address(uint160(type(uint160).max - 0xF0000)) : address(uint160(0xF0000));
        deployCodeTo("MockUSDG.sol:MockUSDG", abi.encode(address(this)), usdAt);
        usd = MockUSDG(usdAt);
        s0 = address(stock) < address(usd);
        assertEq(s0, stockFirst(), "orientation setup");

        feed = new MockFeed(address(this), 8, "TSLA / USD", int256(P0));
        feed.setAnswerAt(int256(P0), SAT - 4 hours); // Friday 20:00 UTC close print
        clock = new SessionClock(address(this), 0);

        (Currency c0, Currency c1) = s0
            ? (Currency.wrap(address(stock)), Currency.wrap(address(usd)))
            : (Currency.wrap(address(usd)), Currency.wrap(address(stock)));
        key = PoolKey(c0, c1, 3000, 60, IHooks(address(0)));
        manager.initialize(key, RangeMath.usdToSqrtPriceX96(P0, dec, s0, false));

        // market makers: wide two-sided liquidity around $30 (~$10 .. ~$90)
        stock.mint(address(this), 1e30);
        usd.mint(address(this), 1e30);
        stock.approve(address(swapRouter), type(uint256).max);
        usd.approve(address(swapRouter), type(uint256).max);
        stock.approve(address(modifyLiquidityRouter), type(uint256).max);
        usd.approve(address(modifyLiquidityRouter), type(uint256).max);
        int24 a = RangeMath.usdToTick(10e8, dec, s0);
        int24 b = RangeMath.usdToTick(90e8, dec, s0);
        (int24 lo, int24 hi) = a < b ? (a, b) : (b, a);
        modifyLiquidityRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: RangeMath.floorToSpacing(lo, 60),
                tickUpper: RangeMath.ceilToSpacing(hi, 60),
                liquidityDelta: 1e17,
                salt: 0
            }),
            ""
        );

        vault = new OffmintVault(
            OffmintVault.Config({
                poolManager: manager,
                clock: ISessionClock(address(clock)),
                feed: AggregatorV3Interface(address(feed)),
                sequencerFeed: AggregatorV3Interface(address(0)),
                stock: IERC20(address(stock)),
                usdg: IERC20(address(usd)),
                poolKey: key,
                owner: owner,
                keeper: keeperAddr,
                feeRecipient: feeTo,
                ticker: "TSLA"
            })
        );

        _deposit(alice, 100e18);
    }

    // ------------------------------------------------------------------ helpers

    function _deposit(address who, uint256 amt) internal returns (uint256 shares) {
        stock.mint(who, amt);
        vm.startPrank(who);
        stock.approve(address(vault), amt);
        shares = vault.deposit(amt, who);
        vm.stopPrank();
    }

    function _poolUsd() internal view returns (uint256) {
        (uint160 sp,,,) = manager.getSlot0(key.toId());
        return RangeMath.sqrtPriceX96ToUsd(sp, dec, s0);
    }

    /// @dev Trade the pool to `usdAnswer` (8 dec) with an unbounded exact-input swap and a price limit.
    function _moveTo(uint256 usdAnswer) internal {
        uint160 target = RangeMath.usdToSqrtPriceX96(usdAnswer, dec, s0, false);
        (uint160 sp,,,) = manager.getSlot0(key.toId());
        if (target == sp) return;
        swapRouter.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: target < sp, amountSpecified: -1e30, sqrtPriceLimitX96: target}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function _arm() internal {
        vm.warp(SAT + 20 minutes);
        vm.prank(keeperAddr);
        vault.arm(1000, 5000, 3000);
    }

    /// @dev Monday reopen: feed prints `fresh` at 00:10, then time moves to the settle-able point.
    function _reopen(uint256 fresh) internal {
        vm.warp(MON + 10 minutes);
        feed.setAnswer(int256(fresh));
        vm.warp(MON + 1 hours);
    }

    function _pps() internal view returns (uint256) {
        return vault.convertToAssets(1e21);
    }

    function _settle() internal {
        vm.prank(keeperAddr);
        vault.settle(0);
    }
}

abstract contract VaultTestBase is VaultSetup {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    // ================================================================== arm

    function test_arm_rangeIsSingleSidedAndAbovePremium() public {
        _arm();
        OffmintVault.Epoch memory e = vault.currentEpoch();
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.ARMED));
        assertEq(e.p0, P0);
        assertApproxEqRel(e.stockDeployed, 30e18, 1e12, "30% deployed (liquidity rounding dust)");
        assertEq(stock.balanceOf(address(vault)), 100e18 - e.stockDeployed);
        assertEq(usd.balanceOf(address(vault)), 0);
        uint256 minUsd = P0 * 11_000 / 10_000;
        (, int24 cur,,) = manager.getSlot0(key.toId());
        if (s0) {
            assertGt(e.tickLower, cur);
            assertGe(RangeMath.tickToUsd(e.tickLower, dec, true), minUsd);
        } else {
            assertLe(e.tickUpper, cur);
            assertGe(RangeMath.tickToUsd(e.tickUpper, dec, false), minUsd);
        }
        // totalAssets still counts the deployed stock while the position is live
        assertApproxEqRel(vault.totalAssets(), 100e18, 1e12);
    }

    function test_arm_reverts_wrongState() public {
        _arm();
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.WrongState.selector);
        vault.arm(1000, 5000, 3000);
    }

    function test_arm_reverts_notWindow() public {
        vm.warp(SAT - 1 hours);
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.NotWindow.selector);
        vault.arm(1000, 5000, 3000);
    }

    function test_arm_reverts_tooEarly() public {
        vm.warp(SAT + 4 minutes);
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.TooEarly.selector);
        vault.arm(1000, 5000, 3000);
    }

    function test_arm_reverts_oracleNotFrozen() public {
        vm.warp(SAT + 10 minutes);
        feed.setAnswer(int256(P0)); // printed just now
        vm.warp(SAT + 20 minutes);
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.OracleNotFrozen.selector);
        vault.arm(1000, 5000, 3000);
    }

    function test_arm_reverts_staleClose() public {
        feed.setAnswerAt(int256(P0), SAT - 7 hours); // holiday Friday: last print too old
        vm.warp(SAT + 20 minutes);
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.OracleStale.selector);
        vault.arm(1000, 5000, 3000);
    }

    function test_arm_reverts_oraclePaused() public {
        stock.setOraclePaused(true);
        vm.warp(SAT + 20 minutes);
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.OraclePaused.selector);
        vault.arm(1000, 5000, 3000);
    }

    function test_arm_reverts_nonPositiveAnswer() public {
        feed.setAnswerAt(0, SAT - 4 hours);
        vm.warp(SAT + 20 minutes);
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.OracleStale.selector);
        vault.arm(1000, 5000, 3000);
    }

    function test_arm_reverts_paramBounds() public {
        vm.warp(SAT + 20 minutes);
        vm.startPrank(keeperAddr);
        vm.expectRevert(OffmintVault.ParamOutOfBounds.selector);
        vault.arm(999, 5000, 3000); // less conservative than default premium
        vm.expectRevert(OffmintVault.ParamOutOfBounds.selector);
        vault.arm(1000, 10_001, 3000);
        vm.expectRevert(OffmintVault.ParamOutOfBounds.selector);
        vault.arm(1000, 999, 3000);
        vm.expectRevert(OffmintVault.ParamOutOfBounds.selector);
        vault.arm(1000, 5000, 3001); // deploys more than default
        vm.expectRevert(OffmintVault.ParamOutOfBounds.selector);
        vault.arm(1000, 5000, 0);
        vm.stopPrank();
    }

    function test_arm_keeperOnlyBeforeGrace_thenAnyoneWithDefaults() public {
        vm.warp(SAT + 20 minutes);
        vm.prank(rando);
        vm.expectRevert(OffmintVault.NotKeeper.selector);
        vault.arm(5000, 1000, 100);
        vm.warp(SAT + 2 hours);
        vm.prank(rando);
        vault.arm(5000, 1000, 100); // args ignored -> defaults
        OffmintVault.Epoch memory e = vault.currentEpoch();
        assertApproxEqRel(e.stockDeployed, 30e18, 1e12, "default deployBps");
        uint256 lowUsd = s0 ? RangeMath.tickToUsd(e.tickLower, dec, true) : RangeMath.tickToUsd(e.tickUpper, dec, false);
        assertApproxEqRel(lowUsd, P0 * 11 / 10, 0.01e18, "default premium");
    }

    function test_arm_conservativeKeeperParams() public {
        vm.warp(SAT + 20 minutes);
        vm.prank(keeperAddr);
        vault.arm(2000, 3000, 1000);
        OffmintVault.Epoch memory e = vault.currentEpoch();
        assertApproxEqRel(e.stockDeployed, 10e18, 1e12);
        uint256 lowUsd = s0 ? RangeMath.tickToUsd(e.tickLower, dec, true) : RangeMath.tickToUsd(e.tickUpper, dec, false);
        assertGe(lowUsd, P0 * 12 / 10);
    }

    function test_arm_poolAlreadyAboveThreshold_sellsOnlyAboveMarket() public {
        _moveTo(P0 * 13 / 10); // weekend premium already +30% when we arm
        _arm();
        OffmintVault.Epoch memory e = vault.currentEpoch();
        uint256 lowUsd = s0 ? RangeMath.tickToUsd(e.tickLower, dec, true) : RangeMath.tickToUsd(e.tickUpper, dec, false);
        assertGe(lowUsd * 10_001 / 10_000, _poolUsd(), "band starts at/above market");
        assertEq(usd.balanceOf(address(vault)), 0);
    }

    function test_arm_oncePerWindow() public {
        _arm();
        vm.warp(MON + 97 hours);
        vault.emergencyUnwind(); // no fills -> OPEN again
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN));
        // next Saturday is a new window and works
        feed.setAnswerAt(int256(P0), SAT + 7 days - 4 hours);
        vm.warp(SAT + 7 days + 20 minutes);
        vm.prank(keeperAddr);
        vault.arm(1000, 5000, 3000);
        assertEq(vault.epochCount(), 2);
    }

    // ================================================================== ERC-4626 gating

    function test_depositsAndWithdrawalsDisabledWhileArmed() public {
        _arm();
        assertEq(vault.maxDeposit(bob), 0);
        assertEq(vault.maxMint(bob), 0);
        assertEq(vault.maxWithdraw(alice), 0);
        assertEq(vault.maxRedeem(alice), 0);
        stock.mint(bob, 1e18);
        vm.startPrank(bob);
        stock.approve(address(vault), 1e18);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 1e18, 0));
        vault.deposit(1e18, bob);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxRedeem.selector, alice, 1, 0));
        vault.redeem(1, alice, alice);
    }

    function test_depositsPausedByOwner() public {
        vm.prank(owner);
        vault.setDepositsPaused(true);
        assertEq(vault.maxDeposit(bob), 0);
        assertGt(vault.maxRedeem(alice), 0, "withdrawals unaffected");
    }

    function test_inflationAttackFails() public {
        // fresh vault, attacker front-runs the first depositor with 1 wei + a large donation
        OffmintVault v = new OffmintVault(
            OffmintVault.Config({
                poolManager: manager,
                clock: ISessionClock(address(clock)),
                feed: AggregatorV3Interface(address(feed)),
                sequencerFeed: AggregatorV3Interface(address(0)),
                stock: IERC20(address(stock)),
                usdg: IERC20(address(usd)),
                poolKey: key,
                owner: owner,
                keeper: keeperAddr,
                feeRecipient: feeTo,
                ticker: "TSLA"
            })
        );
        address attacker = makeAddr("attacker");
        stock.mint(attacker, 1000e18 + 1);
        vm.startPrank(attacker);
        stock.approve(address(v), 1);
        v.deposit(1, attacker);
        stock.transfer(address(v), 1000e18);
        vm.stopPrank();

        stock.mint(bob, 100e18);
        vm.startPrank(bob);
        stock.approve(address(v), 100e18);
        uint256 shares = v.deposit(100e18, bob);
        assertGt(shares, 0, "victim got shares");
        uint256 back = v.redeem(shares, bob, bob);
        vm.stopPrank();
        assertGe(back, 99e18, "victim loses < 1%");

        uint256 ash = v.balanceOf(attacker);
        vm.prank(attacker);
        uint256 attackerBack = v.redeem(ash, attacker, attacker);
        uint256 attackerLoss = 1000e18 + 1 - attackerBack;
        uint256 victimLoss = 100e18 - back;
        assertGt(attackerLoss, victimLoss * 100, "attack is deeply unprofitable");
    }

    // ================================================================== full cycles

    /// Weekend squeeze clears the band, `lock` keeps the USDG, reopen at P0*1.02, buyback -> more STOCK per share.
    function test_cycle_profit_lockOnFill() public {
        uint256 ppsBefore = _pps();
        _arm();
        _moveTo(P0 * 17 / 10); // squeeze above the band top (P0*1.6)
        vm.prank(rando);
        vault.lock(); // anyone, because the position is fully sold
        OffmintVault.Epoch memory e = vault.currentEpoch();
        assertTrue(e.locked);
        assertLe(e.stockBack, 1e6, "fully sold");
        assertGt(e.usdgReceived, 30 * 33e6, "sold above P0*1.1 on average");

        _moveTo(P0 * 102 / 100); // Monday: mint arbitrage collapses the premium
        _reopen(P0 * 102 / 100);
        _settle();

        e = vault.currentEpoch();
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN));
        assertLe(usd.balanceOf(address(vault)), vault.USDG_DUST());
        assertGt(e.pnlStock, 0);
        assertGt(e.feeStock, 0);
        assertEq(stock.balanceOf(feeTo), e.feeStock, "fee to feeRecipient");
        assertEq(e.feeStock, uint256(e.pnlStock) * 1000 / 10_000);
        assertGt(stock.balanceOf(address(vault)), 100e18 + 5e18, "vault gained > 5 STOCK on 30 deployed");
        assertGt(_pps(), ppsBefore, "share price up");
        // deposits re-enabled
        assertGt(vault.maxDeposit(bob), 0);
    }

    /// Partial fill inside the band, anyone locks 15 min before reopen, then buyback.
    function test_cycle_profit_lockPreOpen() public {
        _arm();
        _moveTo(P0 * 13 / 10);
        vm.warp(MON - 20 minutes);
        vm.expectRevert(OffmintVault.TooEarly.selector);
        vault.lock();
        vm.warp(MON - 15 minutes);
        vm.prank(rando);
        vault.lock();
        OffmintVault.Epoch memory e = vault.currentEpoch();
        assertGt(e.stockBack, 0);
        assertGt(e.usdgReceived, 0);
        _moveTo(P0);
        _reopen(P0);
        _settle();
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN));
        assertGt(vault.currentEpoch().pnlStock, 0);
    }

    /// SPEC-as-written path (no lock): the spike reverses before settle, the range order buys the STOCK back
    /// inside the band, and the epoch ends ~flat (only LP fees). Documents docs/FACTS.md finding.
    function test_cycle_noLock_spikeReverts_endsFlat() public {
        _arm();
        _moveTo(P0 * 17 / 10);
        _moveTo(P0 * 102 / 100);
        _reopen(P0 * 102 / 100);
        _settle();
        OffmintVault.Epoch memory e = vault.currentEpoch();
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN));
        assertGe(e.pnlStock, 0, "fees only");
        assertLt(e.pnlStock, 1e18, "no premium captured");
    }

    /// No fills: settle returns the deployed STOCK (minus <= 2 wei rounding) and the vault reopens.
    function test_cycle_noFill() public {
        _arm();
        _reopen(P0);
        _settle();
        OffmintVault.Epoch memory e = vault.currentEpoch();
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN));
        assertEq(e.stockBought, 0);
        assertEq(e.usdgReceived, 0);
        assertApproxEqAbs(stock.balanceOf(address(vault)), 100e18, 2);
        assertEq(e.feeStock, 0);
        // withdraw works again
        uint256 sh = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(sh, alice, alice);
        assertApproxEqAbs(out, 100e18, 2);
    }

    /// Monday gap-up: fresh price P0*1.5; buyback stops at the cap -> PENDING_BUYBACK -> price eases -> retry -> OPEN.
    function test_cycle_gapUp_pendingThenRetry() public {
        _arm();
        _moveTo(P0 * 17 / 10);
        vault.lock();
        _moveTo(P0 * 15 / 10);
        _reopen(P0 * 15 / 10);
        // small float at the cap: move pool to just under the cap so the buyback can't finish
        _moveTo(P0 * 15 / 10 * 10_099 / 10_000);
        _settle();
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.PENDING_BUYBACK));
        OffmintVault.Epoch memory e = vault.currentEpoch();
        assertGt(e.usdgLeft, vault.USDG_DUST());
        uint256 cap = P0 * 15 / 10 * 10_100 / 10_000;
        assertLe(_poolUsd(), cap + cap / 10_000, "stopped at cap");

        // deposits/withdrawals still disabled
        assertEq(vault.maxRedeem(alice), 0);

        // sellers arrive, oracle stays fresh
        _moveTo(P0 * 14 / 10);
        vm.warp(block.timestamp + 30 minutes);
        feed.setAnswer(int256(P0 * 14 / 10));
        vm.prank(rando);
        vault.retryBuyback(0);
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN));
        assertLe(usd.balanceOf(address(vault)), vault.USDG_DUST());
    }

    /// Oracle never comes back: emergencyUnwind after 96h, expireBuyback after 48h, pro-rata STOCK+USDG exits.
    function test_cycle_emergency_expire_redeemMixed() public {
        _deposit(bob, 100e18);
        _arm();
        _moveTo(P0 * 13 / 10);
        vm.warp(MON + 95 hours);
        vm.expectRevert(OffmintVault.TooEarly.selector);
        vault.emergencyUnwind();
        vm.warp(MON + 96 hours);
        vm.prank(rando);
        vault.emergencyUnwind();
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.PENDING_BUYBACK));

        vm.expectRevert(OffmintVault.TooEarly.selector);
        vault.expireBuyback();
        vm.warp(block.timestamp + 48 hours + 1);
        vm.expectRevert(OffmintVault.WrongState.selector);
        vault.retryBuyback(0); // retry window over while PENDING
        vault.expireBuyback();
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN_MIXED));
        assertEq(vault.maxDeposit(bob), 0);

        uint256 stockBal = stock.balanceOf(address(vault));
        uint256 usdBal = usd.balanceOf(address(vault));
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        (uint256 so, uint256 uo) = vault.redeemMixed(aliceShares, alice);
        assertApproxEqRel(so, stockBal / 2, 1e15);
        assertApproxEqRel(uo, usdBal / 2, 1e15);
        assertEq(stock.balanceOf(alice), so);
        assertEq(usd.balanceOf(alice), uo);
    }

    /// OPEN_MIXED returns to OPEN once someone completes the buyback with a fresh oracle.
    function test_openMixed_retryRestoresOpen() public {
        _arm();
        _moveTo(P0 * 13 / 10);
        vm.warp(MON + 96 hours);
        vault.emergencyUnwind();
        vm.warp(block.timestamp + 48 hours + 1);
        vault.expireBuyback();
        _moveTo(P0);
        feed.setAnswer(int256(P0));
        vault.retryBuyback(0);
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN));
        assertEq(vault.currentEpoch().feeStock, 0, "no fee after OPEN_MIXED");
    }

    /// Attacker pumps the pool right before settle: the buyback stops at feed*(1+1%), never pays more.
    function test_settle_sandwich_boundedByCap() public {
        _arm();
        _moveTo(P0 * 17 / 10);
        vault.lock();
        uint256 usdIn = usd.balanceOf(address(vault));
        _moveTo(P0);
        _reopen(P0);
        _moveTo(P0 * 1005 / 1000); // attacker front-run
        uint256 before = stock.balanceOf(address(vault));
        _settle();
        OffmintVault.Epoch memory e = vault.currentEpoch();
        uint256 spent = usdIn - usd.balanceOf(address(vault));
        assertGt(e.stockBought, 0);
        // avg price paid (USD, 8 dec) = spent(6 dec) * 1e20 / bought(18 dec); must be <= cap incl. 0.3% LP fee
        uint256 avg = spent * 1e20 / e.stockBought;
        uint256 cap = P0 * 10_100 / 10_000;
        assertLe(avg, cap * 1_000_000 / 997_000 + 1, "effective price within cap + LP fee");
        assertLe(_poolUsd(), cap + cap / 10_000, "pool not pushed past cap");
        assertGt(stock.balanceOf(address(vault)), before);
    }

    // ================================================================== settle / lock reverts

    function test_settle_reverts_tooEarly() public {
        _arm();
        vm.warp(MON + 59 minutes);
        feed.setAnswer(int256(P0));
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.TooEarly.selector);
        vault.settle(0);
    }

    function test_settle_reverts_staleOracle() public {
        _arm();
        vm.warp(MON + 1 hours); // feed still frozen at Friday close
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.OracleStale.selector);
        vault.settle(0);
        // printed after reopen but too long ago
        vm.warp(MON + 5 minutes);
        feed.setAnswer(int256(P0));
        vm.warp(MON + 2 hours);
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.OracleStale.selector);
        vault.settle(0);
    }

    function test_settle_reverts_oraclePaused() public {
        _arm();
        _reopen(P0);
        stock.setOraclePaused(true);
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.OraclePaused.selector);
        vault.settle(0);
    }

    function test_settle_keeperOnlyBeforeGrace_thenAnyone() public {
        _arm();
        _reopen(P0);
        vm.prank(rando);
        vm.expectRevert(OffmintVault.NotKeeper.selector);
        vault.settle(0);
        vm.warp(MON + 7 hours - 1);
        vm.prank(rando);
        vm.expectRevert(OffmintVault.NotKeeper.selector);
        vault.settle(0);
        vm.warp(MON + 7 hours);
        feed.setAnswer(int256(P0));
        vm.prank(rando);
        vault.settle(type(uint256).max); // minStockOut ignored for permissionless calls
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN));
    }

    function test_settle_keeperMinStockOut() public {
        _arm();
        _moveTo(P0 * 17 / 10);
        vault.lock();
        _moveTo(P0);
        _reopen(P0);
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.SlippageMinOut.selector);
        vault.settle(1_000e18);
    }

    function test_lock_reverts() public {
        vm.expectRevert(OffmintVault.WrongState.selector);
        vault.lock();
        _arm();
        _moveTo(P0 * 13 / 10); // in band, not fully sold, not near reopen
        vm.expectRevert(OffmintVault.TooEarly.selector);
        vault.lock();
        _moveTo(P0 * 17 / 10);
        vault.lock();
        vm.expectRevert(OffmintVault.WrongState.selector);
        vault.lock();
    }

    function test_unlockCallback_onlyPoolManager() public {
        vm.expectRevert(OffmintVault.OnlyPoolManager.selector);
        vault.unlockCallback(abi.encode(OffmintVault.Action.RETRY, abi.encode(uint160(1))));
    }

    // ================================================================== admin / funds safety

    function test_ownerAndKeeperNeverReceiveFunds() public {
        uint256 o0 = stock.balanceOf(owner) + usd.balanceOf(owner);
        uint256 k0 = stock.balanceOf(keeperAddr) + usd.balanceOf(keeperAddr);
        _arm();
        _moveTo(P0 * 17 / 10);
        vm.prank(keeperAddr);
        vault.lock();
        _moveTo(P0);
        _reopen(P0);
        _settle();
        assertEq(stock.balanceOf(owner) + usd.balanceOf(owner), o0);
        assertEq(stock.balanceOf(keeperAddr) + usd.balanceOf(keeperAddr), k0);
        assertGt(stock.balanceOf(feeTo), 0);
    }

    function test_setParams_bounds() public {
        OffmintVault.Params memory p = _params();
        vm.prank(rando);
        vm.expectRevert();
        vault.setParams(p);

        vm.startPrank(owner);
        vault.setParams(p);
        p.defaultPremiumBps = 499;
        _expectBad(p);
        p = _params();
        p.defaultWidthBps = 10_001;
        _expectBad(p);
        p = _params();
        p.defaultDeployBps = 5001;
        _expectBad(p);
        p = _params();
        p.buybackSlippageBps = 301;
        _expectBad(p);
        p = _params();
        p.perfFeeBps = 2001;
        _expectBad(p);
        p = _params();
        p.settleDelay = 29 minutes;
        _expectBad(p);
        p = _params();
        p.maxFreshAge = 2 hours + 1;
        _expectBad(p);
        p = _params();
        p.armGrace = 12 hours + 1;
        _expectBad(p);
        p = _params();
        p.settleGrace = 12 hours + 1;
        _expectBad(p);
        vm.stopPrank();
    }

    function test_setKeeper_cannotBeFeeRecipient() public {
        vm.startPrank(owner);
        vault.setKeeper(bob);
        assertEq(vault.keeper(), bob);
        vm.expectRevert(OffmintVault.BadConfig.selector);
        vault.setKeeper(feeTo);
        vm.expectRevert(OffmintVault.BadConfig.selector);
        vault.setKeeper(address(0));
        vm.stopPrank();
    }

    function test_constructor_rejectsHookedPoolAndBadFeeRecipient() public {
        PoolKey memory hooked = key;
        hooked.hooks = IHooks(address(0x1234));
        OffmintVault.Config memory c = OffmintVault.Config({
            poolManager: manager,
            clock: ISessionClock(address(clock)),
            feed: AggregatorV3Interface(address(feed)),
            sequencerFeed: AggregatorV3Interface(address(0)),
            stock: IERC20(address(stock)),
            usdg: IERC20(address(usd)),
            poolKey: hooked,
            owner: owner,
            keeper: keeperAddr,
            feeRecipient: feeTo,
            ticker: "TSLA"
        });
        vm.expectRevert(OffmintVault.BadConfig.selector);
        new OffmintVault(c);
        c.poolKey = key;
        c.feeRecipient = owner;
        vm.expectRevert(OffmintVault.BadConfig.selector);
        new OffmintVault(c);
    }

    function test_metadata() public view {
        assertEq(vault.name(), "Offmint TSLA");
        assertEq(vault.symbol(), "omTSLA");
        assertEq(vault.decimals(), 21);
        assertEq(vault.stockIsCurrency0(), s0);
    }

    function _params() internal view returns (OffmintVault.Params memory) {
        return vault.getParams();
    }

    function _expectBad(OffmintVault.Params memory p) internal {
        vm.expectRevert(OffmintVault.ParamOutOfBounds.selector);
        vault.setParams(p);
    }
}

contract VaultS0Test is VaultTestBase {
    function stockFirst() internal pure override returns (bool) {
        return true;
    }
}

contract VaultS1Test is VaultTestBase {
    function stockFirst() internal pure override returns (bool) {
        return false;
    }
}

/// @dev Sequencer uptime feed checks (SPEC §4.3), when one is configured.
contract VaultSequencerTest is VaultSetup {
    MockFeed seq;

    function stockFirst() internal pure override returns (bool) {
        return true;
    }

    function setUp() public override {
        super.setUp();
        seq = new MockFeed(address(this), 0, "sequencer", 0);
        seq.setAnswerAt(0, SAT - 10 days); // up for a long time
        vault = new OffmintVault(
            OffmintVault.Config({
                poolManager: manager,
                clock: ISessionClock(address(clock)),
                feed: AggregatorV3Interface(address(feed)),
                sequencerFeed: AggregatorV3Interface(address(seq)),
                stock: IERC20(address(stock)),
                usdg: IERC20(address(usd)),
                poolKey: key,
                owner: owner,
                keeper: keeperAddr,
                feeRecipient: feeTo,
                ticker: "TSLA"
            })
        );
        _deposit(alice, 100e18);
    }

    function test_sequencerDown() public {
        vm.warp(SAT + 20 minutes);
        seq.setAnswerAt(1, SAT - 10 days); // status 1 = down
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.SequencerDown.selector);
        vault.arm(1000, 5000, 3000);
    }

    function test_sequencerGracePeriod() public {
        vm.warp(SAT + 20 minutes);
        seq.setAnswerAt(0, SAT); // came back up 20 minutes ago (< 1h grace)
        vm.prank(keeperAddr);
        vm.expectRevert(OffmintVault.SequencerDown.selector);
        vault.arm(1000, 5000, 3000);
        vm.warp(SAT + 1 hours + 1);
        vm.prank(keeperAddr);
        vault.arm(1000, 5000, 3000);
    }
}
