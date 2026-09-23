// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ISessionClock} from "../interfaces/ISessionClock.sol";

/// @title SessionClock
/// @notice Pure-timestamp weekend window: Sat 00:00 UTC -> Mon 00:00 UTC, shifted by `sessionOffset`.
/// @dev Uses block timestamps only (never block.number, which is the L1 height on Robinhood Chain).
///      1970-01-01 was a Thursday, so dow(t) = ((t / 1 days) + 4) % 7 gives 0 = Sunday ... 6 = Saturday.
contract SessionClock is ISessionClock, Ownable2Step {
    int256 public constant MAX_OFFSET = 3 hours;
    uint256 internal constant WINDOW_LENGTH = 2 days;

    /// @notice Seconds added to Sat/Mon 00:00 UTC. +1h once EU/US leave summer time.
    int256 public sessionOffset;

    event SessionOffsetUpdated(int256 offset);

    error OffsetOutOfBounds();

    constructor(address owner_, int256 offset_) Ownable(owner_) {
        _setOffset(offset_);
    }

    /// @notice Owner-only; bounded to [-3h, +3h].
    function setSessionOffset(int256 offset_) external onlyOwner {
        _setOffset(offset_);
    }

    /// @inheritdoc ISessionClock
    function inWeekendWindow(uint256 ts) external view returns (bool) {
        uint256 d = dow(_shift(ts));
        return d == 6 || d == 0;
    }

    /// @inheritdoc ISessionClock
    function windowStart(uint256 ts) public view returns (uint256) {
        uint256 t = _shift(ts);
        uint256 dayStart = t - (t % 1 days);
        uint256 daysSinceSat = (dow(t) + 1) % 7; // Sat 0, Sun 1, Mon 2 ... Fri 6
        return _unshift(dayStart - daysSinceSat * 1 days);
    }

    /// @inheritdoc ISessionClock
    function windowEnd(uint256 ts) external view returns (uint256) {
        return windowStart(ts) + WINDOW_LENGTH;
    }

    /// @notice Day of week for a UTC timestamp: 0 = Sunday ... 6 = Saturday.
    function dow(uint256 t) public pure returns (uint256) {
        return ((t / 1 days) + 4) % 7;
    }

    function _shift(uint256 ts) internal view returns (uint256) {
        return uint256(int256(ts) - sessionOffset);
    }

    function _unshift(uint256 t) internal view returns (uint256) {
        return uint256(int256(t) + sessionOffset);
    }

    function _setOffset(int256 offset_) internal {
        if (offset_ > MAX_OFFSET || offset_ < -MAX_OFFSET) revert OffsetOutOfBounds();
        sessionOffset = offset_;
        emit SessionOffsetUpdated(offset_);
    }
}
