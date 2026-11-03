// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {PenaltyMatch} from "../PenaltyMatch.sol";
import {PenaltyMatchTestBase} from "./PenaltyMatch.Base.t.sol";

contract NoReceive {}

contract ReenterKey {
    PenaltyMatch public pm;
    bytes public err;

    constructor(PenaltyMatch _pm) {
        pm = _pm;
    }

    receive() external payable {
        try pm.cancelMatch(1) {} catch (bytes memory e) {
            err = e;
        }
    }

    function errBytes() external view returns (bytes memory) {
        return err;
    }
}

/// Rooms, session keys, quick-match queue, cancel, one-live-match rule.
contract PenaltyMatchRoomsTest is PenaltyMatchTestBase {
    // ------------------------------------------------------------ create

    function test_CreateFriendRoom() public {
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchCreated(1, alice, false);
        uint256 id = _create(alice, keyA);
        assertEq(id, 1);
        PenaltyMatch.Match memory m = pm.getMatch(id);
        assertEq(m.p1, alice);
        assertEq(m.key1, keyA);
        assertEq(m.codeHash, _codeHash(alice, CODE));
        assertFalse(m.ranked);
        assertEq(uint8(m.status), uint8(PenaltyMatch.Status.Open));
        assertEq(m.createdAt, block.timestamp);
        assertEq(m.createdBlock, block.number);
        assertEq(pm.currentMatch(alice), id);
        assertEq(pm.queuedMatch(), 0, "friend rooms never enter the queue");
    }

    function test_CreateWithZeroKeyNoValueOk() public {
        uint256 id = _create(alice, address(0));
        assertEq(pm.getMatch(id).key1, address(0));
    }

    function test_CreateRevertsWhenKeyIsOwnWallet() public {
        bytes32 h = _codeHash(alice, CODE);
        vm.prank(alice);
        vm.expectRevert(PenaltyMatch.SessionKeyInvalid.selector);
        pm.createMatch(h, alice);
    }

    function test_CreateRevertsWhenZeroKeyWithValue() public {
        bytes32 h = _codeHash(alice, CODE);
        vm.prank(alice);
        vm.expectRevert(PenaltyMatch.SessionKeyInvalid.selector);
        pm.createMatch{value: 1 ether}(h, address(0));
    }

    function test_CreateForwardsValueToSessionKey() public {
        bytes32 h = _codeHash(alice, CODE);
        uint256 before = alice.balance;
        vm.prank(alice);
        pm.createMatch{value: 1 ether}(h, keyA);
        assertEq(keyA.balance, 1 ether);
        assertEq(alice.balance, before - 1 ether);
        assertEq(address(pm).balance, 0);
    }

    function test_CreateRevertsWhenKeyCannotReceive() public {
        address bad = address(new NoReceive());
        bytes32 h = _codeHash(alice, CODE);
        vm.prank(alice);
        vm.expectRevert(PenaltyMatch.ForwardFailed.selector);
        pm.createMatch{value: 1 ether}(h, bad);
        assertEq(pm.currentMatch(alice), 0, "revert rolled everything back");
    }

    function test_FundingCallbackCannotReenter() public {
        ReenterKey rk = new ReenterKey(pm);
        bytes32 h = _codeHash(alice, CODE);
        vm.prank(alice);
        uint256 id = pm.createMatch{value: 1 ether}(h, address(rk));
        assertEq(rk.errBytes(), abi.encodeWithSelector(PenaltyMatch.ReentrantCall.selector));
        assertEq(uint8(pm.getMatch(id).status), uint8(PenaltyMatch.Status.Open));
    }

    // -------------------------------------------------------------- join

    function test_JoinStartsMatch() public {
        uint256 id = _create(alice, keyA);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchJoined(id, bob);
        _join(bob, id, keyB);
        PenaltyMatch.Match memory m = pm.getMatch(id);
        assertEq(m.p2, bob);
        assertEq(m.key2, keyB);
        assertEq(uint8(m.status), uint8(PenaltyMatch.Status.Active));
        assertEq(uint8(m.phase), uint8(PenaltyMatch.Phase.Committing));
        assertEq(m.deadline, block.timestamp + pm.STEP_TIMEOUT());
        assertEq(pm.currentMatch(bob), id);
        assertEq(pm.currentMatch(alice), id);
        assertFalse(m.ranked);
    }

    function test_JoinWithZeroKeyOk() public {
        uint256 id = _create(alice, address(0));
        _join(bob, id, address(0));
        assertEq(uint8(pm.getMatch(id).status), uint8(PenaltyMatch.Status.Active));
    }

    function test_JoinRevertsBadCode() public {
        uint256 id = _create(alice, keyA);
        vm.prank(bob);
        vm.expectRevert(PenaltyMatch.BadCode.selector);
        pm.joinMatch(id, keccak256("wrong"), keyB);
    }

    function test_JoinRevertsSelfJoin() public {
        uint256 id = _create(alice, keyA);
        vm.prank(alice);
        vm.expectRevert(PenaltyMatch.SelfJoin.selector);
        pm.joinMatch(id, CODE, keyB);
        assertEq(uint8(pm.getMatch(id).status), uint8(PenaltyMatch.Status.Open), "room not auto-cancelled by failed self join");
    }

    function test_JoinRevertsKeyIsOwnWallet() public {
        uint256 id = _create(alice, keyA);
        vm.prank(bob);
        vm.expectRevert(PenaltyMatch.SessionKeyInvalid.selector);
        pm.joinMatch(id, CODE, bob);
    }

    function test_JoinRevertsKeyIsCreatorWallet() public {
        uint256 id = _create(alice, keyA);
        vm.prank(bob);
        vm.expectRevert(PenaltyMatch.SessionKeyInvalid.selector);
        pm.joinMatch(id, CODE, alice);
    }

    function test_JoinRevertsKeyIsCreatorKey() public {
        uint256 id = _create(alice, keyA);
        vm.prank(bob);
        vm.expectRevert(PenaltyMatch.SessionKeyInvalid.selector);
        pm.joinMatch(id, CODE, keyA);
    }

    function test_JoinRevertsWhenJoinerIsCreatorsKey() public {
        uint256 id = _create(alice, bob);
        vm.prank(bob);
        vm.expectRevert(PenaltyMatch.SessionKeyInvalid.selector);
        pm.joinMatch(id, CODE, keyB);
    }

    function test_JoinRevertsZeroKeyWithValue() public {
        uint256 id = _create(alice, keyA);
        vm.prank(bob);
        vm.expectRevert(PenaltyMatch.SessionKeyInvalid.selector);
        pm.joinMatch{value: 1 ether}(id, CODE, address(0));
    }

    function test_JoinForwardsValueToSessionKey() public {
        uint256 id = _create(alice, keyA);
        vm.prank(bob);
        pm.joinMatch{value: 2 ether}(id, CODE, keyB);
        assertEq(keyB.balance, 2 ether);
        assertEq(address(pm).balance, 0);
    }

    function test_JoinRevertsOnActiveCancelledUnknownAndRanked() public {
        uint256 id = _startFriend();
        vm.prank(carol);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        pm.joinMatch(id, CODE, address(0));

        vm.prank(carol);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        pm.joinMatch(999, CODE, address(0));

        uint256 id2 = _create(carol, address(0));
        vm.prank(carol);
        pm.cancelMatch(id2);
        vm.prank(dave);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        pm.joinMatch(id2, CODE, address(0));

        (uint256 rid,) = _quick(dave);
        vm.prank(stranger);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        pm.joinMatch(rid, bytes32(0), address(0));
    }

    // -------------------------------------------------------- quickMatch

    function test_QuickMatchCreatesThenPairs() public {
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchCreated(1, alice, true);
        (uint256 id, bool matched) = _quick(alice);
        assertEq(id, 1);
        assertFalse(matched);
        assertEq(pm.queuedMatch(), id);
        assertTrue(pm.getMatch(id).ranked);
        assertEq(uint8(pm.getMatch(id).status), uint8(PenaltyMatch.Status.Open));

        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchJoined(id, bob);
        (uint256 id2, bool matched2) = _quick(bob);
        assertEq(id2, id);
        assertTrue(matched2);
        assertEq(pm.queuedMatch(), 0);
        PenaltyMatch.Match memory m = pm.getMatch(id);
        assertEq(m.p1, alice);
        assertEq(m.p2, bob);
        assertEq(uint8(m.status), uint8(PenaltyMatch.Status.Active));
        assertEq(m.deadline, block.timestamp + 20);
    }

    function test_QuickMatchForwardsValueBothSides() public {
        vm.prank(alice);
        pm.quickMatch{value: 1 ether}(keyA);
        vm.prank(bob);
        (, bool matched) = pm.quickMatch{value: 3 ether}(keyB);
        assertTrue(matched);
        assertEq(keyA.balance, 1 ether);
        assertEq(keyB.balance, 3 ether);
        assertEq(address(pm).balance, 0);
    }

    function test_QuickMatchKeyValidation() public {
        vm.prank(alice);
        vm.expectRevert(PenaltyMatch.SessionKeyInvalid.selector);
        pm.quickMatch(alice);
        vm.prank(alice);
        vm.expectRevert(PenaltyMatch.SessionKeyInvalid.selector);
        pm.quickMatch{value: 1}(address(0));

        vm.prank(alice);
        pm.quickMatch(keyA);
        // a caller's own wallet as key, or a zero key carrying value, is still invalid
        vm.prank(bob);
        vm.expectRevert(PenaltyMatch.SessionKeyInvalid.selector);
        pm.quickMatch(bob);
        vm.prank(bob);
        vm.expectRevert(PenaltyMatch.SessionKeyInvalid.selector);
        pm.quickMatch{value: 1}(address(0));
    }

    /// Shared assertions: `skipper` could not join `waitingId`, so it got its own queued room
    /// and the waiting room is left untouched (Open, creator still pointing at it).
    function _assertSkipped(uint256 waitingId, address creator, address skipper, uint256 id, bool matched)
        internal
        view
    {
        assertFalse(matched);
        assertTrue(id != waitingId);
        assertEq(pm.getMatch(id).p1, skipper);
        assertTrue(pm.getMatch(id).ranked);
        assertEq(uint8(pm.getMatch(id).status), uint8(PenaltyMatch.Status.Open));
        assertEq(pm.queuedMatch(), id);
        assertEq(pm.currentMatch(skipper), id);
        PenaltyMatch.Match memory w = pm.getMatch(waitingId);
        assertEq(uint8(w.status), uint8(PenaltyMatch.Status.Open), "waiting room untouched");
        assertEq(w.p1, creator);
        assertEq(w.p2, address(0));
        assertEq(pm.currentMatch(creator), waitingId);
    }

    function test_QuickMatchSkipsRoomWhenKeyIsCreatorKey() public {
        vm.prank(alice);
        (uint256 waiting,) = pm.quickMatch(keyA);

        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchCreated(waiting + 1, bob, true);
        vm.prank(bob);
        (uint256 id, bool matched) = pm.quickMatch(keyA);
        _assertSkipped(waiting, alice, bob, id, matched);
        assertEq(pm.getMatch(id).key1, keyA);
    }

    function test_QuickMatchSkipsRoomWhenKeyIsCreatorWallet() public {
        (uint256 waiting,) = _quick(alice);
        vm.prank(bob);
        (uint256 id, bool matched) = pm.quickMatch(alice);
        _assertSkipped(waiting, alice, bob, id, matched);
    }

    function test_QuickMatchSkipsRoomWhenCallerIsCreatorKey() public {
        vm.prank(alice);
        (uint256 waiting,) = pm.quickMatch(keyA);
        vm.prank(keyA);
        (uint256 id, bool matched) = pm.quickMatch(address(0));
        _assertSkipped(waiting, alice, keyA, id, matched);
    }

    function test_QuickMatchPoisoningVictimStillGetsOwnQueuedRoom() public {
        // attacker (carol) queues a room naming the victim (bob) as her session key
        vm.prank(carol);
        (uint256 poisoned,) = pm.quickMatch(bob);
        assertEq(pm.getMatch(poisoned).key1, bob);

        vm.prank(bob);
        (uint256 id, bool matched) = pm.quickMatch(address(0));
        _assertSkipped(poisoned, carol, bob, id, matched);

        // the victim's room is the live queue slot: the next honest player pairs with the victim
        (uint256 id2, bool matched2) = _quick(dave);
        assertTrue(matched2);
        assertEq(id2, id);
        assertEq(uint8(pm.getMatch(id).status), uint8(PenaltyMatch.Status.Active));
        assertEq(pm.getMatch(id).p1, bob);
        assertEq(pm.getMatch(id).p2, dave);
        // the attacker's room never started and can still be cancelled by her, leaving the queue alone
        assertEq(uint8(pm.getMatch(poisoned).status), uint8(PenaltyMatch.Status.Open));
        vm.prank(carol);
        pm.cancelMatch(poisoned);
        assertEq(uint8(pm.getMatch(poisoned).status), uint8(PenaltyMatch.Status.Cancelled));
    }

    function test_QuickMatchPoisonedQueueCancelDoesNotClearVictimQueueSlot() public {
        vm.prank(carol);
        (uint256 poisoned,) = pm.quickMatch(bob);
        vm.prank(bob);
        (uint256 id,) = pm.quickMatch(address(0));
        vm.prank(carol);
        pm.cancelMatch(poisoned);
        assertEq(pm.queuedMatch(), id, "victim room still queued");
    }

    function test_QuickMatchJoinsAtExactlyTtl() public {
        (uint256 id,) = _quick(alice);
        vm.warp(block.timestamp + pm.QUEUE_TTL());
        (uint256 id2, bool matched) = _quick(bob);
        assertTrue(matched);
        assertEq(id2, id);
    }

    function test_QuickMatchStaleRoomCancelledAndReplaced() public {
        (uint256 id,) = _quick(alice);
        vm.warp(block.timestamp + pm.QUEUE_TTL() + 1);

        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchCancelled(id);
        (uint256 id2, bool matched) = _quick(bob);

        assertFalse(matched);
        assertTrue(id2 != id);
        assertEq(uint8(pm.getMatch(id).status), uint8(PenaltyMatch.Status.Cancelled));
        assertEq(pm.currentMatch(alice), 0);
        assertEq(pm.queuedMatch(), id2);
        assertEq(pm.getMatch(id2).p1, bob);
    }

    function test_QuickMatchSameWalletReplacesOwnRoom() public {
        (uint256 id,) = _quick(alice);
        (uint256 id2, bool matched) = _quick(alice);
        assertFalse(matched);
        assertTrue(id2 != id);
        assertEq(uint8(pm.getMatch(id).status), uint8(PenaltyMatch.Status.Cancelled));
        assertEq(pm.queuedMatch(), id2);
        assertEq(pm.currentMatch(alice), id2);
    }

    function test_QuickMatchDoesNotPairWithFriendRoom() public {
        uint256 friend = _create(alice, keyA);
        (uint256 id, bool matched) = _quick(bob);
        assertFalse(matched);
        assertTrue(id != friend);
        assertEq(uint8(pm.getMatch(friend).status), uint8(PenaltyMatch.Status.Open));
    }

    // ------------------------------------------------------------ cancel

    function test_CancelByCreatorWallet() public {
        (uint256 id,) = _quick(alice);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchCancelled(id);
        vm.prank(alice);
        pm.cancelMatch(id);
        assertEq(uint8(pm.getMatch(id).status), uint8(PenaltyMatch.Status.Cancelled));
        assertEq(pm.currentMatch(alice), 0);
        assertEq(pm.queuedMatch(), 0);
    }

    function test_CancelByCreatorSessionKey() public {
        uint256 id = _create(alice, keyA);
        vm.prank(keyA);
        pm.cancelMatch(id);
        assertEq(uint8(pm.getMatch(id).status), uint8(PenaltyMatch.Status.Cancelled));
        assertEq(pm.currentMatch(alice), 0);
    }

    function test_CancelRevertsForNonCreator() public {
        uint256 id = _create(alice, keyA);
        vm.prank(bob);
        vm.expectRevert(PenaltyMatch.NotCreator.selector);
        pm.cancelMatch(id);
        vm.prank(keyB);
        vm.expectRevert(PenaltyMatch.NotCreator.selector);
        pm.cancelMatch(id);
    }

    function test_CancelRevertsWhenNotOpen() public {
        uint256 id = _startFriend();
        vm.prank(alice);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        pm.cancelMatch(id);
        vm.prank(alice);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        pm.cancelMatch(12345);
    }

    function test_CancelledRoomCannotBeCancelledTwice() public {
        uint256 id = _create(alice, keyA);
        vm.prank(alice);
        pm.cancelMatch(id);
        vm.prank(alice);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        pm.cancelMatch(id);
    }

    // ----------------------------------------------- one live match per wallet

    function test_ActivePlayerCannotCreateJoinOrQuick() public {
        uint256 id = _startFriend();
        bytes32 h = _codeHash(alice, CODE);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PenaltyMatch.AlreadyInMatch.selector, id));
        pm.createMatch(h, address(0));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PenaltyMatch.AlreadyInMatch.selector, id));
        pm.quickMatch(address(0));

        uint256 other = _create(carol, address(0));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PenaltyMatch.AlreadyInMatch.selector, id));
        pm.joinMatch(other, CODE, address(0));
    }

    function test_CreateAutoCancelsOwnOpenRoom() public {
        uint256 id = _create(alice, keyA);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchCancelled(id);
        uint256 id2 = _create(alice, keyA);
        assertTrue(id2 != id);
        assertEq(uint8(pm.getMatch(id).status), uint8(PenaltyMatch.Status.Cancelled));
        assertEq(uint8(pm.getMatch(id2).status), uint8(PenaltyMatch.Status.Open));
        assertEq(pm.currentMatch(alice), id2);
    }

    function test_QuickMatchAutoCancelsOwnFriendRoom() public {
        uint256 friend = _create(alice, keyA);
        (uint256 id,) = _quick(alice);
        assertEq(uint8(pm.getMatch(friend).status), uint8(PenaltyMatch.Status.Cancelled));
        assertEq(pm.currentMatch(alice), id);
    }

    function test_JoinAutoCancelsOwnOpenRoom() public {
        uint256 mine = _create(alice, keyA);
        uint256 theirs = _create(bob, keyB);
        // joiner's own open room replaced
        vm.prank(alice);
        pm.joinMatch(theirs, CODE, address(0));
        assertEq(uint8(pm.getMatch(mine).status), uint8(PenaltyMatch.Status.Cancelled));
        assertEq(uint8(pm.getMatch(theirs).status), uint8(PenaltyMatch.Status.Active));
        assertEq(pm.currentMatch(alice), theirs);
    }

    function test_QuickJoinAutoCancelsOwnFriendRoom() public {
        (uint256 q,) = _quick(alice);
        uint256 friend = _create(bob, keyB);
        (uint256 id, bool matched) = _quick(bob);
        assertTrue(matched);
        assertEq(id, q);
        assertEq(uint8(pm.getMatch(friend).status), uint8(PenaltyMatch.Status.Cancelled));
    }

    function test_WalletFreeAgainAfterFinishAndCancel() public {
        uint256 id = _rankedWin(alice, bob);
        assertEq(pm.currentMatch(alice), 0);
        assertEq(pm.currentMatch(bob), 0);
        uint256 id2 = _create(alice, keyA);
        assertTrue(id2 > id);
        vm.prank(alice);
        pm.cancelMatch(id2);
        _create(alice, keyA);
    }
}
