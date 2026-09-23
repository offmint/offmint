// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {OffmintVault} from "../src/OffmintVault.sol";
import {RangeMath} from "../src/libraries/RangeMath.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {VaultSetup} from "./OffmintVault.t.sol";

/// @dev Drives the vault through random epochs: deposits/redeems, price moves, arm/lock/settle/retry/unwind/expire.
///      Calls that revert for legitimate reasons are swallowed; the invariants are checked after every call.
contract VaultHandler is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    OffmintVault public vault;
    MockStockToken public stock;
    MockUSDG public usd;
    MockFeed public feed;
    IPoolManager public manager;
    PoolSwapTest public router;
    PoolKey public key;
    address public keeper;
    bool public s0;
    RangeMath.Decimals dec = RangeMath.Decimals({feed: 8, stock: 18, usd: 6});

    address[] public actors;
    uint256 public price = 30e8; // "true" market price the feed follows on weekdays

    // ghosts
    uint256 public supplyAtArm;
    bool public supplyChangedWhileLocked;
    uint256 public ghostFees;
    uint256 public ghostPositivePnl;
    uint256 public calls;
    uint256 public arms;
    uint256 public opensFromBuyback;
    uint256 public pendings;
    uint256 public locks;

    constructor(
        OffmintVault v,
        MockStockToken s,
        MockUSDG u,
        MockFeed f,
        IPoolManager m,
        PoolSwapTest r,
        PoolKey memory k,
        address kp
    ) {
        vault = v;
        stock = s;
        usd = u;
        feed = f;
        manager = m;
        router = r;
        key = k;
        keeper = kp;
        s0 = address(s) < address(u);
    }

    /// Called once the handler owns the mocks.
    function init() external {
        for (uint256 i = 0; i < 3; i++) {
            address a = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(a);
            stock.mint(a, 1e24);
            vm.prank(a);
            stock.approve(address(vault), type(uint256).max);
        }
        stock.mint(address(this), 1e30);
        usd.mint(address(this), 1e30);
        stock.approve(address(router), type(uint256).max);
        usd.approve(address(router), type(uint256).max);
    }

    function _state() internal view returns (OffmintVault.State) {
        return vault.state();
    }

    function _trackSupply() internal {
        OffmintVault.State st = _state();
        if ((st == OffmintVault.State.ARMED || st == OffmintVault.State.PENDING_BUYBACK) && vault.totalSupply() != supplyAtArm) {
            supplyChangedWhileLocked = true;
        }
    }

    // ------------------------------------------------------------------ user actions

    function deposit(uint256 seed, uint256 amt) external {
        calls++;
        address a = actors[seed % actors.length];
        amt = bound(amt, 1e12, 1000e18);
        vm.prank(a);
        try vault.deposit(amt, a) {} catch {}
        _trackSupply();
    }

    function redeem(uint256 seed, uint256 pct) external {
        calls++;
        address a = actors[seed % actors.length];
        uint256 sh = vault.balanceOf(a) * bound(pct, 1, 100) / 100;
        vm.prank(a);
        try vault.redeem(sh, a, a) {} catch {}
        vm.prank(a);
        try vault.redeemMixed(sh, a) {} catch {}
        _trackSupply();
    }

    function movePool(uint256 bps) external {
        calls++;
        uint256 target = price * bound(bps, 7000, 20_000) / 10_000;
        uint160 t = RangeMath.usdToSqrtPriceX96(target, dec, s0, false);
        (uint160 sp,,,) = manager.getSlot0(key.toId());
        if (t == sp) return;
        try router.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: t < sp, amountSpecified: -1e30, sqrtPriceLimitX96: t}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        ) {} catch {}
    }

    // ------------------------------------------------------------------ lifecycle

    /// Jump to the next Saturday 00:20 (Friday close printed at 20:00) and arm.
    function arm(uint16 prem, uint16 width, uint16 deploy) external {
        calls++;
        uint256 t = block.timestamp;
        uint256 dow = ((t / 1 days) + 4) % 7;
        uint256 toSat = (6 + 7 - dow) % 7;
        uint256 sat = (t / 1 days + (toSat == 0 ? 7 : toSat)) * 1 days;
        vm.warp(sat - 4 hours);
        feed.setAnswer(int256(price));
        vm.warp(sat + 20 minutes);
        uint256 supply = vault.totalSupply();
        vm.prank(keeper);
        try vault.arm(uint16(bound(prem, 1000, 3000)), uint16(bound(width, 1000, 10_000)), uint16(bound(deploy, 1, 3000))) {
            supplyAtArm = supply;
            arms++;
        } catch {}
    }

    function lock(bool nearOpen) external {
        calls++;
        if (nearOpen && _state() == OffmintVault.State.ARMED) {
            uint256 we = vault.currentEpoch().windowEnd;
            if (block.timestamp < we - 15 minutes) vm.warp(we - 15 minutes);
        }
        try vault.lock() {
            locks++;
        } catch {}
    }

    /// Reopen with a new fresh price and settle.
    function settle(uint256 moveBps) external {
        calls++;
        if (_state() != OffmintVault.State.ARMED) return;
        uint256 we = vault.currentEpoch().windowEnd;
        if (block.timestamp < we + 10 minutes) vm.warp(we + 10 minutes);
        price = price * bound(moveBps, 8000, 13_000) / 10_000;
        feed.setAnswer(int256(price));
        vm.warp(block.timestamp + 50 minutes);
        _settleLike(true);
    }

    /// A whole weekend in one call: arm, weekend pump, optional lock, Monday move, settle.
    /// @param monPremBps Pool premium over the fresh feed on Monday (> 100 bps = beyond the buyback cap).
    function cycle(uint256 pumpBps, uint256 reopenBps, bool doLock, uint16 deploy, uint256 monPremBps) external {
        this.arm(1000, 5000, deploy);
        if (_state() != OffmintVault.State.ARMED) return;
        this.movePool(bound(pumpBps, 10_000, 20_000));
        if (doLock) this.lock(true);
        uint256 we = vault.currentEpoch().windowEnd;
        if (block.timestamp < we + 10 minutes) vm.warp(we + 10 minutes);
        price = price * bound(reopenBps, 9000, 16_000) / 10_000;
        this.movePool(10_000 + bound(monPremBps, 0, 300)); // Monday mint arbitrage pulls the pool near the new price
        feed.setAnswer(int256(price));
        vm.warp(block.timestamp + 50 minutes);
        _settleLike(true);
    }

    function retry() external {
        calls++;
        feed.setAnswer(int256(price));
        _settleLike(false);
    }

    function unwindAndExpire(bool expire) external {
        calls++;
        if (_state() == OffmintVault.State.ARMED) {
            uint256 we = vault.currentEpoch().windowEnd;
            if (block.timestamp < we + 96 hours) vm.warp(we + 96 hours);
            try vault.emergencyUnwind() {} catch {}
        }
        if (expire && _state() == OffmintVault.State.PENDING_BUYBACK) {
            vm.warp(block.timestamp + 48 hours + 1);
            try vault.expireBuyback() {} catch {}
        }
    }

    function _settleLike(bool isSettle) internal {
        OffmintVault.State before = _state();
        uint256 feeBal = stock.balanceOf(vault.feeRecipient());
        vm.prank(keeper);
        if (isSettle) {
            try vault.settle(0) {} catch {}
        } else {
            try vault.retryBuyback(0) {} catch {}
        }
        uint256 fee = stock.balanceOf(vault.feeRecipient()) - feeBal;
        if (_state() == OffmintVault.State.PENDING_BUYBACK && before == OffmintVault.State.ARMED) pendings++;
        if (_state() == OffmintVault.State.OPEN && before != OffmintVault.State.OPEN) {
            opensFromBuyback++;
            OffmintVault.Epoch memory e = vault.currentEpoch();
            if (e.pnlStock > 0) ghostPositivePnl += uint256(e.pnlStock);
            ghostFees += fee;
        }
    }
}

abstract contract VaultInvariantBase is VaultSetup {
    VaultHandler handler;

    function setUp() public override {
        super.setUp();
        // the handler mints test balances and pushes feed prints, so it must own the mocks before construction
        handler = new VaultHandler(vault, stock, usd, feed, manager, swapRouter, key, keeperAddr);
        stock.transferOwnership(address(handler));
        usd.transferOwnership(address(handler));
        feed.transferOwnership(address(handler));
        handler.init();
        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](9);
        sel[0] = VaultHandler.deposit.selector;
        sel[1] = VaultHandler.redeem.selector;
        sel[2] = VaultHandler.movePool.selector;
        sel[3] = VaultHandler.arm.selector;
        sel[4] = VaultHandler.lock.selector;
        sel[5] = VaultHandler.settle.selector;
        sel[6] = VaultHandler.cycle.selector;
        sel[7] = VaultHandler.retry.selector;
        sel[8] = VaultHandler.unwindAndExpire.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    /// The handler's paths really reach arm -> lock -> settle -> fee (not silently reverting).
    function test_handlerSmoke() public {
        handler.cycle(17_000, 10_200, true, 3000, 0); // squeeze, lock, reopen +2%: profit
        assertEq(handler.arms(), 1, "arms");
        assertEq(handler.locks(), 1, "locks");
        assertEq(handler.opensFromBuyback(), 1, "opens");
        assertGt(handler.ghostFees(), 0, "fees");
        handler.cycle(17_000, 12_000, true, 3000, 300); // pool stays 3% over the fresh price: capped
        assertEq(handler.arms(), 2);
        assertEq(handler.pendings(), 1, "pending");
        handler.unwindAndExpire(true);
        assertEq(uint8(vault.state()), uint8(OffmintVault.State.OPEN_MIXED));
    }

    function afterInvariant() external view {
        console2.log("arms", handler.arms(), "locks", handler.locks());
        console2.log("settled->OPEN", handler.opensFromBuyback(), "->PENDING", handler.pendings());
        console2.log("fees", handler.ghostFees(), "positive pnl", handler.ghostPositivePnl());
    }

    /// Owner and keeper never receive vault funds.
    function invariant_ownerKeeperGetNothing() public view {
        assertEq(stock.balanceOf(owner), 0);
        assertEq(usd.balanceOf(owner), 0);
        assertEq(stock.balanceOf(keeperAddr), 0);
        assertEq(usd.balanceOf(keeperAddr), 0);
    }

    /// Share supply is frozen while a position or buyback is pending.
    function invariant_supplyFrozenWhileArmedOrPending() public view {
        assertFalse(handler.supplyChangedWhileLocked());
    }

    /// Performance fee never exceeds perfFeeBps (<= 20% bound) of realised positive PnL.
    function invariant_feeBounded() public view {
        assertLe(handler.ghostFees(), handler.ghostPositivePnl() * 2000 / 10_000 + 1);
    }

    /// Deposits / withdrawals are only possible in OPEN.
    function invariant_gating() public view {
        if (vault.state() != OffmintVault.State.OPEN) {
            assertEq(vault.maxDeposit(address(1)), 0);
            assertEq(vault.maxRedeem(address(1)), 0);
        }
    }

    /// In OPEN the vault holds no meaningful USDG (only dust that rolls into the next buyback).
    function invariant_openMeansNoUsdg() public view {
        if (vault.state() == OffmintVault.State.OPEN) {
            assertLe(usd.balanceOf(address(vault)), vault.USDG_DUST());
        }
    }

    /// The vault never leaves value inside the PoolManager outside ARMED.
    function invariant_noLivePositionOutsideArmed() public view {
        OffmintVault.Epoch memory e = vault.currentEpoch();
        if (vault.state() != OffmintVault.State.ARMED && e.id != 0) assertTrue(e.locked);
    }
}

contract VaultInvariantS0 is VaultInvariantBase {
    function stockFirst() internal pure override returns (bool) {
        return true;
    }
}

contract VaultInvariantS1 is VaultInvariantBase {
    function stockFirst() internal pure override returns (bool) {
        return false;
    }
}
