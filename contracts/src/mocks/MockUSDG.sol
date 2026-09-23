// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSDG — TESTNET / TESTS ONLY
/// @notice 6-decimal stand-in for Paxos USDG.
contract MockUSDG is ERC20, Ownable {
    constructor(address owner_) ERC20("Mock Global Dollar", "USDG") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Owner mint (faucet for the demo).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
