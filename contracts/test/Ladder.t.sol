// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {RangeMath} from "../src/libraries/RangeMath.sol";

contract LadderHarness {
    function positions(
        uint256 p0,
        RangeMath.Rung[] memory r,
        int24 cur,
        int24 sp,
        RangeMath.Decimals memory d,
        bool s0,
        uint256 amt
    ) external pure returns (RangeMath.RungPosition[] memory) {
        return RangeMath.ladderPositions(p0, r, cur, sp, d, s0, amt);
    }

    function validate(RangeMath.Rung[] memory r) external pure {
        RangeMath.validateLadder(r);
    }
}

/// @dev SPEC §5.0 ladder: both orientations, non-overlapping rungs, single-sided, premium floors, crossed rungs skipped.
contract LadderTest is Test {
    LadderHarness h = new LadderHarness();
    RangeMath.Decimals d = RangeMath.Decimals({feed: 8, stock: 18, usd: 6});

    function _ladder() internal pure returns (RangeMath.Rung[] memory) {
        return RangeMath.defaultLadder();
    }

    /// Every deployed rung is single-sided, above its own premium floor, and rungs never overlap.
    function _check(uint256 p0, RangeMath.Rung[] memory r, int24 cur, int24 sp, bool s0, uint256 amt)
        internal
        view
        returns (RangeMath.RungPosition[] memory ps)
    {
        ps = h.positions(p0, r, cur, sp, d, s0, amt);
        assertEq(ps.length, r.length);
        uint256 total;
        int256 prevEdge = s0 ? type(int256).min : type(int256).max;
        for (uint256 i = 0; i < ps.length; i++) {
            if (ps[i].amount == 0) continue; // skipped (crossed) rung
            assertEq(ps[i].tickLower % sp, 0, "spacing lo");
            assertEq(ps[i].tickUpper % sp, 0, "spacing hi");
            assertLt(ps[i].tickLower, ps[i].tickUpper, "ordered");
            assertGt(ps[i].liquidity, 0, "liquidity");
            uint256 floorUsd = p0 * (10_000 + r[i].premiumBps) / 10_000;
            if (s0) {
                assertLt(cur, ps[i].tickLower, "S0 single-sided");
                assertGe(RangeMath.tickToUsd(ps[i].tickLower, d, true), floorUsd, "S0 rung floor");
                assertGe(int256(ps[i].tickLower), prevEdge, "S0 non-overlap: rung[i].lower >= rung[i-1].upper");
                prevEdge = ps[i].tickUpper;
            } else {
                assertLe(ps[i].tickUpper, cur, "S1 single-sided");
                assertGe(RangeMath.tickToUsd(ps[i].tickUpper, d, false), floorUsd, "S1 rung floor");
                assertLe(int256(ps[i].tickUpper), prevEdge, "S1 non-overlap: rung[i].upper <= rung[i-1].lower");
                prevEdge = ps[i].tickLower;
            }
            total += ps[i].amount;
        }
        assertLe(total, amt, "never deploys more than allotted");
    }

    function test_defaultLadderIsValidAndMatchesSpec() public view {
        RangeMath.Rung[] memory r = _ladder();
        h.validate(r);
        assertEq(r.length, 4);
        assertEq(r[0].premiumBps, 800);
        assertEq(r[3].premiumBps + r[3].widthBps, 5500);
    }

    function test_atP0_allFourRungs_bothOrientations() public view {
        uint256 p0 = 30e8;
        for (uint256 k = 0; k < 2; k++) {
            bool s0 = k == 0;
            RangeMath.RungPosition[] memory ps = _check(p0, _ladder(), RangeMath.usdToTick(p0, d, s0), 60, s0, 100e18);
            uint256 total;
            for (uint256 i = 0; i < 4; i++) {
                assertGt(ps[i].amount, 0, "all rungs deployed at P0");
                total += ps[i].amount;
            }
            assertEq(total, 100e18, "shares sum to the full deployment");
            // first rung starts ~+8%, last rung ends ~+55%
            uint256 lo =
                s0 ? RangeMath.tickToUsd(ps[0].tickLower, d, true) : RangeMath.tickToUsd(ps[0].tickUpper, d, false);
            uint256 hi =
                s0 ? RangeMath.tickToUsd(ps[3].tickUpper, d, true) : RangeMath.tickToUsd(ps[3].tickLower, d, false);
            assertApproxEqRel(lo, p0 * 108 / 100, 0.01e18);
            assertApproxEqRel(hi, p0 * 155 / 100, 0.01e18);
        }
    }

    function test_crossedRungsAreSkipped_notFatal() public view {
        uint256 p0 = 30e8;
        for (uint256 k = 0; k < 2; k++) {
            bool s0 = k == 0;
            // pool already at +30% when we arm: rungs +8-12% and +15-22% are behind the price
            RangeMath.RungPosition[] memory ps =
                _check(p0, _ladder(), RangeMath.usdToTick(p0 * 13 / 10, d, s0), 60, s0, 100e18);
            assertEq(ps[0].amount, 0);
            assertEq(ps[1].amount, 0);
            assertGt(ps[2].amount, 0, "rung 3 trimmed to sell only above market");
            assertGt(ps[3].amount, 0);
        }
    }

    function test_allRungsCrossed_reverts() public {
        uint256 p0 = 30e8;
        int24 cur = RangeMath.usdToTick(p0 * 17 / 10, d, true); // above the whole ladder (+55%)
        RangeMath.Rung[] memory r = _ladder(); // built first: a public library call would consume expectRevert
        vm.expectRevert(RangeMath.RangeInvalid.selector);
        h.positions(p0, r, cur, 60, d, true, 100e18);
    }

    function test_validateLadder_rejects() public {
        RangeMath.Rung[] memory r = _ladder();
        r[1].premiumBps = 1100; // overlaps rung 0 (+8..+12%)
        vm.expectRevert(RangeMath.LadderInvalid.selector);
        h.validate(r);

        r = _ladder();
        r[0].shareBps = 2400; // sums to 9900
        vm.expectRevert(RangeMath.LadderInvalid.selector);
        h.validate(r);

        r = _ladder();
        r[0].premiumBps = 499; // below the 5% floor
        vm.expectRevert(RangeMath.LadderInvalid.selector);
        h.validate(r);

        r = _ladder();
        r[2].widthBps = 0;
        vm.expectRevert(RangeMath.LadderInvalid.selector);
        h.validate(r);

        vm.expectRevert(RangeMath.LadderInvalid.selector);
        h.validate(new RangeMath.Rung[](0));

        RangeMath.Rung[] memory five = new RangeMath.Rung[](5);
        vm.expectRevert(RangeMath.LadderInvalid.selector);
        h.validate(five);
    }

    function test_singleRungLadderIsTheOldBand() public view {
        RangeMath.Rung[] memory r = new RangeMath.Rung[](1);
        r[0] = RangeMath.Rung(1000, 5000, 10_000);
        uint256 p0 = 30e8;
        RangeMath.RungPosition[] memory ps = _check(p0, r, RangeMath.usdToTick(p0, d, true), 60, true, 30e18);
        (int24 tl, int24 tu) = RangeMath.sellRange(p0, 1000, 5000, RangeMath.usdToTick(p0, d, true), 60, d, true);
        assertEq(ps[0].tickLower, tl);
        assertEq(ps[0].tickUpper, tu);
    }

    /// SPEC M2 acceptance: fuzz both orientations, random spacing and pool position, all rungs non-overlapping.
    function testFuzz_ladder(uint256 p0, int256 curBps, uint8 spSel, bool s0, uint256 amt) public view {
        p0 = bound(p0, 1e6, 10_000e8);
        curBps = bound(curBps, -5000, 3000); // pool from -50% to +30%: the top rung (+40-55%) is always deployable
        amt = bound(amt, 1e18, 1_000_000e18);
        int24[4] memory sps = [int24(1), 10, 60, 200];
        int24 sp = sps[spSel % 4];
        int24 cur = RangeMath.usdToTick(uint256(int256(p0) * (10_000 + curBps) / 10_000), d, s0);
        _check(p0, _ladder(), cur, sp, s0, amt);
    }

    /// Above +30% only the upper rungs remain; with coarse spacing the last sliver can vanish entirely. Then the only
    /// correct answer is RangeInvalid (nothing single-sided is left to sell), never a two-sided position.
    function testFuzz_ladder_highPool_neverTwoSided(uint256 p0, int256 curBps, bool s0) public view {
        p0 = bound(p0, 1e6, 10_000e8);
        curBps = bound(curBps, 3000, 6000);
        int24 cur = RangeMath.usdToTick(uint256(int256(p0) * (10_000 + curBps) / 10_000), d, s0);
        RangeMath.Rung[] memory r = _ladder();
        try h.positions(p0, r, cur, 200, d, s0, 100e18) returns (RangeMath.RungPosition[] memory ps) {
            for (uint256 i = 0; i < ps.length; i++) {
                if (ps[i].amount == 0) continue;
                if (s0) assertLt(cur, ps[i].tickLower);
                else assertLe(ps[i].tickUpper, cur);
            }
        } catch (bytes memory err) {
            assertEq(bytes4(err), RangeMath.RangeInvalid.selector);
        }
    }
}
