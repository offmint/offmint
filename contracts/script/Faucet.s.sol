// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Faucet} from "../src/mocks/Faucet.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";

/// @title DeployFaucet — TESTNET ONLY
/// @notice Deploys a Faucet for the deployment's mock USDG + mock stock, funds it (the deployer owns the mocks), and
///         records `faucet` in deployments/<chainId>.json.
///   forge script script/Faucet.s.sol --rpc-url $RH_TESTNET_RPC --broadcast --slow   (ask first)
/// Env: DEPLOYER_PRIVATE_KEY; FAUCET_USDG_FUND (default 10,000,000e6), FAUCET_STOCK_FUND (default 100,000e18)
contract DeployFaucet is Script {
    function run() external returns (address faucet) {
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);
        address usdg = vm.parseJsonAddress(json, ".usdg");
        address stock = vm.parseJsonAddress(json, ".stock");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me = vm.addr(pk);

        vm.startBroadcast(pk);
        Faucet f = new Faucet(IERC20(usdg), IERC20(stock), 1_000e6, 10e18, me);
        MockUSDG(usdg).mint(address(f), vm.envOr("FAUCET_USDG_FUND", uint256(10_000_000e6)));
        MockStockToken(stock).mint(address(f), vm.envOr("FAUCET_STOCK_FUND", uint256(100_000e18)));
        vm.stopBroadcast();

        faucet = address(f);
        vm.writeJson(vm.toString(faucet), path, ".faucet");
        console2.log("faucet", faucet);
    }
}
