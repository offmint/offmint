// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

import {OffmintVault} from "../src/OffmintVault.sol";
import {MetaVault, IVaultRegistry} from "../src/MetaVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {SessionClock} from "../src/clock/SessionClock.sol";
import {ManualSessionClock} from "../src/clock/ManualSessionClock.sol";
import {RangeMath} from "../src/libraries/RangeMath.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {ISessionClock} from "../src/interfaces/ISessionClock.sol";
import {ChainlinkPriceReference} from "../src/oracle/ChainlinkPriceReference.sol";
import {PushPriceReference} from "../src/oracle/PushPriceReference.sol";

/// @notice M3.5 acceptance (SPEC §11): MetaVault weekly cycle on top of factory-deployed OffmintVaults.
///         Ticker A: stock = currency0, Chainlink reference. Ticker B: stock = currency1, push reference.
contract MetaVaultTest is Deployers {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint256 constant SAT = 1790380800; // Sat 26 Sep 2026 00:00 UTC
    uint256 constant MON = SAT + 2 days;
    uint256 constant THU = SAT - 36 hours; // Thursday noon
    uint256 constant PA = 30e8;
    uint256 constant PB = 20e8;
    uint256 constant BPS = 10_000;

    address owner = makeAddr("owner");
    address keeperAddr = makeAddr("keeper");
    address feeTo = makeAddr("feeTo");
    address poster = makeAddr("poster");
    address refOwner = makeAddr("refOwner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address rando = makeAddr("rando");

    struct T {
        MockStockToken stock;
        PoolKey key;
        bool s0;
        OffmintVault vault; // MetaVault's exclusive instance (mb)
        OffmintVault community; // open instance (ob)
        bool push;
    }

    MockUSDG usd;
    MockFeed feedA;
    SessionClock clock;
    VaultFactory factory;
    MetaVault meta;
    T a;
    T b;
    RangeMath.Decimals dec = RangeMath.Decimals({feed: 8, stock: 18, usd: 6});

    function setUp() public {
        vm.warp(THU);
        deployFreshManagerAndRouters();
        address usdAt = address(uint160(1) << 159);
        deployCodeTo("MockUSDG.sol:MockUSDG", abi.encode(address(this)), usdAt);
        usd = MockUSDG(usdAt);
        clock = new SessionClock(address(this), 0);
        feedA = new MockFeed(address(this), 8, "AAA / USD", int256(PA));

        a.stock = _stockAt(address(uint160(0xA0000)), "AAA");
        b.stock = _stockAt(address(uint160(type(uint160).max - 0xB0000)), "BBB");
        a.key = _pool(a, PA);
        b.key = _pool(b, PB);
        assertTrue(a.s0 && !b.s0, "orientations");

        factory = new VaultFactory(
            keccak256(type(OffmintVault).creationCode),
            VaultFactory.Wiring({
                poolManager: manager,
                clock: ISessionClock(address(clock)),
                usdg: IERC20(address(usd)),
                vaultOwner: owner,
                keeper: keeperAddr,
                feeRecipient: feeTo,
                poster: poster,
                refOwner: refOwner,
                sequencerFeed: address(0)
            }),
            owner
        );
        _uploadCode();
        vm.startPrank(owner);
        factory.setListing(address(a.stock), VaultFactory.Listing(true, address(feedA), 3000, 60));
        factory.setListing(address(b.stock), VaultFactory.Listing(true, address(0), 3000, 60));
        vm.stopPrank();
        meta = new MetaVault(
            IERC20(address(usd)), manager, ISessionClock(address(clock)), factory, owner, keeperAddr, feeTo
        );
        vm.startPrank(owner);
        a.vault = OffmintVault(factory.deployVault(address(a.stock), address(meta)));
        b.vault = OffmintVault(factory.deployVault(address(b.stock), address(meta)));
        a.community = OffmintVault(factory.deployVault(address(a.stock), address(0)));
        b.community = OffmintVault(factory.deployVault(address(b.stock), address(0)));
        vm.stopPrank();
        b.push = true;
        _print(b, PB, THU);
        _depositUsd(alice, 100_000e6);
    }

    // ================================================================== full cycle

    function test_fullCycle_squeeze_navUp_A() public {
        _fullCycleSqueeze(a, PA);
    }

    function test_fullCycle_squeeze_navUp_B() public {
        _fullCycleSqueeze(b, PB);
    }

    function _fullCycleSqueeze(T storage t, uint256 p0) internal {
        uint256 nav0 = meta.totalAssets();
        assertEq(meta.openPositionCount(), 0, "IDLE");

        // SELECT + BUY-IN (Thu)
        _buyIn(t, nav0 * 3000 / BPS);
        assertEq(meta.openPositionCount(), 1, "CYCLE_ACTIVE");
        assertEq(meta.maxDeposit(bob), 0);
        assertEq(meta.maxWithdraw(alice), 0);

        // ARM (Fri commit -> Sat arm by the sub-vault keeper)
        vm.warp(SAT - 6 hours);
        vm.prank(keeperAddr);
        meta.commit(address(t.stock));
        vm.warp(SAT + 20 minutes);
        _closePrint(t, p0);
        vm.prank(keeperAddr);
        t.vault.arm(_ladder(), 3000);

        // weekend squeeze to +30%, lock; Monday back to P0, settle
        _moveTo(t, p0 * 130 / 100);
        t.vault.lock();
        _reopen(t, p0);
        vm.prank(keeperAddr);
        t.vault.settle(0);
        assertEq(uint8(t.vault.state()), uint8(OffmintVault.State.OPEN));

        // UNWIND (anyone) -> IDLE
        vm.prank(rando);
        meta.unwind(address(t.stock));
        assertEq(meta.openPositionCount(), 0, "IDLE again");
        assertGt(meta.totalAssets(), nav0, "NAV up on a squeeze");
        assertGt(meta.maxWithdraw(alice), 0, "withdrawals reopen");
        emit log_named_decimal_uint("NAV change bps", (meta.totalAssets() - nav0) * BPS / nav0, 0);
    }

    function test_noSqueeze_lossCappedByAlloc() public {
        uint256 nav0 = meta.totalAssets();
        _buyIn(a, nav0 * 3000 / BPS);
        vm.warp(SAT - 6 hours);
        vm.prank(keeperAddr);
        meta.commit(address(a.stock));
        _closePrint(a, PA);
        vm.warp(SAT + 20 minutes);
        vm.prank(keeperAddr);
        a.vault.arm(_ladder(), 3000);
        // quiet weekend; Monday -5%
        uint256 p1 = PA * 95 / 100;
        _moveTo(a, p1);
        _reopen(a, p1);
        vm.prank(keeperAddr);
        a.vault.settle(0);
        meta.unwind(address(a.stock));

        uint256 nav1 = meta.totalAssets();
        assertLt(nav1, nav0, "a no-squeeze -5% week is a loss");
        // bounded by alloc x (move + unwind slippage + pool fees)
        uint256 maxLoss = nav0 * 3000 / BPS * (500 + 100 + 60) / BPS;
        assertLe(nav0 - nav1, maxLoss, "loss capped by allocBps");
        assertEq(meta.blacklistedUntil(address(a.stock)), 0, "under weeklyLossCapBps");
    }

    // ================================================================== stop-loss

    function test_stopLoss_firesAndLossReachesBlacklist() public {
        _buyIn(b, 10_000e6);
        vm.warp(THU + 6 hours);
        // -5%: not triggered
        _print(b, PB * 95 / 100, block.timestamp);
        vm.expectRevert(MetaVault.NotTriggered.selector);
        meta.triggerEarlyUnwind(address(b.stock));

        // -20% (reference and pool)
        vm.warp(THU + 7 hours);
        uint256 px = PB * 80 / 100;
        _print(b, px, block.timestamp);
        _moveTo(b, px);
        vm.prank(rando);
        meta.triggerEarlyUnwind(address(b.stock));

        assertEq(meta.openPositionCount(), 0, "stopped out and closed");
        assertGt(meta.blacklistedUntil(address(b.stock)), block.timestamp, "loss > weeklyLossCapBps -> blacklisted");
        vm.warp(block.timestamp + 1 days);
        _print(b, px, block.timestamp);
        vm.prank(keeperAddr);
        vm.expectRevert(MetaVault.Blacklisted.selector);
        meta.buyIn(address(b.stock), 1000e6);
    }

    function test_stopLoss_onlyBeforeCommit() public {
        _buyIn(a, 10_000e6);
        vm.warp(SAT - 6 hours);
        vm.prank(keeperAddr);
        meta.commit(address(a.stock));
        feedA.setAnswerAt(int256(PA / 2), block.timestamp);
        vm.expectRevert(MetaVault.WrongState.selector);
        meta.triggerEarlyUnwind(address(a.stock));
    }

    function test_stopLoss_refusesWhileOraclePaused_A() public {
        _buyIn(a, 10_000e6);
        feedA.setAnswerAt(int256(PA / 2), block.timestamp);
        a.stock.setOraclePaused(true);
        vm.expectRevert(ChainlinkPriceReference.OraclePaused.selector);
        meta.triggerEarlyUnwind(address(a.stock));
        a.stock.setOraclePaused(false);
        meta.triggerEarlyUnwind(address(a.stock)); // fires once unpaused
    }

    function test_stopLoss_refusesWhileHalted_B() public {
        _buyIn(b, 10_000e6);
        PushPriceReference r = PushPriceReference(address(b.vault.priceRef()));
        vm.warp(block.timestamp + 60);
        vm.prank(poster);
        r.post(PB * 80 / 100, block.timestamp, true); // trading halt
        vm.expectRevert(PushPriceReference.OraclePaused.selector);
        meta.triggerEarlyUnwind(address(b.stock));

        vm.warp(block.timestamp + 60);
        _print(b, PB * 80 / 100, block.timestamp);
        vm.prank(refOwner);
        r.setOwnerHalt(true);
        vm.expectRevert(PushPriceReference.OraclePaused.selector);
        meta.triggerEarlyUnwind(address(b.stock));
    }

    // ================================================================== buy-in cap

    function test_buyIn_preCheck_refusesAboveCap() public {
        _moveTo(a, PA * 102 / 100); // squeeze already under way (> +1%)
        vm.prank(keeperAddr);
        vm.expectRevert(MetaVault.AboveCap.selector);
        meta.buyIn(address(a.stock), 10_000e6);
    }

    function test_buyIn_sandwich_partialFillsAtCap_A() public {
        _sandwich(a, PA);
    }

    function test_buyIn_sandwich_partialFillsAtCap_B() public {
        _sandwich(b, PB);
    }

    /// @dev Front-run to just under the cap, then a big buy-in: the execution limit stops it at the cap (partial fill);
    ///      no fill is worse than reference x (1 + buyInSlippageBps).
    function _sandwich(T storage t, uint256 p) internal {
        _depositUsd(bob, 5_000_000e6);
        _moveTo(t, p * 10_050 / BPS); // attacker: +0.5%
        uint256 amt = meta.totalAssets() * 3000 / BPS;
        vm.prank(keeperAddr);
        meta.buyIn(address(t.stock), amt);
        MetaVault.BasketPosition memory pos = meta.position(address(t.stock));
        assertLt(pos.usdgSpent, amt, "partial fill");
        uint256 cap = p * (BPS + 100) / BPS;
        assertLe(_poolUsd(t), cap + cap / 1e6, "pool stops at the cap");
        // average fill <= cap + the 0.30% pool fee (the limit bounds the pool price; the LP fee is paid on top)
        assertLe(pos.usdgSpent * 1e20 / pos.stockAmount, cap * (BPS + 30) / BPS, "never worse than the cap");
    }

    function test_buyIn_rules() public {
        vm.prank(rando);
        vm.expectRevert(MetaVault.NotKeeper.selector);
        meta.buyIn(address(a.stock), 1000e6);

        uint256 over = meta.totalAssets() * 3001 / BPS;
        vm.prank(keeperAddr);
        vm.expectRevert(MetaVault.OverAlloc.selector);
        meta.buyIn(address(a.stock), over);

        address noVault = makeAddr("noVault");
        vm.prank(keeperAddr);
        vm.expectRevert(MetaVault.NoVault.selector);
        meta.buyIn(noVault, 1000e6);

        _buyIn(a, 1000e6);
        vm.prank(keeperAddr);
        vm.expectRevert(MetaVault.WrongState.selector);
        meta.buyIn(address(a.stock), 1000e6);

        vm.warp(SAT + 1 hours);
        vm.prank(keeperAddr);
        vm.expectRevert(MetaVault.NotWindow.selector);
        meta.buyIn(address(b.stock), 1000e6);
    }

    function test_buyIn_needsAnUpcomingWindow() public {
        ManualSessionClock mc = new ManualSessionClock(address(this));
        mc.setWindow(THU - 5 days, THU - 3 days); // last weekend only: nothing scheduled ahead
        MetaVault m2 =
            new MetaVault(IERC20(address(usd)), manager, ISessionClock(address(mc)), factory, owner, keeperAddr, feeTo);
        vm.prank(owner);
        factory.deployVault(address(a.stock), address(m2));
        vm.prank(keeperAddr);
        vm.expectRevert(MetaVault.NotWindow.selector);
        m2.buyIn(address(a.stock), 1_000e6);
    }

    function test_buyIn_maxConcurrent() public {
        MetaVault.Params memory p = meta.defaultParams();
        p.maxConcurrent = 1;
        vm.prank(owner);
        meta.setParams(p);
        _buyIn(a, 1000e6);
        vm.prank(keeperAddr);
        vm.expectRevert(MetaVault.TooMany.selector);
        meta.buyIn(address(b.stock), 1000e6);
    }

    function test_buyIn_refusesStaleReference() public {
        vm.warp(THU + 25 hours); // Friday 13:00, last print Thursday noon
        vm.prank(keeperAddr);
        vm.expectRevert(MetaVault.OracleStale.selector);
        meta.buyIn(address(a.stock), 1000e6);
    }

    // ================================================================== NAV (§6.5.1b)

    function test_totalAssets_oneArmedOnePreArm() public {
        _buyIn(a, 20_000e6);
        _buyIn(b, 20_000e6);
        vm.warp(SAT - 6 hours);
        vm.prank(keeperAddr);
        meta.commit(address(a.stock));
        vm.warp(SAT + 20 minutes);
        _closePrint(a, PA);
        _closePrint(b, PB);
        vm.prank(keeperAddr);
        a.vault.arm(_ladder(), 3000);
        assertEq(uint8(a.vault.state()), uint8(OffmintVault.State.ARMED));

        MetaVault.BasketPosition memory pa = meta.position(address(a.stock));
        MetaVault.BasketPosition memory pb = meta.position(address(b.stock));
        assertEq(uint8(pa.phase), uint8(MetaVault.Phase.COMMITTED));
        assertEq(uint8(pb.phase), uint8(MetaVault.Phase.BOUGHT));
        uint256 expected = usd.balanceOf(address(meta)) + a.vault.convertToAssets(pa.obShares) * PA / 1e20
            + pb.stockAmount * PB / 1e20;
        assertApproxEqAbs(meta.totalAssets(), expected, 2, "USDG + armed sub-vault shares + pre-arm STOCK");
    }

    // ================================================================== unwind rules

    function test_unwind_rules() public {
        _buyIn(a, 10_000e6);
        vm.prank(rando);
        vm.expectRevert(MetaVault.TooEarly.selector);
        meta.unwind(address(a.stock)); // not before the weekend, except keeper abort

        vm.warp(SAT - 6 hours);
        vm.prank(keeperAddr);
        meta.commit(address(a.stock));
        _closePrint(a, PA);
        vm.warp(SAT + 20 minutes);
        vm.prank(keeperAddr);
        a.vault.arm(_ladder(), 3000);
        vm.warp(MON + 10 minutes);
        feedA.setAnswer(int256(PA));
        vm.expectRevert(MetaVault.WrongState.selector);
        meta.unwind(address(a.stock)); // sub-vault still ARMED
    }

    function test_unwind_keeperAbortBeforeWeekend() public {
        _buyIn(a, 10_000e6);
        vm.prank(keeperAddr);
        meta.unwind(address(a.stock));
        assertEq(meta.openPositionCount(), 0);
    }

    function test_unwind_neverCommitted_afterWeekend() public {
        _buyIn(b, 10_000e6);
        vm.warp(MON + 1 hours);
        vm.expectRevert(MetaVault.OracleStale.selector); // needs a post-reopen print
        meta.unwind(address(b.stock));
        _print(b, PB, MON + 30 minutes);
        meta.unwind(address(b.stock));
        assertEq(meta.openPositionCount(), 0);
    }

    // ================================================================== txFeeBps

    function test_txFee_depositAndWithdraw() public {
        uint256 fee0 = usd.balanceOf(feeTo);
        uint256 pps0 = meta.convertToAssets(1e12);
        uint256 shares = _depositUsd(bob, 10_050e6);
        assertApproxEqAbs(usd.balanceOf(feeTo) - fee0, 50e6, 1, "0.5% entry fee on the net amount");
        assertApproxEqAbs(meta.convertToAssets(shares), 10_000e6, 1);
        assertEq(meta.convertToAssets(1e12), pps0, "deposit fee does not move share price");

        uint256 maxW = meta.maxWithdraw(bob);
        assertApproxEqAbs(maxW, 10_000e6 * BPS / 10_050, 2);
        vm.prank(bob);
        meta.withdraw(maxW, bob, bob);
        assertApproxEqAbs(usd.balanceOf(feeTo) - fee0, 50e6 + maxW * 50 / BPS, 2, "0.5% exit fee");
        assertLt(usd.balanceOf(bob), 10_050e6, "round trip pays both fees");
        assertEq(meta.balanceOf(bob), 0);
        assertApproxEqAbs(meta.convertToAssets(1e12), pps0, 1, "withdraw fee does not move share price");
    }

    function test_txFee_redeemMatchesPreview() public {
        uint256 shares = _depositUsd(bob, 1_000e6);
        uint256 preview = meta.previewRedeem(shares);
        vm.prank(bob);
        uint256 got = meta.redeem(shares, bob, bob);
        assertEq(got, preview);
        assertEq(usd.balanceOf(bob), got);
    }

    function test_depositsDisabledDuringCycle() public {
        _buyIn(a, 1000e6);
        usd.mint(bob, 1000e6);
        vm.startPrank(bob);
        usd.approve(address(meta), 1000e6);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 1000e6, 0));
        meta.deposit(1000e6, bob);
        vm.stopPrank();
    }

    // ================================================================== params / factory

    function test_params_bounds_and_onlyIdle() public {
        MetaVault.Params memory p = meta.defaultParams();
        p.txFeeBps = 201;
        vm.prank(owner);
        vm.expectRevert(MetaVault.ParamOutOfBounds.selector);
        meta.setParams(p);
        p = meta.defaultParams();
        p.earlyUnwindThresholdBps = 499;
        vm.prank(owner);
        vm.expectRevert(MetaVault.ParamOutOfBounds.selector);
        meta.setParams(p);
        p = meta.defaultParams();
        p.maxConcurrent = 4;
        vm.prank(owner);
        vm.expectRevert(MetaVault.ParamOutOfBounds.selector);
        meta.setParams(p);
        p = meta.defaultParams();
        p.allocBps = 5001;
        vm.prank(owner);
        vm.expectRevert(MetaVault.ParamOutOfBounds.selector);
        meta.setParams(p);

        _buyIn(a, 1000e6);
        p = meta.defaultParams();
        vm.prank(owner);
        vm.expectRevert(MetaVault.WrongState.selector);
        meta.setParams(p);
    }

    function test_keeperCannotTakeFunds() public {
        _buyIn(a, 10_000e6);
        vm.prank(keeperAddr);
        meta.unwind(address(a.stock));
        assertEq(usd.balanceOf(keeperAddr), 0);
        assertEq(a.stock.balanceOf(keeperAddr), 0);
        assertEq(usd.balanceOf(owner), 0);
    }

    function test_factory_wiring() public view {
        assertEq(factory.vaultFor(address(a.stock), address(meta)), address(a.vault));
        assertEq(factory.vaultFor(address(a.stock), address(0)), address(a.community));
        assertEq(factory.allVaults().length, 4);
        assertEq(address(ChainlinkPriceReference(address(a.vault.priceRef())).feed()), address(feedA));
        PushPriceReference pr = PushPriceReference(address(b.vault.priceRef()));
        assertEq(pr.poster(), poster);
        assertEq(pr.owner(), refOwner);
        assertEq(address(b.community.priceRef()), address(pr), "both instances read ONE reference");
        assertEq(address(a.community.priceRef()), address(a.vault.priceRef()));
        assertEq(a.vault.keeper(), keeperAddr);
        assertEq(a.vault.owner(), owner);
        assertEq(a.vault.symbol(), "mbAAA");
        assertEq(a.community.symbol(), "obAAA");
        assertEq(a.vault.restrictedDepositor(), address(meta));
        assertEq(a.community.restrictedDepositor(), address(0));
    }

    function test_factory_rejects() public {
        vm.startPrank(owner);
        vm.expectRevert(VaultFactory.AlreadyDeployed.selector);
        factory.deployVault(address(a.stock), address(meta));
        vm.expectRevert(VaultFactory.AlreadyDeployed.selector);
        factory.deployVault(address(a.stock), address(0));

        MockStockToken c = _stockAt(address(uint160(0xC0000)), "CCC");
        vm.expectRevert(VaultFactory.NotCanonical.selector);
        factory.deployVault(address(c), address(0));

        factory.setListing(address(c), VaultFactory.Listing(true, address(0), 3000, 60));
        vm.expectRevert(VaultFactory.PoolNotInitialized.selector);
        factory.deployVault(address(c), address(0));

        vm.expectRevert(VaultFactory.Sealed.selector);
        factory.uploadVaultCode(hex"00");
        vm.stopPrank();

        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.setListing(address(c), VaultFactory.Listing(true, address(0), 3000, 60));
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", rando));
        factory.deployVault(address(a.stock), rando); // owner-only (no onchain registry to gate it, §6.5.4)
    }

    // ================================================================== restrictedDepositor isolation (§6.1)

    function test_isolation_communityCannotEnterMetaInstance_andViceVersa() public {
        // a community holder cannot deposit (or mint) into MetaVault's instance
        a.stock.mint(bob, 10e18);
        vm.startPrank(bob);
        a.stock.approve(address(a.vault), type(uint256).max);
        vm.expectRevert(OffmintVault.NotDepositor.selector);
        a.vault.deposit(10e18, bob);
        vm.expectRevert(OffmintVault.NotDepositor.selector);
        a.vault.mint(1e21, bob);
        // ...but the community instance is open to them
        a.stock.approve(address(a.community), type(uint256).max);
        a.community.deposit(10e18, bob);
        vm.stopPrank();
        assertGt(a.community.balanceOf(bob), 0);

        // MetaVault's capital goes only into its own instance, never the community one
        _buyIn(a, 10_000e6);
        vm.warp(SAT - 6 hours);
        uint256 communityBefore = a.community.totalAssets();
        vm.prank(keeperAddr);
        meta.commit(address(a.stock));
        assertEq(a.community.totalAssets(), communityBefore, "community instance untouched");
        assertEq(a.community.balanceOf(address(meta)), 0);
        assertGt(a.vault.balanceOf(address(meta)), 0);
        assertEq(a.vault.totalSupply(), a.vault.balanceOf(address(meta)), "MetaVault is the only holder of mb");
    }

    function test_isolation_metaRefusesACommunityInstance() public {
        // a registry that points MetaVault at the community instance is rejected
        FakeRegistry fake = new FakeRegistry(address(a.community));
        MetaVault m2 =
            new MetaVault(IERC20(address(usd)), manager, ISessionClock(address(clock)), fake, owner, keeperAddr, feeTo);
        usd.mint(address(m2), 10_000e6);
        vm.prank(keeperAddr);
        vm.expectRevert(MetaVault.NoVault.selector);
        m2.buyIn(address(a.stock), 1_000e6);
    }

    function test_blacklist_communityInstanceLossBlocksPick() public {
        // community instance: holder deposits, a gap-up weekend loses > weeklyLossCapBps of what it deployed
        a.stock.mint(bob, 100e18);
        vm.startPrank(bob);
        a.stock.approve(address(a.community), type(uint256).max);
        a.community.deposit(100e18, bob);
        vm.stopPrank();
        vm.warp(SAT + 20 minutes);
        _closePrint(a, PA);
        vm.prank(keeperAddr);
        a.community.arm(_ladder(), 3000);
        _moveTo(a, PA * 160 / 100); // everything sold
        a.community.lock();
        // Monday gap-up: fresh print +60%, buyback capped -> STOCK loss on the deployed 30%
        _reopen(a, PA * 160 / 100);
        vm.prank(keeperAddr);
        a.community.settle(0);
        OffmintVault.Epoch memory e = a.community.currentEpoch();
        assertLt(e.pnlStock, 0, "community lost STOCK");
        assertGt(uint256(-e.pnlStock) * BPS, e.stockDeployed * 1000, "more than weeklyLossCapBps of deployed");

        // next week MetaVault may not pick AAA
        vm.warp(MON + 3 days);
        feedA.setAnswerAt(int256(PA * 160 / 100), block.timestamp);
        assertTrue(meta.isBlacklisted(address(a.stock)));
        vm.prank(keeperAddr);
        vm.expectRevert(MetaVault.Blacklisted.selector);
        meta.buyIn(address(a.stock), 1_000e6);
        // ...and after blacklistDays it may again
        vm.warp(MON + 29 days);
        assertFalse(meta.isBlacklisted(address(a.stock)));
    }

    function test_factory_unsealedCodeCannotDeploy() public {
        VaultFactory f = new VaultFactory(
            keccak256("not the vault"),
            VaultFactory.Wiring({
                poolManager: manager,
                clock: ISessionClock(address(clock)),
                usdg: IERC20(address(usd)),
                vaultOwner: owner,
                keeper: keeperAddr,
                feeRecipient: feeTo,
                poster: poster,
                refOwner: refOwner,
                sequencerFeed: address(0)
            }),
            owner
        );
        vm.startPrank(owner);
        f.uploadVaultCode(type(OffmintVault).creationCode);
        assertFalse(f.codeSealed(), "hash mismatch never seals");
        f.setListing(address(a.stock), VaultFactory.Listing(true, address(feedA), 3000, 60));
        vm.expectRevert(VaultFactory.CodeNotSealed.selector);
        f.deployVault(address(a.stock), address(0));
        vm.stopPrank();
    }

    // ================================================================== helpers

    function _stockAt(address at, string memory sym) internal returns (MockStockToken s) {
        deployCodeTo("MockStockToken.sol:MockStockToken", abi.encode(address(this), sym, sym), at);
        s = MockStockToken(at);
    }

    function _pool(T storage t, uint256 p) internal returns (PoolKey memory k) {
        t.s0 = address(t.stock) < address(usd);
        (Currency c0, Currency c1) = t.s0
            ? (Currency.wrap(address(t.stock)), Currency.wrap(address(usd)))
            : (Currency.wrap(address(usd)), Currency.wrap(address(t.stock)));
        k = PoolKey(c0, c1, 3000, 60, IHooks(address(0)));
        manager.initialize(k, RangeMath.usdToSqrtPriceX96(p, dec, t.s0, false));
        t.stock.mint(address(this), 1e32);
        usd.mint(address(this), 1e32);
        t.stock.approve(address(swapRouter), type(uint256).max);
        usd.approve(address(swapRouter), type(uint256).max);
        t.stock.approve(address(modifyLiquidityRouter), type(uint256).max);
        usd.approve(address(modifyLiquidityRouter), type(uint256).max);
        int24 x = RangeMath.usdToTick(p / 3, dec, t.s0);
        int24 y = RangeMath.usdToTick(p * 3, dec, t.s0);
        (int24 lo, int24 hi) = x < y ? (x, y) : (y, x);
        modifyLiquidityRouter.modifyLiquidity(
            k,
            IPoolManager.ModifyLiquidityParams({
                tickLower: RangeMath.floorToSpacing(lo, 60),
                tickUpper: RangeMath.ceilToSpacing(hi, 60),
                liquidityDelta: 1e19,
                salt: 0
            }),
            ""
        );
    }

    function _uploadCode() internal {
        bytes memory code = type(OffmintVault).creationCode;
        uint256 n = 20_000;
        vm.startPrank(owner);
        for (uint256 i = 0; i < code.length; i += n) {
            uint256 len = i + n > code.length ? code.length - i : n;
            bytes memory part = new bytes(len);
            for (uint256 j = 0; j < len; j++) {
                part[j] = code[i + j];
            }
            factory.uploadVaultCode(part);
        }
        vm.stopPrank();
        assertTrue(factory.codeSealed(), "sealed");
    }

    function _depositUsd(address who, uint256 amt) internal returns (uint256 shares) {
        usd.mint(who, amt);
        vm.startPrank(who);
        usd.approve(address(meta), amt);
        shares = meta.deposit(amt, who);
        vm.stopPrank();
    }

    function _buyIn(T storage t, uint256 amt) internal {
        vm.prank(keeperAddr);
        meta.buyIn(address(t.stock), amt);
    }

    /// @dev Post a reference price for `t` observed at `at`.
    function _print(T storage t, uint256 p, uint256 at) internal {
        if (t.push) {
            PushPriceReference r = PushPriceReference(address(t.vault.priceRef()));
            vm.prank(poster);
            r.post(p, at, false);
        } else {
            feedA.setAnswerAt(int256(p), at);
        }
    }

    /// @dev Friday close print, 4h before the weekend window.
    function _closePrint(T storage t, uint256 p) internal {
        _print(t, p, SAT - 4 hours);
    }

    /// @dev Monday reopen: fresh print at 00:10, pool mean-reverts to it, time moves to settle-able.
    function _reopen(T storage t, uint256 p) internal {
        vm.warp(MON + 10 minutes);
        _print(t, p, block.timestamp);
        _moveTo(t, p);
        vm.warp(MON + 1 hours);
    }

    function _poolUsd(T storage t) internal view returns (uint256) {
        (uint160 sp,,,) = manager.getSlot0(t.key.toId());
        return RangeMath.sqrtPriceX96ToUsd(sp, dec, t.s0);
    }

    function _moveTo(T storage t, uint256 usdAnswer) internal {
        uint160 target = RangeMath.usdToSqrtPriceX96(usdAnswer, dec, t.s0, false);
        (uint160 sp,,,) = manager.getSlot0(t.key.toId());
        if (target == sp) return;
        swapRouter.swap(
            t.key,
            IPoolManager.SwapParams({zeroForOne: target < sp, amountSpecified: -1e32, sqrtPriceLimitX96: target}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    function _ladder() internal pure returns (RangeMath.Rung[] memory r) {
        r = new RangeMath.Rung[](4);
        r[0] = RangeMath.Rung(800, 400, 2500);
        r[1] = RangeMath.Rung(1500, 700, 3000);
        r[2] = RangeMath.Rung(2500, 1000, 2500);
        r[3] = RangeMath.Rung(4000, 1500, 2000);
    }
}

contract FakeRegistry is IVaultRegistry {
    address immutable v;

    constructor(address v_) {
        v = v_;
    }

    function vaultFor(address, address) external view returns (address) {
        return v;
    }
}
