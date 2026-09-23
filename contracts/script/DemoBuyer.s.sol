// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";

import {RangeMath} from "../src/libraries/RangeMath.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {ManualSessionClock} from "../src/clock/ManualSessionClock.sol";

/// @title DemoBuyer — testnet demo controls (owner of the mocks / manual clock)
/// @notice One step per call, so a live demo can narrate each one. The keeper bot reacts (arm / lock / settle).
///   forge script script/DemoBuyer.s.sol --sig "fridayClose()"            --rpc-url $RPC --broadcast
///   forge script script/DemoBuyer.s.sol --sig "openWeekend(uint256)" 2400 --rpc-url $RPC --broadcast  # 40-min weekend
///   forge script script/DemoBuyer.s.sol --sig "pump(uint256)" 4900000000 --rpc-url $RPC --broadcast  # move pool to $49
///   forge script script/DemoBuyer.s.sol --sig "closeWeekend()"           --rpc-url $RPC --broadcast
///   forge script script/DemoBuyer.s.sol --sig "mondayPrint(uint256)" 2950000000 --rpc-url $RPC --broadcast
/// Reads deployments/<chainId>.json. Env: DEPLOYER_PRIVATE_KEY.
contract DemoBuyer is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    struct D {
        IPoolManager pm;
        MockFeed feed;
        ManualSessionClock clock;
        PoolSwapTest router;
        PoolKey key;
        bool s0;
    }

    function _load() internal view returns (D memory d) {
        string memory j = vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
        d.pm = IPoolManager(vm.parseJsonAddress(j, ".poolManager"));
        d.feed = MockFeed(vm.parseJsonAddress(j, ".feed"));
        d.clock = ManualSessionClock(vm.parseJsonAddress(j, ".clock"));
        d.router = PoolSwapTest(vm.parseJsonAddress(j, ".swapRouter"));
        d.s0 = vm.parseJsonBool(j, ".stockIsCurrency0");
        address stock = vm.parseJsonAddress(j, ".stock");
        address usdg = vm.parseJsonAddress(j, ".usdg");
        (address c0, address c1) = d.s0 ? (stock, usdg) : (usdg, stock);
        d.key = PoolKey(
            Currency.wrap(c0),
            Currency.wrap(c1),
            uint24(vm.parseJsonUint(j, ".poolFee")),
            int24(vm.parseJsonInt(j, ".tickSpacing")),
            IHooks(address(0))
        );
    }

    function _dec() internal pure returns (RangeMath.Decimals memory) {
        return RangeMath.Decimals({feed: 8, stock: 18, usd: 6});
    }

    /// @notice "Friday close": the feed prints the current pool price (market still open).
    function fridayClose() external {
        D memory d = _load();
        (uint160 sp,,,) = d.pm.getSlot0(d.key.toId());
        uint256 px = RangeMath.sqrtPriceX96ToUsd(sp, _dec(), d.s0);
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        d.feed.setAnswer(int256(px));
        vm.stopBroadcast();
        console2.log("feed close print (USD e8)", px);
    }

    /// @notice Minting "closes": open the weekend window for `duration` seconds.
    function openWeekend(uint256 duration) external {
        D memory d = _load();
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        d.clock.openWindow(duration);
        vm.stopBroadcast();
        console2.log("weekend open until", d.clock.end());
    }

    /// @notice Weekend buyer (or Monday seller): trade the pool to `targetE8` USD per STOCK.
    function pump(uint256 targetE8) external {
        D memory d = _load();
        uint160 target = RangeMath.usdToSqrtPriceX96(targetE8, _dec(), d.s0, false);
        (uint160 sp,,,) = d.pm.getSlot0(d.key.toId());
        require(target != sp, "already there");
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        d.router
            .swap(
                d.key,
                IPoolManager.SwapParams({zeroForOne: target < sp, amountSpecified: -1e30, sqrtPriceLimitX96: target}),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                ""
            );
        vm.stopBroadcast();
        (sp,,,) = d.pm.getSlot0(d.key.toId());
        console2.log("pool price now (USD e8)", RangeMath.sqrtPriceX96ToUsd(sp, _dec(), d.s0));
    }

    /// @notice Minting "reopens": end the weekend window now.
    /// @dev Only affects a window that has not been armed yet: the vault stores windowEnd at arm time, so for the
    ///      demo open a window of the intended length (e.g. 40 min) and let it expire.
    function closeWeekend() external {
        D memory d = _load();
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        d.clock.closeWindow();
        vm.stopBroadcast();
    }

    /// @notice Oracle comes back fresh after reopen.
    function mondayPrint(uint256 priceE8) external {
        D memory d = _load();
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        d.feed.setAnswer(int256(priceE8));
        vm.stopBroadcast();
    }
}
