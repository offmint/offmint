// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Answers "is stock-token minting closed right now, and when does that window start/end?"
interface ISessionClock {
    /// @notice True iff `ts` is inside the weekend window [windowStart, windowEnd).
    function inWeekendWindow(uint256 ts) external view returns (bool);
    /// @notice Start of the window containing `ts`, or of the most recent window before `ts`.
    function windowStart(uint256 ts) external view returns (uint256);
    /// @notice End of the window whose start is `windowStart(ts)`.
    function windowEnd(uint256 ts) external view returns (uint256);
}
