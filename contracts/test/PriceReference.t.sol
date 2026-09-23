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

import {PushPriceReference} from "../src/oracle/PushPriceReference.sol";

contract PushPriceReferenceTest is Test {
    MockStockToken stock;
    PushPriceReference ref;
    address poster = makeAddr("poster");
    address keeper = makeAddr("keeper");

    function setUp() public {
        vm.warp(1_790_000_000);
        stock = new MockStockToken(address(this), "BlackBerry", "BB");
        // max 20% per post intraday; any move allowed after a >= 12h gap (market reopen)
        ref = new PushPriceReference(poster, IStockToken(address(stock)), 2000, 12 hours, "Robinhood API BB/USD");
    }

    function _post(uint256 p, uint256 at, bool h) internal {
        vm.prank(poster);
        ref.post(p, at, h);
    }

    function test_postAndRead() public {
        _post(8.5e8, block.timestamp - 30, false);
        (uint256 p, uint8 d, uint256 t) = ref.read();
        assertEq(p, 8.5e8);
        assertEq(d, 8);
        assertEq(t, block.timestamp - 30);
    }

    function test_onlyPoster_keeperCannotPost() public {
        vm.prank(keeper);
        vm.expectRevert(PushPriceReference.NotPoster.selector);
        ref.post(1e8, block.timestamp, false);
    }

    function test_timestampsStrictlyIncreaseAndNotFuture() public {
        _post(8e8, block.timestamp - 100, false);
        vm.prank(poster);
        vm.expectRevert(PushPriceReference.BadTimestamp.selector);
        ref.post(8e8, block.timestamp - 100, false); // same timestamp: re-posting must not refresh "freshness"
        vm.prank(poster);
        vm.expectRevert(PushPriceReference.BadTimestamp.selector);
        ref.post(8e8, block.timestamp + 1, false);
    }

    function test_intradayMoveBounded() public {
        _post(8e8, block.timestamp - 3600, false);
        vm.prank(poster);
        vm.expectRevert(PushPriceReference.MoveTooLarge.selector);
        ref.post(10e8, block.timestamp - 1800, false); // +25% within 30 min
        _post(9.6e8, block.timestamp - 1800, false); // +20% ok
    }

    function test_reopenGapAllowed() public {
        _post(8e8, block.timestamp - 3 days, false); // Friday close
        _post(12e8, block.timestamp, false); // Monday +50% gap after a >= 12h pause: allowed
        (uint256 p,,) = ref.read();
        assertEq(p, 12e8);
    }

    function test_haltAndIssuerPauseRevert() public {
        _post(8e8, block.timestamp - 10, true);
        vm.expectRevert(PushPriceReference.OraclePaused.selector);
        ref.read();
        _post(8e8, block.timestamp - 5, false);
        stock.setOraclePaused(true);
        vm.expectRevert(PushPriceReference.OraclePaused.selector);
        ref.read();
    }

    function test_noPriceYetAndZeroPrice() public {
        vm.expectRevert(PushPriceReference.NoPrice.selector);
        ref.read();
        vm.prank(poster);
        vm.expectRevert(PushPriceReference.ZeroPrice.selector);
        ref.post(0, block.timestamp, false);
    }

    function test_constructorRejectsZeroPoster() public {
        vm.expectRevert(PushPriceReference.BadConfig.selector);
        new PushPriceReference(address(0), IStockToken(address(stock)), 2000, 12 hours, "x");
    }
}
