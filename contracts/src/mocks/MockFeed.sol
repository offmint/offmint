// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/// @title MockFeed — TESTNET / TESTS ONLY
/// @notice Owner-set Chainlink-style feed. Chainlink stock feeds exist on Robinhood mainnet only.
contract MockFeed is AggregatorV3Interface, Ownable {
    uint8 public immutable decimals;
    string public description;
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;

    constructor(address owner_, uint8 decimals_, string memory description_, int256 answer_) Ownable(owner_) {
        decimals = decimals_;
        description = description_;
        _set(answer_, block.timestamp);
    }

    /// @notice Push a new answer stamped with the current block time.
    function setAnswer(int256 answer_) external onlyOwner {
        _set(answer_, block.timestamp);
    }

    /// @notice Push a new answer with an explicit updatedAt (tests / sequencer-feed simulation).
    function setAnswerAt(int256 answer_, uint256 updatedAt_) external onlyOwner {
        _set(answer_, updatedAt_);
    }

    /// @inheritdoc AggregatorV3Interface
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, roundId);
    }

    function _set(int256 answer_, uint256 ts) internal {
        roundId++;
        answer = answer_;
        startedAt = ts;
        updatedAt = ts;
    }
}
