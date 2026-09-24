// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {MetaVault} from "../src/MetaVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {OffmintVault} from "../src/OffmintVault.sol";
import {OffmintParams} from "../src/libraries/OffmintParams.sol";
import {ISessionClock} from "../src/interfaces/ISessionClock.sol";

/// @title DeployMeta — redeploy MetaVault on an existing deployment (testnet), wired to the existing factory.
/// @notice Deploys a fresh MetaVault from the current source, has the factory deploy its exclusive OffmintVault
///         instance, applies demo-speed timing (inside the hard bounds), and records the new addresses in
///         deployments/<chainId>.json (the previous MetaVault is kept as `metaVaultV1`).
///   forge script script/DeployMeta.s.sol --rpc-url $RPC --broadcast --slow   (testnet; ask first)
contract DeployMeta is Script {
    function run() external returns (address meta, address instance) {
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory j = vm.readFile(path);
        address stock = vm.parseJsonAddress(j, ".stock");
        VaultFactory f = VaultFactory(vm.parseJsonAddress(j, ".factory"));
        address old = vm.parseJsonAddress(j, ".metaVault");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(pk);
        MetaVault m = new MetaVault(
            IERC20(vm.parseJsonAddress(j, ".usdg")),
            IPoolManager(vm.parseJsonAddress(j, ".poolManager")),
            ISessionClock(vm.parseJsonAddress(j, ".clock")),
            f,
            vm.addr(pk),
            vm.parseJsonAddress(j, ".keeper"),
            vm.parseJsonAddress(j, ".feeRecipient")
        );
        instance = f.deployVault(stock, address(m));
        OffmintVault v = OffmintVault(instance);
        OffmintParams.Params memory p = v.getParams();
        p.armDelay = 1 minutes;
        p.minFrozen = 5 minutes;
        p.settleDelay = 30 minutes;
        p.armGrace = 30 minutes;
        p.settleGrace = 30 minutes;
        v.setParams(p);
        vm.stopBroadcast();

        meta = address(m);
        vm.writeJson(vm.toString(old), path, ".metaVaultV1");
        vm.writeJson(vm.toString(meta), path, ".metaVault");
        vm.writeJson(vm.toString(instance), path, ".metaInstance");
        console2.log("MetaVault", meta);
        console2.log("MetaVault-only instance", instance);
    }
}
