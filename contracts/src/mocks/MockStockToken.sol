// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IStockToken} from "../interfaces/IStockToken.sol";

/// @title MockStockToken — TESTNET / TESTS ONLY
/// @notice 18-decimal ERC-20 exposing the ERC-8056 bits Offmint reads (`oraclePaused`, `uiMultiplier`).
contract MockStockToken is ERC20, Ownable, IStockToken {
    bool public oraclePaused;
    uint256 public uiMultiplier = 1e18;

    constructor(address owner_, string memory name_, string memory symbol_) ERC20(name_, symbol_) Ownable(owner_) {}

    /// @notice Owner mint (faucet for the demo).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Simulate the issuer pausing the oracle.
    function setOraclePaused(bool p) external onlyOwner {
        oraclePaused = p;
    }
}
