// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IPriceReference — where the vault's P0 / buyback cap price comes from
/// @notice DRAFT abstraction (not wired into OffmintVault yet). The vault's timing rules only need a
///         (price, updatedAt) pair: "frozen" at arm (now - updatedAt >= minFrozen, recent close) and "fresh" at settle
///         (updatedAt >= windowEnd, now - updatedAt <= maxFreshAge). Any source that can honestly report those two
///         numbers can back a vault. See docs/price-reference.md for the candidate sources and their risks.
interface IPriceReference {
    /// @notice Latest USD price per 1 STOCK token and when it was observed.
    /// @dev MUST revert if the source is unhealthy (non-positive answer, issuer oracle paused, sequencer down...).
    ///      Freshness is judged by the caller, never inside the adapter.
    /// @return price USD per token, scaled by `decimals`
    /// @return decimals price decimals
    /// @return updatedAt timestamp of the observation (block.timestamp domain)
    function read() external view returns (uint256 price, uint8 decimals, uint256 updatedAt);

    /// @notice Human-readable source label (e.g. "Chainlink RHTSLA / USD").
    function description() external view returns (string memory);
}
