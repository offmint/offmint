// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {OffmintVault} from "../src/OffmintVault.sol";
import {MetaVault} from "../src/MetaVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {OffmintParams} from "../src/libraries/OffmintParams.sol";
import {ManualSessionClock} from "../src/clock/ManualSessionClock.sol";
import {RangeMath} from "../src/libraries/RangeMath.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {ISessionClock} from "../src/interfaces/ISessionClock.sol";

/// @title Deploy — testnet demo stack (SPEC §7)
/// @notice Deploys MockStockToken + MockUSDG (6 dec) + MockFeed + ManualSessionClock, creates a hook-free
///         STOCK/USDG pool (fee 3000, spacing 60) on the PoolManager at the MockFeed price, seeds wide two-sided
///         liquidity, then the platform: VaultFactory (OffmintVault code uploaded and hash-pinned), MetaVault, and
///         both OffmintVault instances for the ticker (community `ob`, open; MetaVault-exclusive `mb`), with
///         demo-speed timing (all inside the hard bounds). First deposits into the community instance (STOCK) and
///         MetaVault (USDG). Writes deployments/<chainId>.json for the keeper and scripts (`vault` = community).
///
///   Dry run (no broadcast):  forge script script/Deploy.s.sol --rpc-url $RH_TESTNET_RPC
///   Broadcast (ask first!):  forge script script/Deploy.s.sol --rpc-url $RH_TESTNET_RPC --broadcast
///
/// Env: DEPLOYER_PRIVATE_KEY, KEEPER_ADDRESS, FEE_RECIPIENT (required)
///      POOL_MANAGER (default: Robinhood Chain v4 PoolManager; deployed fresh if no code there, e.g. bare anvil)
///      DEMO_TICKER (default HIMS), INITIAL_PRICE_E8 (default 28.84e8), DEMO_DEPOSIT (default 100e18),
///      SEED_LIQUIDITY (default 1e18), META_DEPOSIT (USDG, default 10_000e6),
///      POSTER_ADDRESS (PushPriceReference poster; default derived from ORACLE_POSTER_PRIVATE_KEY, never the keeper)
contract Deploy is Script {
    address constant RH_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    struct Out {
        address poolManager;
        address stock;
        address usdg;
        address feed;
        address clock;
        address vault; // community instance (restrictedDepositor = 0)
        address metaInstance; // MetaVault's exclusive instance
        address metaVault;
        address factory;
        address priceRef;
        address swapRouter;
        address liquidityRouter;
        bool stockIsCurrency0;
    }

    struct Cfg {
        address deployer;
        address keeper;
        address feeTo;
        string ticker;
        uint256 price;
        uint256 demoDeposit;
        address pm;
        uint256 seedLiquidity;
        uint256 metaDeposit;
        address poster;
    }

    function run() external returns (Out memory o) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Cfg memory c = Cfg({
            deployer: vm.addr(pk),
            keeper: vm.envAddress("KEEPER_ADDRESS"),
            feeTo: vm.envAddress("FEE_RECIPIENT"),
            ticker: vm.envOr("DEMO_TICKER", string("HIMS")),
            price: vm.envOr("INITIAL_PRICE_E8", uint256(28.84e8)),
            demoDeposit: vm.envOr("DEMO_DEPOSIT", uint256(100e18)),
            pm: vm.envOr("POOL_MANAGER", RH_POOL_MANAGER),
            // ~$27k of depth per 1% move at $28.84: deep enough that a 30-share buyback stays inside the 1% cap
            seedLiquidity: vm.envOr("SEED_LIQUIDITY", uint256(1e18)),
            metaDeposit: vm.envOr("META_DEPOSIT", uint256(10_000e6)),
            poster: _poster()
        });

        vm.startBroadcast(pk);
        _mocks(o, c);
        PoolKey memory key = _pool(o, c);
        _vault(o, c, key);
        vm.stopBroadcast();
        _write(o, key, c);
    }

    function _mocks(Out memory o, Cfg memory c) internal {
        if (c.pm.code.length == 0) {
            console2.log("no PoolManager at", c.pm, "- deploying v4-core PoolManager");
            c.pm = address(new PoolManager(c.deployer));
        }
        o.poolManager = c.pm;
        o.usdg = address(new MockUSDG(c.deployer));
        o.stock = address(
            new MockStockToken(c.deployer, string.concat("Offmint Mock ", c.ticker), string.concat("m", c.ticker))
        );
        o.feed = address(new MockFeed(c.deployer, 8, string.concat("m", c.ticker, " / USD (mock)"), int256(c.price)));
        o.clock = address(new ManualSessionClock(c.deployer));
        o.stockIsCurrency0 = o.stock < o.usdg;
    }

    /// @dev Hook-free pool at the feed price + market-maker liquidity from price/3 to price*3.
    function _pool(Out memory o, Cfg memory c) internal returns (PoolKey memory key) {
        IPoolManager pm = IPoolManager(o.poolManager);
        key = _key(o);
        RangeMath.Decimals memory d = RangeMath.Decimals({feed: 8, stock: 18, usd: 6});
        pm.initialize(key, RangeMath.usdToSqrtPriceX96(c.price, d, o.stockIsCurrency0, false));
        o.liquidityRouter = address(new PoolModifyLiquidityTest(pm));
        o.swapRouter = address(new PoolSwapTest(pm));
        MockStockToken(o.stock).mint(c.deployer, 10_000_000e18);
        MockUSDG(o.usdg).mint(c.deployer, 1_000_000_000e6);
        IERC20(o.stock).approve(o.liquidityRouter, type(uint256).max);
        IERC20(o.usdg).approve(o.liquidityRouter, type(uint256).max);
        IERC20(o.stock).approve(o.swapRouter, type(uint256).max);
        IERC20(o.usdg).approve(o.swapRouter, type(uint256).max);
        PoolModifyLiquidityTest(o.liquidityRouter)
            .modifyLiquidity(key, _wideRange(c.price, d, o.stockIsCurrency0, c.seedLiquidity), "");
    }

    function _vault(Out memory o, Cfg memory c, PoolKey memory key) internal {
        (key); // the factory derives the same hook-free (fee 3000, spacing 60) key from the listing
        bytes memory code = type(OffmintVault).creationCode;
        VaultFactory f = new VaultFactory(
            keccak256(code),
            VaultFactory.Wiring({
                poolManager: IPoolManager(o.poolManager),
                clock: ISessionClock(o.clock),
                usdg: IERC20(o.usdg),
                vaultOwner: c.deployer,
                keeper: c.keeper,
                feeRecipient: c.feeTo,
                poster: c.poster,
                refOwner: c.deployer,
                sequencerFeed: address(0) // none on testnet
            }),
            c.deployer
        );
        for (uint256 i = 0; i < code.length; i += 15_000) {
            f.uploadVaultCode(_slice(code, i, i + 15_000 > code.length ? code.length : i + 15_000));
        }
        require(f.codeSealed(), "vault code not sealed");
        // testnet: the MockFeed stands in for a Chainlink feed (Chainlink-shaped adapter)
        f.setListing(o.stock, VaultFactory.Listing(true, o.feed, 3000, 60));

        MetaVault meta = new MetaVault(
            IERC20(o.usdg), IPoolManager(o.poolManager), ISessionClock(o.clock), f, c.deployer, c.keeper, c.feeTo
        );
        o.factory = address(f);
        o.metaVault = address(meta);
        o.vault = f.deployVault(o.stock, address(0));
        o.metaInstance = f.deployVault(o.stock, address(meta));
        o.priceRef = f.refFor(o.stock);
        _demoTiming(OffmintVault(o.vault));
        _demoTiming(OffmintVault(o.metaInstance));

        IERC20(o.stock).approve(o.vault, c.demoDeposit);
        OffmintVault(o.vault).deposit(c.demoDeposit, c.deployer);
        IERC20(o.usdg).approve(o.metaVault, c.metaDeposit);
        meta.deposit(c.metaDeposit, c.deployer);
    }

    /// @dev Demo-speed timing: every value at the edge of the hard bounds, never outside them.
    function _demoTiming(OffmintVault v) internal {
        OffmintParams.Params memory p = v.getParams();
        p.armDelay = 1 minutes;
        p.minFrozen = 5 minutes;
        p.settleDelay = 30 minutes;
        p.armGrace = 30 minutes;
        p.settleGrace = 30 minutes;
        v.setParams(p);
    }

    function _poster() internal view returns (address p) {
        p = vm.envOr("POSTER_ADDRESS", address(0));
        if (p == address(0)) {
            uint256 k = vm.envOr("ORACLE_POSTER_PRIVATE_KEY", uint256(0));
            // unused on this deploy (the demo listing has a feed), but the factory requires a non-keeper poster
            p = k != 0 ? vm.addr(k) : address(uint160(uint256(keccak256("offmint.poster.unset"))));
        }
    }

    function _slice(bytes memory b, uint256 from, uint256 to) internal pure returns (bytes memory out) {
        out = new bytes(to - from);
        for (uint256 i = from; i < to; i++) {
            out[i - from] = b[i];
        }
    }

    function _key(Out memory o) internal pure returns (PoolKey memory) {
        (address c0, address c1) = o.stockIsCurrency0 ? (o.stock, o.usdg) : (o.usdg, o.stock);
        return PoolKey(Currency.wrap(c0), Currency.wrap(c1), 3000, 60, IHooks(address(0)));
    }

    function _wideRange(uint256 price, RangeMath.Decimals memory d, bool s0, uint256 liquidity)
        internal
        pure
        returns (IPoolManager.ModifyLiquidityParams memory)
    {
        int24 a = RangeMath.usdToTick(price / 3, d, s0);
        int24 b = RangeMath.usdToTick(price * 3, d, s0);
        (int24 lo, int24 hi) = a < b ? (a, b) : (b, a);
        return IPoolManager.ModifyLiquidityParams({
            tickLower: RangeMath.floorToSpacing(lo, 60),
            tickUpper: RangeMath.ceilToSpacing(hi, 60),
            liquidityDelta: int256(liquidity),
            salt: 0
        });
    }

    function _write(Out memory o, PoolKey memory key, Cfg memory c) internal {
        string memory j = "deploy";
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeString(j, "ticker", c.ticker);
        vm.serializeAddress(j, "poolManager", o.poolManager);
        vm.serializeAddress(j, "stock", o.stock);
        vm.serializeAddress(j, "usdg", o.usdg);
        vm.serializeAddress(j, "feed", o.feed);
        vm.serializeAddress(j, "clock", o.clock);
        vm.serializeAddress(j, "vault", o.vault);
        vm.serializeAddress(j, "metaInstance", o.metaInstance);
        vm.serializeAddress(j, "metaVault", o.metaVault);
        vm.serializeAddress(j, "factory", o.factory);
        vm.serializeAddress(j, "priceRef", o.priceRef);
        vm.serializeAddress(j, "swapRouter", o.swapRouter);
        vm.serializeAddress(j, "liquidityRouter", o.liquidityRouter);
        vm.serializeAddress(j, "owner", c.deployer);
        vm.serializeAddress(j, "keeper", c.keeper);
        vm.serializeAddress(j, "feeRecipient", c.feeTo);
        vm.serializeBool(j, "stockIsCurrency0", o.stockIsCurrency0);
        vm.serializeUint(j, "poolFee", key.fee);
        string memory out = vm.serializeInt(j, "tickSpacing", key.tickSpacing);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console2.log("wrote", path);
        console2.log("community vault", o.vault);
        console2.log("MetaVault", o.metaVault);
    }
}
