// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {RangeMath} from "../src/libraries/RangeMath.sol";

/// @dev External wrapper so reverts from the internal library can be caught with expectRevert.
contract RangeMathHarness {
    function sellRange(
        uint256 p0,
        uint256 premiumBps,
        uint256 widthBps,
        int24 curTick,
        int24 spacing,
        RangeMath.Decimals memory d,
        bool s0
    ) external pure returns (int24, int24) {
        return RangeMath.sellRange(p0, premiumBps, widthBps, curTick, spacing, d, s0);
    }
}

contract RangeMathTest is Test {
    RangeMath.Decimals d = RangeMath.Decimals({feed: 8, stock: 18, usd: 6});
    RangeMathHarness h = new RangeMathHarness();

    uint256 constant MIN_USD = 1e6; // $0.01 at 8 decimals
    uint256 constant MAX_USD = 10_000e8; // $10,000

    // ------------------------------------------------------------ spacing

    function test_floorCeilNegative() public pure {
        assertEq(RangeMath.floorToSpacing(-1, 60), -60);
        assertEq(RangeMath.floorToSpacing(-60, 60), -60);
        assertEq(RangeMath.floorToSpacing(-61, 60), -120);
        assertEq(RangeMath.floorToSpacing(59, 60), 0);
        assertEq(RangeMath.ceilToSpacing(-1, 60), 0);
        assertEq(RangeMath.ceilToSpacing(-59, 60), 0);
        assertEq(RangeMath.ceilToSpacing(-61, 60), -60);
        assertEq(RangeMath.ceilToSpacing(1, 60), 60);
        assertEq(RangeMath.ceilToSpacing(60, 60), 60);
    }

    function testFuzz_spacing(int24 t, uint8 sp) public pure {
        int24 spacing = int24(uint24(bound(sp, 1, 200)));
        t = int24(bound(t, TickMath.MIN_TICK, TickMath.MAX_TICK));
        int24 f = RangeMath.floorToSpacing(t, spacing);
        int24 c = RangeMath.ceilToSpacing(t, spacing);
        assertEq(f % spacing, 0);
        assertEq(c % spacing, 0);
        assertLe(f, t);
        assertGe(c, t);
        assertLt(t - f, spacing);
        assertLt(c - t, spacing);
    }

    // ------------------------------------------------------------ price conversions

    function test_knownPriceS0() public view {
        // $30 -> price = 30e-12 USDG_raw/STOCK_raw -> tick ~ -242,3xx
        int24 t = RangeMath.usdToTick(30e8, d, true);
        assertLt(t, -242_000);
        assertGt(t, -243_000);
        // S1 is the mirror image
        int24 t1 = RangeMath.usdToTick(30e8, d, false);
        assertApproxEqAbs(int256(t1), -int256(t), 1);
    }

    function test_decimalsNotHardcoded() public pure {
        RangeMath.Decimals memory d18 = RangeMath.Decimals({feed: 18, stock: 18, usd: 6});
        RangeMath.Decimals memory d8 = RangeMath.Decimals({feed: 8, stock: 18, usd: 6});
        assertEq(RangeMath.usdToTick(30e18, d18, true), RangeMath.usdToTick(30e8, d8, true));
    }

    /// SPEC §5.3: USD -> tick -> USD round-trips within 1 tick for $0.01 - $10,000, both orientations.
    function testFuzz_roundTrip(uint256 usd, bool s0) public view {
        usd = bound(usd, MIN_USD, MAX_USD);
        int24 t = RangeMath.usdToTick(usd, d, s0);
        uint256 a = RangeMath.tickToUsd(t, d, s0);
        uint256 b = RangeMath.tickToUsd(t + 1, d, s0);
        (uint256 lo, uint256 hi) = s0 ? (a, b) : (b, a);
        // the true price sits between the two neighbouring ticks (1 wei rounding slack)
        assertLe(lo, usd + 1, "lo");
        assertGe(hi + 1, usd, "hi");
        // and one tick is ~1bp
        assertLe(hi - lo, hi / 9_000 + 1, "1 tick");
    }

    function testFuzz_sqrtRoundingDirection(uint256 usd, bool s0) public view {
        usd = bound(usd, MIN_USD, MAX_USD);
        uint160 down = RangeMath.usdToSqrtPriceX96(usd, d, s0, false);
        uint160 up = RangeMath.usdToSqrtPriceX96(usd, d, s0, true);
        assertLe(down, up);
        assertLe(up - down, 1 + up / 1e15);
    }

    // ------------------------------------------------------------ sell range

    function _checkRange(uint256 p0, uint256 prem, uint256 width, int24 cur, int24 sp, bool s0)
        internal
        view
        returns (int24 lo, int24 up)
    {
        (lo, up) = h.sellRange(p0, prem, width, cur, sp, d, s0);
        assertEq(lo % sp, 0, "lower spacing");
        assertEq(up % sp, 0, "upper spacing");
        assertLt(lo, up, "ordered");
        uint256 minUsd = p0 * (10_000 + prem) / 10_000;
        if (s0) {
            assertLt(cur, lo, "S0 single-sided: range strictly above current tick");
            assertGe(RangeMath.tickToUsd(lo, d, true), minUsd, "S0 lower bound >= P0*(1+premium)");
        } else {
            assertLe(up, cur, "S1 single-sided: range at/below current tick");
            assertGe(RangeMath.tickToUsd(up, d, false), minUsd, "S1 lower bound >= P0*(1+premium)");
        }
    }

    function test_rangeAtP0_bothOrientations() public view {
        uint256 p0 = 28_84e6; // $28.84
        int24 cur0 = RangeMath.usdToTick(p0, d, true);
        int24 cur1 = RangeMath.usdToTick(p0, d, false);
        (int24 l0, int24 u0) = _checkRange(p0, 1000, 5000, cur0, 60, true);
        (int24 l1, int24 u1) = _checkRange(p0, 1000, 5000, cur1, 60, false);
        // band upper edge ~ P0 * 1.6
        assertApproxEqRel(RangeMath.tickToUsd(u0, d, true), p0 * 16 / 10, 0.01e18);
        assertApproxEqRel(RangeMath.tickToUsd(l1, d, false), p0 * 16 / 10, 0.01e18);
        assertApproxEqRel(RangeMath.tickToUsd(l0, d, true), p0 * 11 / 10, 0.01e18);
        assertApproxEqRel(RangeMath.tickToUsd(u1, d, false), p0 * 11 / 10, 0.01e18);
    }

    function test_rangeWhenPoolAlreadyAbovePremium() public view {
        uint256 p0 = 30e8;
        // pool trading at $40 (+33%) when we arm: sell only above the current price
        int24 cur0 = RangeMath.usdToTick(40e8, d, true);
        (int24 l0,) = _checkRange(p0, 1000, 5000, cur0, 60, true);
        assertGt(RangeMath.tickToUsd(l0, d, true), 40e8);
        int24 cur1 = RangeMath.usdToTick(40e8, d, false);
        (, int24 u1) = _checkRange(p0, 1000, 5000, cur1, 60, false);
        assertGe(RangeMath.tickToUsd(u1, d, false), 40e8 * 9999 / 10000);
    }

    function test_rangeCurOnSpacingBoundary() public view {
        uint256 p0 = 30e8;
        int24 t = RangeMath.floorToSpacing(RangeMath.usdToTick(p0 * 12 / 10, d, true), 60);
        _checkRange(p0, 1000, 5000, t, 60, true); // cur exactly on a spacing multiple, inside band
        int24 t1 = RangeMath.floorToSpacing(RangeMath.usdToTick(p0 * 12 / 10, d, false), 60);
        _checkRange(p0, 1000, 5000, t1, 60, false);
    }

    function test_rangeInvalidWhenPoolAboveBand() public {
        uint256 p0 = 30e8;
        int24 cur0 = RangeMath.usdToTick(60e8, d, true); // above P0*1.6
        vm.expectRevert(RangeMath.RangeInvalid.selector);
        h.sellRange(p0, 1000, 5000, cur0, 60, d, true);
        int24 cur1 = RangeMath.usdToTick(60e8, d, false);
        vm.expectRevert(RangeMath.RangeInvalid.selector);
        h.sellRange(p0, 1000, 5000, cur1, 60, d, false);
    }

    function testFuzz_sellRange(uint256 p0, uint256 prem, uint256 width, int256 curBps, uint8 spSel, bool s0) public view {
        p0 = bound(p0, MIN_USD, MAX_USD);
        prem = bound(prem, 500, 5000);
        width = bound(width, 1000, 10_000);
        curBps = bound(curBps, -5000, int256(prem + width / 2)); // pool from -50% up to mid-band
        int24[4] memory sps = [int24(1), 10, 60, 200];
        int24 sp = sps[spSel % 4];
        uint256 curUsd = uint256(int256(p0) * (10_000 + curBps) / 10_000);
        int24 cur = RangeMath.usdToTick(curUsd, d, s0);
        _checkRange(p0, prem, width, cur, sp, s0);
    }

    function testFuzz_buybackCapNeverAboveLimit(uint256 fresh, uint256 slip, bool s0) public view {
        fresh = bound(fresh, MIN_USD, MAX_USD);
        slip = bound(slip, 0, 300);
        uint160 cap = RangeMath.buybackSqrtCap(fresh, slip, d, s0);
        uint256 capUsd = RangeMath.sqrtPriceX96ToUsd(cap, d, s0);
        assertLe(capUsd, fresh * (10_000 + slip) / 10_000 + 1);
        assertApproxEqRel(capUsd, fresh * (10_000 + slip) / 10_000, 1e12); // within 1e-6
    }
}

contract RangeMathVectors is Test {
    RangeMathHarness h = new RangeMathHarness();

    function test_vectors() public pure {
        RangeMath.Decimals memory d = RangeMath.Decimals({feed: 8, stock: 18, usd: 6});
        console2.log("VEC_T30_S0", RangeMath.usdToTick(30e8, d, true));
        console2.log("VEC_T30_S1", RangeMath.usdToTick(30e8, d, false));
    }

    struct V {
        bool s0;
        uint256 p0;
        uint256 prem;
        uint256 width;
        int24 sp;
        int24 cur;
    }

    /// Writes test/vectors/rangeMath.json; keeper/test/vectors.test.ts checks the TS port matches exactly.
    function test_writeCrossLanguageVectors() public {
        string memory out = "[";
        for (uint256 i = 0; i < 200; i++) {
            out = string.concat(out, i == 0 ? "" : ",", _vec(_input(i)));
        }
        vm.writeFile("test/vectors/rangeMath.json", string.concat(out, "]"));
    }

    function _dec() internal pure returns (RangeMath.Decimals memory) {
        return RangeMath.Decimals({feed: 8, stock: 18, usd: 6});
    }

    function _input(uint256 i) internal pure returns (V memory v) {
        uint256 r = uint256(keccak256(abi.encode(i)));
        int24[4] memory sps = [int24(1), 10, 60, 200];
        v.s0 = r & 1 == 1;
        v.p0 = 1e6 + (r >> 8) % (10_000e8 - 1e6);
        v.prem = 500 + (r >> 80) % 4500;
        v.width = 1000 + (r >> 100) % 9000;
        v.sp = sps[(r >> 120) % 4];
        // pool from -50% to +80% of p0 (some above the band -> RangeInvalid)
        v.cur = RangeMath.usdToTick(v.p0 * (5000 + (r >> 130) % 13_000) / 10_000, _dec(), v.s0);
    }

    function _vec(V memory v) internal view returns (string memory) {
        string memory range;
        try h.sellRange(v.p0, v.prem, v.width, v.cur, v.sp, _dec(), v.s0) returns (int24 lo, int24 up) {
            range = string.concat("[", vm.toString(lo), ",", vm.toString(up), "]");
        } catch {
            range = "null";
        }
        string memory head = string.concat(
            "{\"s0\":", v.s0 ? "true" : "false",
            ",\"p0\":\"", vm.toString(v.p0),
            "\",\"prem\":", vm.toString(v.prem),
            ",\"width\":", vm.toString(v.width),
            ",\"spacing\":", vm.toString(v.sp),
            ",\"cur\":", vm.toString(v.cur)
        );
        return string.concat(head, _prices(v), ",\"range\":", range, "}");
    }

    function _prices(V memory v) internal pure returns (string memory) {
        uint160 sq = RangeMath.usdToSqrtPriceX96(v.p0, _dec(), v.s0, false);
        return string.concat(
            ",\"sqrt\":\"", vm.toString(uint256(sq)),
            "\",\"sqrtUp\":\"", vm.toString(uint256(RangeMath.usdToSqrtPriceX96(v.p0, _dec(), v.s0, true))),
            "\",\"usdBack\":\"", vm.toString(RangeMath.sqrtPriceX96ToUsd(sq, _dec(), v.s0)),
            "\",\"cap\":\"", vm.toString(uint256(RangeMath.buybackSqrtCap(v.p0, 100, _dec(), v.s0))), "\""
        );
    }
}
