// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {ISessionClock} from "./interfaces/ISessionClock.sol";
import {IPriceReference} from "./interfaces/IPriceReference.sol";
import {IStockToken} from "./interfaces/IStockToken.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {ChainlinkPriceReference} from "./oracle/ChainlinkPriceReference.sol";
import {PushPriceReference} from "./oracle/PushPriceReference.sol";
import {OffmintVault} from "./OffmintVault.sol";
import {IVaultRegistry} from "./MetaVault.sol";

/// @title VaultFactory — OffmintVault deployment for canonical stock tokens (SPEC §6.5.4)
/// @notice Each basket ticker gets up to two instances: the community one (`restrictedDepositor = address(0)`, open,
///         market-neutral for existing holders) and MetaVault's exclusive one (`restrictedDepositor = metaVault`).
///         Both read the same price reference: a ChainlinkPriceReference if the listing has a feed, else one
///         PushPriceReference per stock (no-feed basket member).
/// @dev There is no onchain copy of Robinhood's canonical token registry, so deployment is owner-only and the owner
///      mirrors the registry entry here (`setListing`): canonical flag, Chainlink feed (or none), hook-free pool.
///      Everything else is fixed at construction. The factory has no power over deployed vaults.
///      OffmintVault's initcode is ~28 KB, too big to embed (EIP-170), so it is stored in data contracts
///      (`uploadVaultCode`) and pinned by `vaultCodeHash`: a deploy reverts unless the stored code hashes to it.
contract VaultFactory is IVaultRegistry, Ownable2Step {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice Owner-mirrored entry from Robinhood's canonical registry.
    struct Listing {
        bool canonical;
        address feed; // Chainlink feed, or address(0) for a no-feed listing (PushPriceReference)
        uint24 fee; // hook-free STOCK/USDG pool
        int24 tickSpacing;
    }

    /// @notice Everything a deployed vault is wired to.
    struct Wiring {
        IPoolManager poolManager;
        ISessionClock clock;
        IERC20 usdg;
        address vaultOwner;
        address keeper;
        address feeRecipient;
        address poster; // PushPriceReference poster (never the keeper)
        address refOwner; // PushPriceReference owner (can freeze it)
        address sequencerFeed; // L2 sequencer uptime feed, or address(0)
    }

    uint16 public constant PUSH_MAX_MOVE_BPS = 2000;
    uint32 public constant PUSH_GAP_AFTER = 12 hours;

    bytes32 public immutable vaultCodeHash;
    IPoolManager public immutable poolManager;
    ISessionClock public immutable clock;
    IERC20 public immutable usdg;
    address public immutable vaultOwner;
    address public immutable keeper;
    address public immutable feeRecipient;
    address public immutable poster;
    address public immutable refOwner;
    address public immutable sequencerFeed;

    address[] internal _codeChunks;
    bool public codeSealed;
    mapping(address stock => Listing) public listings;
    mapping(address stock => mapping(address restrictedDepositor => address)) public vaultFor;
    mapping(address stock => address) public refFor;
    address[] internal _all;

    event Listed(address indexed stock, Listing listing);
    event VaultDeployed(
        address indexed stock, address indexed restrictedDepositor, address vault, address priceRef, bool pushReference
    );
    event CodeSealed(uint256 chunks);

    error NotCanonical();
    error AlreadyDeployed();
    error PoolNotInitialized();
    error CodeNotSealed();
    error Sealed();
    error BadConfig();

    constructor(bytes32 vaultCodeHash_, Wiring memory w, address owner_) Ownable(owner_) {
        if (
            vaultCodeHash_ == bytes32(0) || w.keeper == address(0) || w.poster == address(0) || w.poster == w.keeper
                || w.refOwner == address(0)
        ) revert BadConfig();
        vaultCodeHash = vaultCodeHash_;
        poolManager = w.poolManager;
        clock = w.clock;
        usdg = w.usdg;
        vaultOwner = w.vaultOwner;
        keeper = w.keeper;
        feeRecipient = w.feeRecipient;
        poster = w.poster;
        refOwner = w.refOwner;
        sequencerFeed = w.sequencerFeed;
    }

    // ------------------------------------------------------------------ setup (owner)

    /// @notice Append a piece of OffmintVault's creation code (owner, before sealing). Seals itself once the stored
    ///         code hashes to `vaultCodeHash`; after that the code can never change.
    function uploadVaultCode(bytes calldata chunk) external onlyOwner {
        if (codeSealed) revert Sealed();
        _codeChunks.push(_store(chunk));
        if (keccak256(_vaultCode()) == vaultCodeHash) {
            codeSealed = true;
            emit CodeSealed(_codeChunks.length);
        }
    }

    /// @notice Drop uploaded chunks if an upload went wrong (owner, before sealing).
    function resetVaultCode() external onlyOwner {
        if (codeSealed) revert Sealed();
        delete _codeChunks;
    }

    /// @notice Mirror Robinhood's canonical registry entry for `stock` (owner).
    function setListing(address stock, Listing calldata l) external onlyOwner {
        if (stock == address(0) || stock == address(usdg)) revert BadConfig();
        listings[stock] = l;
        emit Listed(stock, l);
    }

    // ------------------------------------------------------------------ deploy (anyone)

    /// @notice Deploy an OffmintVault instance for a canonical `stock` (owner). One per (stock, restrictedDepositor).
    /// @param restrictedDepositor address(0) for the community instance, the MetaVault for its exclusive instance
    /// @return vault the new vault
    function deployVault(address stock, address restrictedDepositor) external onlyOwner returns (address vault) {
        Listing memory l = listings[stock];
        if (!l.canonical) revert NotCanonical();
        if (vaultFor[stock][restrictedDepositor] != address(0)) revert AlreadyDeployed();
        if (!codeSealed) revert CodeNotSealed();

        PoolKey memory key = _poolKey(stock, l);
        (uint160 sp,,,) = poolManager.getSlot0(key.toId());
        if (sp == 0) revert PoolNotInitialized();

        string memory sym = IERC20Metadata(stock).symbol();
        (address ref, bool push) = _reference(stock, l.feed, sym);
        bytes memory init = bytes.concat(
            _vaultCode(),
            abi.encode(
                OffmintVault.Config({
                    poolManager: poolManager,
                    clock: clock,
                    priceRef: IPriceReference(ref),
                    stock: IERC20(stock),
                    usdg: usdg,
                    poolKey: key,
                    owner: vaultOwner,
                    keeper: keeper,
                    feeRecipient: feeRecipient,
                    ticker: sym,
                    restrictedDepositor: restrictedDepositor
                })
            )
        );
        bytes32 salt = keccak256(abi.encode(stock, restrictedDepositor));
        assembly ("memory-safe") {
            vault := create2(0, add(init, 0x20), mload(init), salt)
        }
        if (vault == address(0)) revert BadConfig();
        vaultFor[stock][restrictedDepositor] = vault;
        _all.push(vault);
        emit VaultDeployed(stock, restrictedDepositor, vault, ref, push);
    }

    // ------------------------------------------------------------------ views

    /// @notice Every vault deployed by this factory.
    function allVaults() external view returns (address[] memory) {
        return _all;
    }

    /// @notice The hook-free STOCK/USDG pool a listing points at.
    function poolKeyFor(address stock) external view returns (PoolKey memory) {
        return _poolKey(stock, listings[stock]);
    }

    // ------------------------------------------------------------------ internals

    /// @dev One price reference per stock, shared by both instances (and so by MetaVault's NAV): never two sources.
    function _reference(address stock, address feed, string memory sym) internal returns (address ref, bool push) {
        push = feed == address(0);
        ref = refFor[stock];
        if (ref != address(0)) return (ref, push);
        ref = push
            ? address(
                new PushPriceReference(
                    poster,
                    refOwner,
                    IStockToken(stock),
                    PUSH_MAX_MOVE_BPS,
                    PUSH_GAP_AFTER,
                    string.concat("Robinhood API ", sym, "/USD")
                )
            )
            : address(
                new ChainlinkPriceReference(
                    AggregatorV3Interface(feed), AggregatorV3Interface(sequencerFeed), IStockToken(stock)
                )
            );
        refFor[stock] = ref;
    }

    function _poolKey(address stock, Listing memory l) internal view returns (PoolKey memory) {
        (address c0, address c1) = stock < address(usdg) ? (stock, address(usdg)) : (address(usdg), stock);
        return PoolKey(Currency.wrap(c0), Currency.wrap(c1), l.fee, l.tickSpacing, IHooks(address(0)));
    }

    /// @dev SSTORE2-style: a contract whose runtime is 0x00 ++ data.
    function _store(bytes calldata data) internal returns (address p) {
        bytes memory init = abi.encodePacked(hex"61", uint16(data.length + 1), hex"80600a3d393df300", data);
        assembly ("memory-safe") {
            p := create(0, add(init, 0x20), mload(init))
        }
        if (p == address(0)) revert BadConfig();
    }

    function _vaultCode() internal view returns (bytes memory code) {
        for (uint256 i = 0; i < _codeChunks.length; i++) {
            address p = _codeChunks[i];
            uint256 n = p.code.length - 1;
            bytes memory part = new bytes(n);
            assembly ("memory-safe") {
                extcodecopy(p, add(part, 0x20), 1, n)
            }
            code = bytes.concat(code, part);
        }
    }
}
