// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ChainlinkPriceReference} from "../src/oracle/ChainlinkPriceReference.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {AggregatorV3Interface} from "../src/interfaces/AggregatorV3Interface.sol";
import {IStockToken} from "../src/interfaces/IStockToken.sol";

/// @dev The adapter must behave exactly like OffmintVault._readFeed so the vault can later switch to it unchanged.
contract ChainlinkPriceReferenceTest is Test {
    MockFeed feed;
    MockFeed seq;
    MockStockToken stock;
    ChainlinkPriceReference ref;

    function setUp() public {
        vm.warp(1_790_000_000);
        feed = new MockFeed(address(this), 8, "RHTSLA / USD", 378e8);
        seq = new MockFeed(address(this), 0, "sequencer", 0);
        seq.setAnswerAt(0, block.timestamp - 2 days);
        stock = new MockStockToken(address(this), "Tesla", "TSLA");
        ref = new ChainlinkPriceReference(
            AggregatorV3Interface(address(feed)), AggregatorV3Interface(address(seq)), IStockToken(address(stock))
        );
    }

    function test_readsPriceDecimalsAndTimestamp() public {
        feed.setAnswerAt(377e8, block.timestamp - 60);
        (uint256 p, uint8 d, uint256 t) = ref.read();
        assertEq(p, 377e8);
        assertEq(d, 8);
        assertEq(t, block.timestamp - 60);
        assertEq(ref.description(), "Chainlink RHTSLA / USD");
    }

    function test_reverts_nonPositive() public {
        feed.setAnswer(0);
        vm.expectRevert(ChainlinkPriceReference.OracleStale.selector);
        ref.read();
    }

    function test_reverts_issuerPaused() public {
        stock.setOraclePaused(true);
        vm.expectRevert(ChainlinkPriceReference.OraclePaused.selector);
        ref.read();
    }

    function test_reverts_sequencerDownOrInGrace() public {
        seq.setAnswerAt(1, block.timestamp - 2 days);
        vm.expectRevert(ChainlinkPriceReference.SequencerDown.selector);
        ref.read();
        seq.setAnswerAt(0, block.timestamp - 10 minutes);
        vm.expectRevert(ChainlinkPriceReference.SequencerDown.selector);
        ref.read();
    }

    function test_noSequencerFeedSkipsCheck() public {
        ChainlinkPriceReference r = new ChainlinkPriceReference(
            AggregatorV3Interface(address(feed)), AggregatorV3Interface(address(0)), IStockToken(address(stock))
        );
        (uint256 p,,) = r.read();
        assertEq(p, 378e8);
    }

    function test_freshnessIsNotJudgedInside() public {
        feed.setAnswerAt(378e8, block.timestamp - 30 days); // ancient but healthy: the caller decides freshness
        (,, uint256 t) = ref.read();
        assertEq(t, block.timestamp - 30 days);
    }
}
