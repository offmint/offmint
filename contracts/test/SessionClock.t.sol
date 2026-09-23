// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {SessionClock} from "../src/clock/SessionClock.sol";
import {ManualSessionClock} from "../src/clock/ManualSessionClock.sol";

contract SessionClockTest is Test {
    SessionClock clock;
    // Sat 26 Sep 2026 00:00:00 UTC
    uint256 constant SAT = 1790380800;

    function setUp() public {
        clock = new SessionClock(address(this), 0);
    }

    function test_anchorIsSaturday() public view {
        assertEq(clock.dow(SAT), 6);
        assertEq(clock.dow(0), 4); // 1970-01-01 Thursday
    }

    function test_everyDayBoundary() public view {
        // Fri 23:59:59 out, Sat 00:00:00 in, Sun 23:59:59 in, Mon 00:00:00 out
        assertFalse(clock.inWeekendWindow(SAT - 1));
        assertTrue(clock.inWeekendWindow(SAT));
        assertTrue(clock.inWeekendWindow(SAT + 1 days));
        assertTrue(clock.inWeekendWindow(SAT + 2 days - 1));
        assertFalse(clock.inWeekendWindow(SAT + 2 days));
        for (uint256 i = 2; i < 7; i++) {
            assertFalse(clock.inWeekendWindow(SAT + i * 1 days + 12 hours));
        }
    }

    function test_windowStartEnd() public view {
        for (uint256 i = 0; i < 7; i++) {
            uint256 ts = SAT + i * 1 days + 5 hours;
            assertEq(clock.windowStart(ts), SAT, "start");
            assertEq(clock.windowEnd(ts), SAT + 2 days, "end");
        }
        assertEq(clock.windowStart(SAT - 1), SAT - 7 days);
        assertEq(clock.windowStart(SAT + 7 days), SAT + 7 days);
    }

    function test_offsetPlusOneHour() public {
        clock.setSessionOffset(1 hours);
        assertFalse(clock.inWeekendWindow(SAT));
        assertFalse(clock.inWeekendWindow(SAT + 1 hours - 1));
        assertTrue(clock.inWeekendWindow(SAT + 1 hours));
        assertTrue(clock.inWeekendWindow(SAT + 2 days + 1 hours - 1));
        assertFalse(clock.inWeekendWindow(SAT + 2 days + 1 hours));
        assertEq(clock.windowStart(SAT + 1 days), SAT + 1 hours);
        assertEq(clock.windowEnd(SAT + 1 days), SAT + 2 days + 1 hours);
        // Sat 00:30 belongs to the previous week's window under +1h
        assertEq(clock.windowStart(SAT + 30 minutes), SAT - 7 days + 1 hours);
    }

    function test_offsetMinusOneHour() public {
        clock.setSessionOffset(-1 hours);
        assertTrue(clock.inWeekendWindow(SAT - 1 hours));
        assertFalse(clock.inWeekendWindow(SAT - 1 hours - 1));
        assertFalse(clock.inWeekendWindow(SAT + 2 days - 1 hours));
        assertEq(clock.windowStart(SAT), SAT - 1 hours);
    }

    function test_offsetBounds() public {
        clock.setSessionOffset(3 hours);
        clock.setSessionOffset(-3 hours);
        vm.expectRevert(SessionClock.OffsetOutOfBounds.selector);
        clock.setSessionOffset(3 hours + 1);
        vm.expectRevert(SessionClock.OffsetOutOfBounds.selector);
        clock.setSessionOffset(-3 hours - 1);
    }

    function test_offsetOnlyOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        clock.setSessionOffset(1 hours);
    }

    function testFuzz_windowConsistent(uint256 ts, int256 offset) public {
        ts = bound(ts, 1 days * 30, 4102444800); // 1970+30d .. 2100
        offset = bound(offset, -3 hours, 3 hours);
        clock.setSessionOffset(offset);
        uint256 s = clock.windowStart(ts);
        uint256 e = clock.windowEnd(ts);
        assertLe(s, ts);
        assertGt(s + 7 days, ts);
        assertEq(e, s + 2 days);
        assertEq(clock.inWeekendWindow(ts), ts < e);
        assertTrue(clock.inWeekendWindow(s));
        assertEq(clock.dow(uint256(int256(s) - offset)), 6);
    }

    function test_manualClock() public {
        ManualSessionClock m = new ManualSessionClock(address(this));
        vm.warp(1000);
        m.openWindow(1 hours);
        assertTrue(m.inWeekendWindow(block.timestamp));
        assertEq(m.windowStart(0), 1000);
        vm.warp(2000);
        m.closeWindow();
        assertFalse(m.inWeekendWindow(block.timestamp));
        assertEq(m.windowEnd(0), 2000);
        vm.expectRevert(ManualSessionClock.BadWindow.selector);
        m.setWindow(5, 5);
    }
}
