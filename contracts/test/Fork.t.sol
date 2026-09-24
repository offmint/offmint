// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {OffmintVault} from "../src/OffmintVault.sol";
import {SessionClock} from "../src/clock/SessionClock.sol";
import {RangeMath} from "../src/libraries/RangeMath.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {ISessionClock} from "../src/interfaces/ISessionClock.sol";
import {IStockToken} from "../src/interfaces/IStockToken.sol";
import {IPriceReference} from "../src/interfaces/IPriceReference.sol";
import {ChainlinkPriceReference} from "../src/oracle/ChainlinkPriceReference.sol";
import {PushPriceReference} from "../src/oracle/PushPriceReference.sol";

/// @notice Mainnet fork: real Robinhood Chain PoolManager, stock tokens, USDG and pools (addresses from
///         config/mainnet.json). Skipped unless RH_MAINNET_RPC (or ALCHEMY_RH_MAINNET_URL) is set.
///   RH_MAINNET_RPC=https://rpc.mainnet.chain.robinhood.com forge test --match-path test/Fork.t.sol -vv
/// @dev Forks the latest block (the public RPC has no archive state). The feed is mocked only where the weekend
///      clock needs it (Friday close print, Monday fresh print); the real answer seeds the price.
abstract contract ForkBase is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IPoolManager pm;
    IERC20 stock;
    IERC20 usdg;
    address feedAddr; // real Chainlink feed (feed tickers)
    PushPriceReference push; // no-feed tickers: the production path (SPEC §3.6), posted by a separate poster key
    address poster = makeAddr("poster");
    PoolKey key;
    bool s0;
    RangeMath.Decimals dec;
    OffmintVault vault;
    SessionClock clock;
    PoolSwapTest router;
    uint256 p0;
    uint256 sat; // next Saturday 00:00 UTC after the fork block

    address owner = makeAddr("owner");
    address keeperAddr = makeAddr("keeper");
    address feeTo = makeAddr("feeTo");
    address alice = makeAddr("alice");
    address trader = makeAddr("trader");

    function ticker() internal pure virtual returns (string memory);

    /// @dev true: the real Chainlink feed. false (no feed on mainnet): a PushPriceReference, seeded from the pool.
    function useRealFeed() internal pure virtual returns (bool);

    function setUp() public virtual {
        // an empty ALCHEMY_RH_MAINNET_URL falls through to RH_MAINNET_RPC
        string memory url = vm.envOr("ALCHEMY_RH_MAINNET_URL", string(""));
        if (bytes(url).length == 0) url = vm.envOr("RH_MAINNET_RPC", string(""));
        if (bytes(url).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(url);
        assertEq(block.chainid, 4663, "not Robinhood Chain mainnet");

        string memory json = vm.readFile("config/mainnet.json");
        string memory base = string.concat(".stocks.", ticker());
        string memory pk = string.concat(base, ".bestNoHookPool.poolKey");
        pm = IPoolManager(vm.parseJsonAddress(json, ".poolManager"));
        stock = IERC20(vm.parseJsonAddress(json, string.concat(base, ".token")));
        usdg = IERC20(vm.parseJsonAddress(json, ".usdg"));
        key = PoolKey(
            Currency.wrap(vm.parseJsonAddress(json, string.concat(pk, ".currency0"))),
            Currency.wrap(vm.parseJsonAddress(json, string.concat(pk, ".currency1"))),
            uint24(vm.parseJsonUint(json, string.concat(pk, ".fee"))),
            int24(vm.parseJsonInt(json, string.concat(pk, ".tickSpacing"))),
            IHooks(vm.parseJsonAddress(json, string.concat(pk, ".hooks")))
        );
        s0 = Currency.unwrap(key.currency0) == address(stock);
        assertEq(IERC20Metadata(address(stock)).decimals(), 18, "stock decimals");
        assertEq(IERC20Metadata(address(usdg)).decimals(), 6, "usdg decimals");
        assertFalse(IStockToken(address(stock)).oraclePaused(), "oracle paused on fork");

        if (useRealFeed()) {
            feedAddr = vm.parseJsonAddress(json, string.concat(base, ".feed"));
            (, int256 answer,,,) = AggregatorV3Interface(feedAddr).latestRoundData();
            p0 = uint256(answer);
            dec = RangeMath.Decimals({feed: AggregatorV3Interface(feedAddr).decimals(), stock: 18, usd: 6});
        } else {
            dec = RangeMath.Decimals({feed: 8, stock: 18, usd: 6});
            p0 = _poolUsd();
            push = new PushPriceReference(poster, owner, IStockToken(address(stock)), 2000, 12 hours, ticker());
            vm.prank(poster);
            push.post(p0, block.timestamp, false);
        }
        // sanity: pool and feed agree within 5% on a weekday
        assertApproxEqRel(_poolUsd(), p0, 0.05e18, "pool vs feed");

        uint256 day = block.timestamp / 1 days;
        uint256 dow = (day + 4) % 7;
        sat = (day + ((6 + 7 - dow) % 7 == 0 ? 7 : (6 + 7 - dow) % 7)) * 1 days;

        clock = new SessionClock(owner, 0);
        vault = new OffmintVault(
            OffmintVault.Config({
                poolManager: pm,
                clock: ISessionClock(address(clock)),
                // Chainlink adapter over the real (or pool-seeded mock) feed; no sequencer feed is listed for
                // Robinhood Chain (docs/FACTS.md)
                priceRef: useRealFeed()
                    ? IPriceReference(
                        address(
                            new ChainlinkPriceReference(
                                AggregatorV3Interface(feedAddr),
                                AggregatorV3Interface(address(0)),
                                IStockToken(address(stock))
                            )
                        )
                    )
                    : IPriceReference(address(push)),
                stock: stock,
                usdg: usdg,
                poolKey: key,
                owner: owner,
                keeper: keeperAddr,
                feeRecipient: feeTo,
                ticker: ticker(),
                restrictedDepositor: address(0)
            })
        );
        router = new PoolSwapTest(pm);

        deal(address(stock), alice, 100e18);
        vm.startPrank(alice);
        stock.approve(address(vault), 100e18);
        vault.deposit(100e18, alice);
        vm.stopPrank();

        deal(address(stock), trader, 1e27);
        deal(address(usdg), trader, 1e18); // 1e12 USDG
        vm.startPrank(trader);
        stock.approve(address(router), type(uint256).max);
        usdg.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers

    function _poolUsd() internal view returns (uint256) {
        (uint160 sp,,,) = pm.getSlot0(key.toId());
        return RangeMath.sqrtPriceX96ToUsd(sp, dec, s0);
    }

    function _moveTo(uint256 usdAnswer) internal {
        uint160 target = RangeMath.usdToSqrtPriceX96(usdAnswer, dec, s0, false);
        (uint160 sp,,,) = pm.getSlot0(key.toId());
        if (target == sp) return;
        vm.prank(trader);
        router.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: target < sp, amountSpecified: -1e30, sqrtPriceLimitX96: target}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    /// @dev Price print at `ts` (mocked on the real feed; posted by the poster on the push reference).
    function _print(uint256 answer, uint256 ts) internal {
        if (useRealFeed()) {
            vm.mockCall(
                feedAddr,
                abi.encodeWithSelector(AggregatorV3Interface.latestRoundData.selector),
                abi.encode(uint80(1), int256(answer), ts, ts, uint80(1))
            );
        } else {
            vm.prank(poster);
            push.post(answer, ts, false);
        }
    }

    function _armWeekend() internal {
        vm.warp(sat - 4 hours);
        _print(p0, sat - 4 hours); // Friday 20:00 UTC close
        vm.warp(sat + 20 minutes);
        RangeMath.Rung[] memory lad = RangeMath.defaultLadder(); // before the prank: a library call consumes it
        vm.prank(keeperAddr);
        vault.arm(lad, 3000);
    }

    // ------------------------------------------------------------------ tests

    function test_fork_rangeOnRealPool() public {
        _armWeekend();
        OffmintVault.Epoch memory e = vault.currentEpoch();
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.ARMED));
        assertEq(vault.stockIsCurrency0(), s0);
        assertApproxEqRel(e.stockDeployed, 30e18, 1e12);
        assertEq(usdg.balanceOf(address(vault)), 0, "single-sided");
        OffmintVault.RungResult[] memory rs = vault.epochRungs(vault.epochCount());
        assertEq(rs.length, 4, "4-rung ladder on the real pool");
        for (uint256 i = 0; i < rs.length; i++) {
            if (rs[i].removed) continue;
            uint256 low =
                s0 ? RangeMath.tickToUsd(rs[i].tickLower, dec, true) : RangeMath.tickToUsd(rs[i].tickUpper, dec, false);
            assertGe(low, p0 * 10_800 / 10_000, "every rung >= P0 * 1.08");
            assertEq(rs[i].tickLower % key.tickSpacing, 0);
            assertEq(rs[i].tickUpper % key.tickSpacing, 0);
        }
    }

    function test_fork_fullCycle_squeezeLockBuyback() public {
        uint256 ppsBefore = vault.convertToAssets(1e21);
        _armWeekend();
        _moveTo(p0 * 17 / 10); // weekend squeeze clears the band
        vault.lock();
        OffmintVault.Epoch memory e = vault.currentEpoch();
        assertLt(e.stockBack, 1e12, "fully sold on the real pool");
        assertGt(e.usdgReceived, 30 * p0 * 11 / 10 / 100, "sold above P0 * 1.1 on average");

        // Monday: minting reopens, arbitrage pulls the pool back, the feed prints fresh
        _moveTo(p0 * 101 / 100);
        uint256 mon = sat + 2 days;
        vm.warp(mon + 10 minutes);
        _print(p0 * 101 / 100, mon + 10 minutes);
        vm.warp(mon + 1 hours);
        vm.prank(keeperAddr);
        vault.settle(0);

        e = vault.currentEpoch();
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN));
        assertGt(e.pnlStock, 0, "more STOCK than before");
        assertGt(vault.convertToAssets(1e21), ppsBefore, "share price up");
        assertEq(stock.balanceOf(feeTo), e.feeStock);
        emit log_named_decimal_uint("P0 (USD)", p0, dec.feed);
        emit log_named_decimal_uint("USDG received", e.usdgReceived, 6);
        emit log_named_decimal_uint("STOCK bought back", e.stockBought, 18);
        emit log_named_decimal_int("PnL (STOCK)", e.pnlStock, 18);

        // holders can exit again
        uint256 sh = vault.balanceOf(alice);
        vm.prank(alice);
        uint256 out = vault.redeem(sh, alice, alice);
        assertGt(out, 100e18);
        // per-rung detail for the landing page's worked example (same run)
        OffmintVault.RungResult[] memory rs = vault.epochRungs(e.id);
        for (uint256 i = 0; i < rs.length; i++) {
            emit log_named_uint("rung", i);
            emit log_named_decimal_uint("  STOCK placed", rs[i].stockDeployed, 18);
            emit log_named_decimal_uint("  STOCK left unsold", rs[i].stockBack, 18);
            emit log_named_decimal_uint("  USDG received", rs[i].usdgReceived, 6);
        }
        emit log_named_decimal_uint("perf fee (STOCK)", e.feeStock, 18);
        emit log_named_decimal_uint("holder redeems 100 -> STOCK", out, 18);
    }

    function test_fork_gapUp_capsBuyback() public {
        _armWeekend();
        _moveTo(p0 * 17 / 10);
        vault.lock();
        uint256 mon = sat + 2 days;
        vm.warp(mon + 10 minutes);
        _print(p0 * 13 / 10, mon + 10 minutes); // stock really gapped up 30%; pool still at +70%
        vm.warp(mon + 1 hours);
        vm.prank(keeperAddr);
        vault.settle(0);
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.PENDING_BUYBACK));
        assertEq(vault.currentEpoch().stockBought, 0, "no buy above feed * 1.01");
    }

    function test_fork_noFill_returnsDeployed() public {
        _armWeekend();
        uint256 mon = sat + 2 days;
        vm.warp(mon + 10 minutes);
        _print(p0, mon + 10 minutes);
        vm.warp(mon + 1 hours);
        vm.prank(keeperAddr);
        vault.settle(0);
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN));
        assertApproxEqAbs(stock.balanceOf(address(vault)), 100e18, 8, "<= 2 wei rounding per rung");
    }
}

/// TSLA/USDG: stock is currency0 (S0), real Chainlink feed.
contract ForkTSLA is ForkBase {
    function ticker() internal pure override returns (string memory) {
        return "TSLA";
    }

    function useRealFeed() internal pure override returns (bool) {
        return true;
    }
}

/// HIMS/USDG: stock is currency1 (S1). No HIMS Chainlink feed on mainnet -> PushPriceReference (SPEC §3.6).
contract ForkHIMS is ForkBase {
    function ticker() internal pure override returns (string memory) {
        return "HIMS";
    }

    function useRealFeed() internal pure override returns (bool) {
        return false;
    }
}

/// GLXY/USDG: stock is currency0 (S0), no Chainlink feed -> PushPriceReference; squeezed +186% on 12 Sep 2026.
contract ForkGLXY is ForkBase {
    function ticker() internal pure override returns (string memory) {
        return "GLXY";
    }

    function useRealFeed() internal pure override returns (bool) {
        return false;
    }
}
