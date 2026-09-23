// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title RangeMath
/// @notice Converts Chainlink USD prices into Uniswap v4 sqrtPriceX96 / ticks for a STOCK/USDG pool,
///         in either currency orientation, and builds the one-sided premium sell range (SPEC §5).
/// @dev v4 price = currency1_raw per currency0_raw.
///      S0 (stock is currency0): price = USDG_raw / STOCK_raw -> rises with USD price, ticks negative.
///      S1 (stock is currency1): price = STOCK_raw / USDG_raw -> falls as USD price rises.
library RangeMath {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant Q192 = 1 << 192;

    error PriceZero();
    error PriceOutOfRange();
    error RangeInvalid();

    struct Decimals {
        uint8 feed; // Chainlink feed decimals (read from the feed, usually 8)
        uint8 stock; // STOCK token decimals (18)
        uint8 usd; // USDG decimals (6)
    }

    // ------------------------------------------------------------------ price <-> sqrtPrice

    /// @notice USD feed answer -> pool sqrtPriceX96.
    /// @param roundUp true returns a sqrtPrice >= the exact value, false returns one <= the exact value.
    function usdToSqrtPriceX96(uint256 answer, Decimals memory d, bool stockIs0, bool roundUp)
        internal
        pure
        returns (uint160)
    {
        if (answer == 0) revert PriceZero();
        uint256 scaleStock = 10 ** (uint256(d.feed) + d.stock);
        uint256 usdRaw = answer * 10 ** d.usd;
        uint256 x;
        if (stockIs0) {
            x = roundUp
                ? FullMath.mulDivRoundingUp(usdRaw, Q192, scaleStock)
                : FullMath.mulDiv(usdRaw, Q192, scaleStock);
        } else {
            x = roundUp
                ? FullMath.mulDivRoundingUp(scaleStock, Q192, usdRaw)
                : FullMath.mulDiv(scaleStock, Q192, usdRaw);
        }
        uint256 s = Math.sqrt(x, roundUp ? Math.Rounding.Ceil : Math.Rounding.Floor);
        if (s < TickMath.MIN_SQRT_PRICE || s >= TickMath.MAX_SQRT_PRICE) revert PriceOutOfRange();
        return uint160(s);
    }

    /// @notice Pool sqrtPriceX96 -> USD answer in feed decimals (rounded down).
    function sqrtPriceX96ToUsd(uint160 sqrtPriceX96, Decimals memory d, bool stockIs0) internal pure returns (uint256) {
        uint256 s = sqrtPriceX96;
        uint256 scale = 10 ** (uint256(d.feed) + d.stock - d.usd);
        if (stockIs0) {
            // usd = price * 10^(fd+ds-du), price = s^2 / 2^192
            return FullMath.mulDiv(FullMath.mulDiv(s, s, 1 << 64), scale, 1 << 128);
        } else {
            // usd = 10^(fd+ds-du) / price
            return FullMath.mulDiv(FullMath.mulDiv(scale, 1 << 96, s), 1 << 96, s);
        }
    }

    /// @notice USD answer -> pool tick (floor of the exact tick, from a floored sqrtPrice).
    function usdToTick(uint256 answer, Decimals memory d, bool stockIs0) internal pure returns (int24) {
        return TickMath.getTickAtSqrtPrice(usdToSqrtPriceX96(answer, d, stockIs0, false));
    }

    /// @notice USD value of a tick's price, in feed decimals.
    function tickToUsd(int24 tick, Decimals memory d, bool stockIs0) internal pure returns (uint256) {
        return sqrtPriceX96ToUsd(TickMath.getSqrtPriceAtTick(tick), d, stockIs0);
    }

    // ------------------------------------------------------------------ tick spacing

    /// @notice Largest multiple of `spacing` that is <= `tick` (true floor, correct for negatives).
    function floorToSpacing(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 q = tick / spacing;
        if (tick % spacing != 0 && tick < 0) q -= 1;
        return q * spacing;
    }

    /// @notice Smallest multiple of `spacing` that is >= `tick`.
    function ceilToSpacing(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 q = tick / spacing;
        if (tick % spacing != 0 && tick > 0) q += 1;
        return q * spacing;
    }

    // ------------------------------------------------------------------ sell range

    /// @notice Builds the one-sided sell range for band [p0*(1+premium), p0*(1+premium+width)] (SPEC §5.2).
    /// @dev Edges are always rounded AWAY from the current price. Guarantees, in USD terms,
    ///      price(range edge nearest to market) >= p0 * (1 + premiumBps), and that the position holds only STOCK:
    ///      S0: curTick < tickLower.  S1: tickUpper <= curTick.
    function sellRange(
        uint256 p0,
        uint256 premiumBps,
        uint256 widthBps,
        int24 curTick,
        int24 spacing,
        Decimals memory d,
        bool stockIs0
    ) internal pure returns (int24 tickLower, int24 tickUpper) {
        uint256 lUsd = FullMath.mulDivRoundingUp(p0, BPS + premiumBps, BPS);
        uint256 uUsd = FullMath.mulDiv(p0, BPS + premiumBps + widthBps, BPS);

        if (stockIs0) {
            // USD rises with tick. Need price(tickLower) >= lUsd: smallest tick with sqrt(tick) >= ceil sqrt(lUsd).
            uint160 sL = usdToSqrtPriceX96(lUsd, d, true, true);
            int24 tL = TickMath.getTickAtSqrtPrice(sL);
            if (TickMath.getSqrtPriceAtTick(tL) < sL) tL += 1;
            tickLower = ceilToSpacing(tL, spacing);
            tickUpper = floorToSpacing(usdToTick(uUsd, d, true), spacing);
            if (tickLower <= curTick) tickLower = ceilToSpacing(curTick + 1, spacing);
        } else {
            // USD falls as tick rises. Need price(tickUpper) >= lUsd: largest tick with sqrt(tick) <= floor sqrt(lUsd).
            tickUpper = floorToSpacing(usdToTick(lUsd, d, false), spacing);
            int24 tL = TickMath.getTickAtSqrtPrice(usdToSqrtPriceX96(uUsd, d, false, true));
            tickLower = ceilToSpacing(tL, spacing);
            if (tickUpper > curTick) tickUpper = floorToSpacing(curTick, spacing);
        }
        if (tickUpper <= tickLower) revert RangeInvalid();
        if (tickLower < TickMath.minUsableTick(spacing) || tickUpper > TickMath.maxUsableTick(spacing)) {
            revert RangeInvalid();
        }
    }

    /// @notice Buyback price limit: freshPrice * (1 + slippageBps) as a sqrtPriceX96 (SPEC §5.3).
    /// @dev S0 buys currency0 (zeroForOne=false, price rises to the cap). S1 buys currency1 (zeroForOne=true,
    ///      price falls to the cap). Rounded so the cap never exceeds the USD limit.
    function buybackSqrtCap(uint256 freshPrice, uint256 slippageBps, Decimals memory d, bool stockIs0)
        internal
        pure
        returns (uint160)
    {
        uint256 capUsd = FullMath.mulDiv(freshPrice, BPS + slippageBps, BPS);
        // S0: lower sqrt = lower USD -> floor. S1: higher sqrt = lower USD -> ceil.
        return usdToSqrtPriceX96(capUsd, d, stockIs0, !stockIs0);
    }
}
