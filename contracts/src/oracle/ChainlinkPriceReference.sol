// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPriceReference} from "../interfaces/IPriceReference.sol";
import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";
import {IStockToken} from "../interfaces/IStockToken.sol";

/// @title ChainlinkPriceReference — IPriceReference over a Chainlink stock feed (DRAFT, not wired yet)
/// @notice Exactly the health checks OffmintVault._readFeed applies today (SPEC §4): answer > 0, issuer
///         `oraclePaused() == false`, and the L2 sequencer uptime feed (status 0 + 1h grace) when one is configured.
contract ChainlinkPriceReference is IPriceReference {
    uint256 public constant SEQ_GRACE = 3600;

    AggregatorV3Interface public immutable feed;
    AggregatorV3Interface public immutable sequencerFeed; // address(0) disables the check
    IStockToken public immutable stock;

    error OracleStale();
    error OraclePaused();
    error SequencerDown();

    constructor(AggregatorV3Interface feed_, AggregatorV3Interface sequencerFeed_, IStockToken stock_) {
        feed = feed_;
        sequencerFeed = sequencerFeed_;
        stock = stock_;
    }

    /// @inheritdoc IPriceReference
    function read() external view returns (uint256 price, uint8 decimals, uint256 updatedAt) {
        if (address(sequencerFeed) != address(0)) {
            (, int256 status, uint256 startedAt,,) = sequencerFeed.latestRoundData();
            if (status != 0 || startedAt == 0 || block.timestamp - startedAt <= SEQ_GRACE) revert SequencerDown();
        }
        if (stock.oraclePaused()) revert OraclePaused();
        (, int256 answer,, uint256 ts,) = feed.latestRoundData();
        if (answer <= 0) revert OracleStale();
        return (uint256(answer), feed.decimals(), ts);
    }

    /// @inheritdoc IPriceReference
    function description() external view returns (string memory) {
        return string.concat("Chainlink ", feed.description());
    }
}
