// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title Faucet — TESTNET ONLY
/// @notice Pre-funded dispenser of the testnet mock tokens (test USDG + mock stock) so anyone with an empty wallet can
///         try Offmint. The mocks' `mint` stays owner-only; this contract only hands out what it was funded with.
///         One claim per address per 24 h. Refill = send tokens to this address.
contract Faucet is Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant COOLDOWN = 24 hours;

    IERC20 public immutable usdg;
    IERC20 public immutable stock;
    uint256 public usdgPerClaim;
    uint256 public stockPerClaim;
    bool public paused;
    mapping(address => uint256) public lastClaimAt;

    event Claimed(address indexed to, uint256 usdg, uint256 stock);
    event AmountsSet(uint256 usdgPerClaim, uint256 stockPerClaim);
    event Paused(bool paused);

    error IsPaused();
    error TooSoon(uint256 nextClaimAt);
    error Empty();

    /// @param usdgPerClaim_ test USDG per claim (6 decimals), e.g. 1_000e6
    /// @param stockPerClaim_ mock stock per claim (18 decimals), e.g. 10e18
    constructor(IERC20 usdg_, IERC20 stock_, uint256 usdgPerClaim_, uint256 stockPerClaim_, address owner_)
        Ownable(owner_)
    {
        usdg = usdg_;
        stock = stock_;
        usdgPerClaim = usdgPerClaim_;
        stockPerClaim = stockPerClaim_;
    }

    /// @notice Send `usdgPerClaim` test USDG and `stockPerClaim` mock stock to the caller. Once per 24 h per address.
    function claim() external {
        if (paused) revert IsPaused();
        uint256 last = lastClaimAt[msg.sender];
        if (last != 0 && block.timestamp < last + COOLDOWN) revert TooSoon(last + COOLDOWN);
        if (usdg.balanceOf(address(this)) < usdgPerClaim || stock.balanceOf(address(this)) < stockPerClaim) {
            revert Empty();
        }
        lastClaimAt[msg.sender] = block.timestamp;
        usdg.safeTransfer(msg.sender, usdgPerClaim);
        stock.safeTransfer(msg.sender, stockPerClaim);
        emit Claimed(msg.sender, usdgPerClaim, stockPerClaim);
    }

    /// @notice Seconds until `who` can claim again (0 = now).
    function waitFor(address who) external view returns (uint256) {
        uint256 last = lastClaimAt[who];
        if (last == 0 || block.timestamp >= last + COOLDOWN) return 0;
        return last + COOLDOWN - block.timestamp;
    }

    /// @notice Change the per-claim amounts (owner).
    function setAmounts(uint256 usdgPerClaim_, uint256 stockPerClaim_) external onlyOwner {
        usdgPerClaim = usdgPerClaim_;
        stockPerClaim = stockPerClaim_;
        emit AmountsSet(usdgPerClaim_, stockPerClaim_);
    }

    /// @notice Pause or resume claims (owner).
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    /// @notice Recover tokens, e.g. when retiring the faucet (owner, testnet mocks only).
    function sweep(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
    }
}
