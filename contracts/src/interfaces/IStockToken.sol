// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice The subset of a Robinhood Stock Token (ERC-8056 style) that Offmint reads.
interface IStockToken {
    /// @notice True while the issuer has paused the oracle (e.g. during a corporate action).
    function oraclePaused() external view returns (bool);
    /// @notice Current display multiplier (1e18 = 1.0). Chainlink feeds already include it; never re-apply.
    function uiMultiplier() external view returns (uint256);
}
