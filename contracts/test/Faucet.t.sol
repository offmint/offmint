// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Faucet} from "../src/mocks/Faucet.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";

contract FaucetTest is Test {
    MockUSDG usd;
    MockStockToken stock;
    Faucet f;
    address owner = makeAddr("owner");
    address judge = makeAddr("judge");
    address other = makeAddr("other");

    function setUp() public {
        usd = new MockUSDG(address(this));
        stock = new MockStockToken(address(this), "Mock HIMS", "mHIMS");
        f = new Faucet(IERC20(address(usd)), IERC20(address(stock)), 1_000e6, 10e18, owner);
        usd.mint(address(f), 5_000e6);
        stock.mint(address(f), 50e18);
    }

    function test_claim_sendsBoth() public {
        vm.prank(judge);
        f.claim();
        assertEq(usd.balanceOf(judge), 1_000e6);
        assertEq(stock.balanceOf(judge), 10e18);
        assertEq(f.waitFor(judge), 24 hours);
    }

    function test_secondClaimWithin24h_reverts_thenWorks() public {
        vm.prank(judge);
        f.claim();
        vm.warp(block.timestamp + 24 hours - 1);
        vm.prank(judge);
        vm.expectRevert(abi.encodeWithSelector(Faucet.TooSoon.selector, block.timestamp + 1));
        f.claim();
        vm.warp(block.timestamp + 1);
        vm.prank(judge);
        f.claim();
        assertEq(usd.balanceOf(judge), 2_000e6);
        // other addresses are independent
        vm.prank(other);
        f.claim();
        assertEq(usd.balanceOf(other), 1_000e6);
    }

    function test_pause() public {
        vm.prank(judge);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", judge));
        f.setPaused(true);
        vm.prank(owner);
        f.setPaused(true);
        vm.prank(judge);
        vm.expectRevert(Faucet.IsPaused.selector);
        f.claim();
        vm.prank(owner);
        f.setPaused(false);
        vm.prank(judge);
        f.claim();
    }

    function test_empty_revertsCleanly_andRefillWorks() public {
        vm.prank(owner);
        f.setAmounts(3_000e6, 10e18);
        vm.prank(judge);
        f.claim(); // 2,000 USDG left
        vm.prank(other);
        vm.expectRevert(Faucet.Empty.selector);
        f.claim();
        assertEq(f.lastClaimAt(other), 0, "failed claim does not start the cooldown");
        usd.mint(address(f), 10_000e6); // refill = plain transfer/mint to the faucet
        vm.prank(other);
        f.claim();
        assertEq(usd.balanceOf(other), 3_000e6);
    }

    function test_sweep_ownerOnly() public {
        vm.prank(judge);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", judge));
        f.sweep(IERC20(address(usd)), judge, 1);
        vm.prank(owner);
        f.sweep(IERC20(address(usd)), owner, 5_000e6);
        assertEq(usd.balanceOf(owner), 5_000e6);
    }
}
