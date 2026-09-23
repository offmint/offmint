// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ISessionClock} from "../interfaces/ISessionClock.sol";

/// @title ManualSessionClock — TESTNET DEMO ONLY
/// @notice Owner opens/closes the "weekend" by hand so a full epoch can be demoed without waiting for Saturday.
///         Never use on mainnet: the owner controls when the vault may arm and settle.
contract ManualSessionClock is ISessionClock, Ownable2Step {
    uint256 public start;
    uint256 public end;

    event WindowSet(uint256 start, uint256 end);

    error BadWindow();

    constructor(address owner_) Ownable(owner_) {}

    /// @notice Opens a window now that lasts `duration` seconds.
    function openWindow(uint256 duration) external onlyOwner {
        _set(block.timestamp, block.timestamp + duration);
    }

    /// @notice Ends the current window now (the "Monday reopen").
    function closeWindow() external onlyOwner {
        if (block.timestamp < start) revert BadWindow();
        _set(start, block.timestamp);
    }

    /// @notice Sets an explicit window.
    function setWindow(uint256 start_, uint256 end_) external onlyOwner {
        _set(start_, end_);
    }

    /// @inheritdoc ISessionClock
    function inWeekendWindow(uint256 ts) external view returns (bool) {
        return ts >= start && ts < end;
    }

    /// @inheritdoc ISessionClock
    function windowStart(uint256) external view returns (uint256) {
        return start;
    }

    /// @inheritdoc ISessionClock
    function windowEnd(uint256) external view returns (uint256) {
        return end;
    }

    function _set(uint256 start_, uint256 end_) internal {
        if (end_ <= start_) revert BadWindow();
        start = start_;
        end = end_;
        emit WindowSet(start_, end_);
    }
}
