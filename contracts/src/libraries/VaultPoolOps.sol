// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "@uniswap/v4-core/src/libraries/TransientStateLibrary.sol";

/// @title VaultPoolOps — OffmintVault's PoolManager plumbing (SPEC §6.6), as a linked library
/// @notice Runs via DELEGATECALL from inside `OffmintVault.unlockCallback`, so every call below is made AS the vault:
///         same address, same token balances, same PoolManager deltas. It holds no state and has no access control of
///         its own; the vault checks `msg.sender == poolManager` before calling in. Split out only to keep the vault
///         under the EIP-170 size limit.
library VaultPoolOps {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    /// @notice One rung's position identifiers.
    struct Pos {
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        bytes32 salt;
    }

    /// @notice The vault's pool context.
    struct Ctx {
        IPoolManager pm;
        PoolKey key;
        bool stockIs0;
        address stock;
        address usdg;
    }

    error NotSingleSided();

    /// @notice ARM (SPEC §6.6): add every rung, require each to be single-sided (STOCK only), pay once.
    /// @return owed STOCK paid into each rung (0 for skipped rungs)
    function armRungs(Ctx memory c, Pos[] memory pos) public returns (uint256[] memory owed) {
        owed = new uint256[](pos.length);
        for (uint256 i = 0; i < pos.length; i++) {
            if (pos[i].liquidity == 0) continue; // rung skipped (already crossed at arm)
            (BalanceDelta delta,) = c.pm.modifyLiquidity(c.key, _mlp(pos[i], int256(uint256(pos[i].liquidity))), "");
            (int128 dStock, int128 dUsd) = _split(c, delta);
            if (dUsd != 0 || dStock >= 0) revert NotSingleSided();
            owed[i] = uint256(uint128(-dStock));
        }
        _settleDeltas(c);
    }

    /// @notice LOCK / SETTLE / EMERGENCY_UNWIND (SPEC §6.6): remove the given rungs, optionally one combined buyback
    ///         capped at `sqrtCap`, then clear all deltas.
    function removeRungs(Ctx memory c, Pos[] memory pos, bool buyback, uint160 sqrtCap)
        public
        returns (uint256[] memory s, uint256[] memory u, uint256 bought)
    {
        s = new uint256[](pos.length);
        u = new uint256[](pos.length);
        for (uint256 i = 0; i < pos.length; i++) {
            if (pos[i].liquidity == 0) continue;
            (BalanceDelta delta,) = c.pm.modifyLiquidity(c.key, _mlp(pos[i], -int256(uint256(pos[i].liquidity))), "");
            (int128 dStock, int128 dUsd) = _split(c, delta);
            (s[i], u[i]) = (uint256(uint128(dStock)), uint256(uint128(dUsd)));
        }
        if (buyback) bought = _buyback(c, sqrtCap);
        _settleDeltas(c);
    }

    /// @notice RETRY_BUYBACK: swap only, with a fresh cap.
    function retry(Ctx memory c, uint160 sqrtCap) public returns (uint256 bought) {
        bought = _buyback(c, sqrtCap);
        _settleDeltas(c);
    }

    /// @notice Swap an exact input between STOCK and USDG, stopping at `sqrtLimit` (partial fill, never reverts on the
    ///         limit), then clear deltas. MetaVault's BUY-IN (`buyStock`) and UNWIND (sell) use it: the same capped swap
    ///         as the Monday buyback, with an explicit amount instead of "all USDG".
    /// @return amountIn tokens actually paid, amountOut tokens received
    function swapExact(Ctx memory c, bool buyStock, uint256 amount, uint160 sqrtLimit)
        public
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut) = _swap(c, buyStock, amount, sqrtLimit);
        _settleDeltas(c);
    }

    /// @dev Swap all USDG (PoolManager credit + vault balance) for STOCK, stopping at `sqrtCap` (partial fill, no revert).
    function _buyback(Ctx memory c, uint160 sqrtCap) private returns (uint256 bought) {
        int256 credit = c.pm.currencyDelta(address(this), Currency.wrap(c.usdg));
        uint256 usdIn = IERC20(c.usdg).balanceOf(address(this)) + (credit > 0 ? uint256(credit) : 0);
        (, bought) = _swap(c, true, usdIn, sqrtCap);
    }

    /// @dev The one capped swap primitive. `buyStock`: pay USDG for STOCK; else pay STOCK for USDG.
    function _swap(Ctx memory c, bool buyStock, uint256 amount, uint160 sqrtLimit)
        private
        returns (uint256 amountIn, uint256 amountOut)
    {
        if (amount == 0) return (0, 0);
        bool zeroForOne = buyStock != c.stockIs0; // paying currency0?
        (uint160 sp,,,) = c.pm.getSlot0(c.key.toId());
        // pool already at/through the limit: nothing can trade inside it
        if (zeroForOne ? sp <= sqrtLimit : sp >= sqrtLimit) return (0, 0);
        BalanceDelta delta = c.pm
            .swap(
                c.key,
                IPoolManager.SwapParams({
                    zeroForOne: zeroForOne, amountSpecified: -int256(amount), sqrtPriceLimitX96: sqrtLimit
                }),
                ""
            );
        (int128 dStock, int128 dUsd) = _split(c, delta);
        (int128 dIn, int128 dOut) = buyStock ? (dUsd, dStock) : (dStock, dUsd);
        amountIn = dIn < 0 ? uint256(uint128(-dIn)) : 0;
        amountOut = dOut > 0 ? uint256(uint128(dOut)) : 0;
    }

    /// @dev Clear the vault's open deltas: take credits, pay debts from the vault balance.
    function _settleDeltas(Ctx memory c) private {
        _clear(c.pm, Currency.wrap(c.stock));
        _clear(c.pm, Currency.wrap(c.usdg));
    }

    function _clear(IPoolManager pm, Currency cur) private {
        int256 d = pm.currencyDelta(address(this), cur);
        if (d > 0) {
            pm.take(cur, address(this), uint256(d));
        } else if (d < 0) {
            pm.sync(cur);
            IERC20(Currency.unwrap(cur)).safeTransfer(address(pm), uint256(-d));
            pm.settle();
        }
    }

    function _mlp(Pos memory ps, int256 delta) private pure returns (IPoolManager.ModifyLiquidityParams memory) {
        return IPoolManager.ModifyLiquidityParams({
            tickLower: ps.tickLower, tickUpper: ps.tickUpper, liquidityDelta: delta, salt: ps.salt
        });
    }

    function _split(Ctx memory c, BalanceDelta d) private pure returns (int128 dStock, int128 dUsd) {
        return c.stockIs0 ? (d.amount0(), d.amount1()) : (d.amount1(), d.amount0());
    }
}
