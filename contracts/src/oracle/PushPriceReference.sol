// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPriceReference} from "../interfaces/IPriceReference.sol";
import {IStockToken} from "../interfaces/IStockToken.sol";

/// @title PushPriceReference — issuer-API price for stock tokens without a Chainlink feed (DRAFT, not wired yet)
/// @notice A dedicated poster (NOT the vault keeper — see docs/price-reference.md) posts the token price computed from
///         Robinhood's own API: mid(bid, ask) x currentMultiplier (the API is NOT multiplier-adjusted; Chainlink is).
///         `observedAt` is when the quote last CHANGED, not when it was fetched, so a weekend reads as "frozen" exactly
///         like a Chainlink feed does. Bounds limit what a compromised poster can do:
///         - timestamps strictly increase and are never in the future;
///         - a single post may move the price by at most `maxMoveBps`, unless the previous observation is at least
///           `gapAfter` old (a market reopen after a close, where real gaps happen);
///         - a halt flag (or the issuer's `oraclePaused`) makes `read()` revert.
contract PushPriceReference is IPriceReference {
    uint8 public constant DECIMALS = 8;

    address public immutable poster;
    IStockToken public immutable stock;
    uint16 public immutable maxMoveBps;
    uint32 public immutable gapAfter;
    string internal _description;

    uint256 public price;
    uint256 public observedAt;
    bool public halted;

    event Posted(uint256 price, uint256 observedAt, bool halted);

    error NotPoster();
    error BadTimestamp();
    error MoveTooLarge();
    error ZeroPrice();
    error OraclePaused();
    error NoPrice();
    error BadConfig();

    constructor(address poster_, IStockToken stock_, uint16 maxMoveBps_, uint32 gapAfter_, string memory description_) {
        if (poster_ == address(0) || address(stock_) == address(0) || maxMoveBps_ == 0) revert BadConfig();
        poster = poster_;
        stock = stock_;
        maxMoveBps = maxMoveBps_;
        gapAfter = gapAfter_;
        _description = description_;
    }

    /// @notice Post a new observation (poster only).
    /// @param price_ USD per token, 8 decimals, already multiplied by the token's currentMultiplier
    /// @param observedAt_ when the underlying quote last changed (not the fetch time)
    /// @param halted_ underlying trading halt (API isTradingHalt)
    function post(uint256 price_, uint256 observedAt_, bool halted_) external {
        if (msg.sender != poster) revert NotPoster();
        if (price_ == 0) revert ZeroPrice();
        if (observedAt_ <= observedAt || observedAt_ > block.timestamp) revert BadTimestamp();
        uint256 prev = price;
        if (prev != 0 && observedAt_ - observedAt < gapAfter) {
            uint256 diff = price_ > prev ? price_ - prev : prev - price_;
            if (diff * 10_000 > prev * maxMoveBps) revert MoveTooLarge();
        }
        price = price_;
        observedAt = observedAt_;
        halted = halted_;
        emit Posted(price_, observedAt_, halted_);
    }

    /// @inheritdoc IPriceReference
    function read() external view returns (uint256, uint8, uint256) {
        if (price == 0) revert NoPrice();
        if (halted || stock.oraclePaused()) revert OraclePaused();
        return (price, DECIMALS, observedAt);
    }

    /// @inheritdoc IPriceReference
    function description() external view returns (string memory) {
        return _description;
    }
}
