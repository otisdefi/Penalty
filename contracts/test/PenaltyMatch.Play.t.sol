// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PenaltyMatch} from "../PenaltyMatch.sol";
import {PenaltyMatchTestBase} from "./PenaltyMatch.Base.t.sol";

/// Play-phase helpers. No test functions here. NOTE: helpers used right after
/// vm.expectRevert (the *Raw ones) make no external call besides the one under test.
abstract contract PlayBase is PenaltyMatchTestBase {
    bytes32 internal constant S = keccak256("play-salt");
    address internal constant DUMMY = address(0xD00D);

    function _h(uint256 id, uint16 k, address player, uint8 dir, bytes32 salt)
        internal
        view
        returns (bytes32)
    {
        return pm.commitHash(id, k, player, dir, salt);
    }

    function _commitRaw(address sender, uint256 id, bytes32 h) internal {
        vm.prank(sender);
        pm.commit(id, h);
    }

    function _revealRaw(address sender, uint256 id, uint8 dir, bytes32 salt) internal {
        vm.prank(sender);
        pm.reveal(id, dir, salt);
    }

    function _claim(address who, uint256 id) internal {
        vm.prank(who);
        pm.claimTimeout(id);
    }

    function _m(uint256 id) internal view returns (PenaltyMatch.Match memory) {
        return pm.getMatch(id);
    }

    function _assertStatus(uint256 id, PenaltyMatch.Status s) internal view {
        assertEq(uint8(pm.getMatch(id).status), uint8(s));
    }

    function _assertRecord(address p, uint32 w, uint32 l, uint32 st, uint32 best) internal view {
        (uint32 rw, uint32 rl, uint32 rs, uint32 rb) = pm.getRecord(p);
        assertEq(rw, w, "wins");
        assertEq(rl, l, "losses");
        assertEq(rs, st, "streak");
        assertEq(rb, best, "bestStreak");
    }

    /// Both seats (main wallets) commit with the standard helper salt; leaves Revealing.
    function _bothCommit(uint256 id, uint8 d1, uint8 d2) internal {
        PenaltyMatch.Match memory m = _m(id);
        _commitAs(m.p1, id, m.p1, d1);
        _commitAs(m.p2, id, m.p2, d2);
    }

    function _win(address w) internal returns (uint256) {
        return _rankedWin(w, DUMMY);
    }
}

/// commit / reveal binding and phase rules. Friend match: alice(keyA) vs bob(keyB).
contract PenaltyMatchCommitRevealTest is PlayBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _startFriend();
    }

    function test_CommitHashIsPackedKeccak() public view {
        assertEq(
            pm.commitHash(7, 3, alice, 2, S),
            keccak256(abi.encodePacked(uint256(7), uint16(3), alice, uint8(2), S))
        );
    }

    function test_CommitStoresEmitsAndWaitsForOpponent() public {
        bytes32 h = _h(id, 0, alice, 1, S);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.Committed(id, 0, alice);
        _commitRaw(alice, id, h);
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.commit1, h);
        assertEq(m.commit2, bytes32(0));
        assertEq(uint8(m.phase), uint8(PenaltyMatch.Phase.Committing));
    }

    function test_SecondCommitStartsRevealingWithFreshDeadline() public {
        _commitRaw(alice, id, _h(id, 0, alice, 1, S));
        vm.warp(block.timestamp + 7);
        bytes32 hb = _h(id, 0, bob, 2, S);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.Committed(id, 0, bob);
        _commitRaw(bob, id, hb);
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.commit2, hb);
        assertEq(uint8(m.phase), uint8(PenaltyMatch.Phase.Revealing));
        assertEq(m.deadline, block.timestamp + 20);
    }

    function test_RevealMatchingCommitStoresAndEmits() public {
        _bothCommit(id, 1, 2);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.Revealed(id, 0, alice, 1);
        _revealRaw(alice, id, 1, _salt(0, 1));
        PenaltyMatch.Match memory m = _m(id);
        assertTrue(m.revealed1);
        assertFalse(m.revealed2);
        assertEq(m.dir1, 1);
        assertEq(m.kicks, 0, "kick not resolved until both reveal");
    }

    function test_RevealWrongSaltReverts() public {
        _bothCommit(id, 1, 2);
        vm.expectRevert(PenaltyMatch.BadReveal.selector);
        _revealRaw(alice, id, 1, keccak256("other salt"));
        // state untouched: correct reveal still works afterwards
        _revealRaw(alice, id, 1, _salt(0, 1));
        assertTrue(_m(id).revealed1);
    }

    function test_RevealWrongDirReverts() public {
        _bothCommit(id, 1, 2);
        vm.expectRevert(PenaltyMatch.BadReveal.selector);
        _revealRaw(alice, id, 2, _salt(0, 1));
        vm.expectRevert(PenaltyMatch.BadReveal.selector);
        _revealRaw(alice, id, 0, _salt(0, 1));
    }

    function test_RevealWrongKickReverts() public {
        _commitRaw(alice, id, _h(id, 1, alice, 1, S)); // hash made for kick 1, played at kick 0
        _commitRaw(bob, id, _h(id, 0, bob, 1, S));
        vm.expectRevert(PenaltyMatch.BadReveal.selector);
        _revealRaw(alice, id, 1, S);
    }

    function test_ReplayedHashFromAnotherMatchReverts() public {
        uint256 id1 = _startRanked(carol, dave);
        bytes32 old = _h(id1, 0, carol, 0, S);
        _commitRaw(carol, id1, old);
        _commitRaw(dave, id1, _h(id1, 0, dave, 1, S));
        _revealRaw(carol, id1, 0, S);
        _revealRaw(dave, id1, 1, S);
        _play(id1, true);
        _assertStatus(id1, PenaltyMatch.Status.Finished);

        uint256 id2 = _startRanked(carol, dave);
        assertTrue(id2 != id1);
        _commitRaw(carol, id2, old);
        _commitRaw(dave, id2, _h(id2, 0, dave, 1, S));
        vm.expectRevert(PenaltyMatch.BadReveal.selector);
        _revealRaw(carol, id2, 0, S);
    }

    function test_OpponentsCopiedHashCannotBeRevealed() public {
        bytes32 h = _h(id, 0, alice, 1, S);
        _commitRaw(alice, id, h);
        _commitRaw(bob, id, h); // bob copies alice's commitment
        vm.expectRevert(PenaltyMatch.BadReveal.selector);
        _revealRaw(bob, id, 1, S);
        _revealRaw(alice, id, 1, S);
    }

    function test_CommitmentBindsMainWalletNotSessionKey() public {
        _commitRaw(keyA, id, _h(id, 0, keyA, 1, S)); // hash over the KEY address
        _commitRaw(bob, id, _h(id, 0, bob, 1, S));
        vm.expectRevert(PenaltyMatch.BadReveal.selector);
        _revealRaw(keyA, id, 1, S);
    }

    function test_SessionKeyCommitWithMainWalletHashReveals() public {
        _commitRaw(keyA, id, _h(id, 0, alice, 1, S));
        _commitRaw(keyB, id, _h(id, 0, bob, 2, S));
        _revealRaw(keyA, id, 1, S);
        assertTrue(_m(id).revealed1);
    }

    function test_ZeroCommitReverts() public {
        vm.expectRevert(PenaltyMatch.ZeroCommit.selector);
        _commitRaw(alice, id, bytes32(0));
        vm.expectRevert(PenaltyMatch.ZeroCommit.selector);
        _commitRaw(keyB, id, bytes32(0));
    }

    function test_DoubleCommitReverts() public {
        bytes32 h = _h(id, 0, alice, 1, S);
        _commitRaw(alice, id, h);
        vm.expectRevert(PenaltyMatch.AlreadyCommitted.selector);
        _commitRaw(alice, id, h);
        vm.expectRevert(PenaltyMatch.AlreadyCommitted.selector);
        _commitRaw(keyA, id, h); // same seat through its session key
        _commitRaw(bob, id, _h(id, 0, bob, 1, S)); // moves to Revealing; second seat unaffected
    }

    function test_DoubleCommitSeatTwoReverts() public {
        bytes32 h2 = _h(id, 0, bob, 2, S);
        _commitRaw(bob, id, _h(id, 0, bob, 1, S));
        vm.expectRevert(PenaltyMatch.AlreadyCommitted.selector);
        _commitRaw(keyB, id, h2);
    }

    function test_DoubleRevealReverts() public {
        _bothCommit(id, 1, 2);
        _revealRaw(alice, id, 1, _salt(0, 1));
        vm.expectRevert(PenaltyMatch.AlreadyRevealed.selector);
        _revealRaw(alice, id, 1, _salt(0, 1));
        vm.expectRevert(PenaltyMatch.AlreadyRevealed.selector);
        _revealRaw(keyA, id, 1, _salt(0, 1));
    }

    function test_RevealInCommittingPhaseReverts() public {
        _commitRaw(alice, id, _h(id, 0, alice, 1, S));
        vm.expectRevert(PenaltyMatch.InvalidPhase.selector);
        _revealRaw(alice, id, 1, S);
    }

    function test_CommitInRevealingPhaseReverts() public {
        _bothCommit(id, 1, 2);
        bytes32 h = keccak256("late");
        vm.expectRevert(PenaltyMatch.InvalidPhase.selector);
        _commitRaw(alice, id, h);
        vm.expectRevert(PenaltyMatch.InvalidPhase.selector);
        _commitRaw(bob, id, h);
    }

    function test_InvalidDirectionRevertsForEitherSeat() public {
        _commitRaw(alice, id, _h(id, 0, alice, 3, S));
        _commitRaw(bob, id, _h(id, 0, bob, 255, S));
        vm.expectRevert(PenaltyMatch.InvalidDirection.selector);
        _revealRaw(alice, id, 3, S);
        vm.expectRevert(PenaltyMatch.InvalidDirection.selector);
        _revealRaw(bob, id, 255, S);
        assertFalse(_m(id).revealed1);
        assertFalse(_m(id).revealed2);
    }

    function test_RevealBySessionKeyCountsForItsSeat() public {
        _commitAs(keyA, id, alice, 1);
        _commitAs(keyB, id, bob, 2);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.Revealed(id, 0, alice, 1);
        _revealAs(keyA, id, 1);
        assertTrue(_m(id).revealed1);
        assertFalse(_m(id).revealed2);
        _revealAs(keyB, id, 2);
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.kicks, 1);
        assertTrue(m.lastGoal, "alice shot 1 vs bob dive 2");
        assertEq(m.score1, 1);
    }

    function test_CommitAndRevealRevertOnNonActiveMatches() public {
        uint256 open = _create(carol, address(0));
        bytes32 h = keccak256("x");
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        _commitRaw(carol, open, h);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        _revealRaw(carol, open, 0, S);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        _commitRaw(alice, 999, h);
        _play(id, true);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        _commitRaw(alice, id, h);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        _revealRaw(alice, id, 0, S);
    }
}

/// Seat identity and one-live-match rules.
contract PenaltyMatchSeatsTest is PlayBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _startFriend();
    }

    function test_StrangerCannotCommit() public {
        bytes32 h = keccak256("h");
        vm.expectRevert(PenaltyMatch.NotSeat.selector);
        _commitRaw(stranger, id, h);
        vm.expectRevert(PenaltyMatch.NotSeat.selector);
        _commitRaw(carol, id, h);
    }

    function test_StrangerCannotReveal() public {
        _bothCommit(id, 1, 2);
        vm.expectRevert(PenaltyMatch.NotSeat.selector);
        _revealRaw(stranger, id, 1, _salt(0, 1));
        vm.expectRevert(PenaltyMatch.NotSeat.selector);
        _revealRaw(carol, id, 2, _salt(0, 2));
    }

    function test_MainWalletsAndOwnKeysMapToTheirSeat() public {
        bytes32 h1 = _h(id, 0, alice, 1, S);
        bytes32 h2 = _h(id, 0, bob, 1, S);
        _commitRaw(keyA, id, h1);
        assertEq(_m(id).commit1, h1);
        assertEq(_m(id).commit2, bytes32(0));
        _commitRaw(bob, id, h2);
        assertEq(_m(id).commit2, h2);
    }

    function test_SeatTwoKeyCommitsSeatTwo() public {
        bytes32 h2 = _h(id, 0, bob, 1, S);
        _commitRaw(keyB, id, h2);
        assertEq(_m(id).commit2, h2);
        assertEq(_m(id).commit1, bytes32(0));
    }

    function test_SelfJoinReverts() public {
        uint256 open = _create(carol, keyA);
        vm.prank(carol);
        vm.expectRevert(PenaltyMatch.SelfJoin.selector);
        pm.joinMatch(open, CODE, address(0));
    }

    function test_NoDoubleJoin() public {
        uint256 open = _create(carol, address(0));
        _join(dave, open, address(0));
        // the same wallet joining the same (now Active) room again is blocked by AlreadyInMatch
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(PenaltyMatch.AlreadyInMatch.selector, open));
        pm.joinMatch(open, CODE, address(0));
        // a third wallet cannot take a filled seat
        vm.prank(stranger);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        pm.joinMatch(open, CODE, address(0));
    }

    function test_SeatCannotJoinSecondMatchWhileActive() public {
        uint256 other = _create(carol, address(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PenaltyMatch.AlreadyInMatch.selector, id));
        pm.joinMatch(other, CODE, address(0));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PenaltyMatch.AlreadyInMatch.selector, id));
        pm.joinMatch(other, CODE, address(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PenaltyMatch.AlreadyInMatch.selector, id));
        pm.quickMatch(address(0));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(PenaltyMatch.AlreadyInMatch.selector, id));
        pm.createMatch(bytes32(uint256(1)), address(0));
        _assertStatus(other, PenaltyMatch.Status.Open);
        assertEq(pm.currentMatch(alice), id);
        assertEq(pm.currentMatch(bob), id);
    }

    function test_SeatCanJoinAgainOnlyAfterMatchEnds() public {
        uint256 other = _create(carol, address(0));
        vm.warp(block.timestamp + 21);
        _claim(stranger, id); // abandonment frees both wallets
        _join(alice, other, address(0));
        assertEq(pm.currentMatch(alice), other);
    }
}

/// Step timeouts, forfeit and abandonment. Friend match alice(keyA) vs bob(keyB) unless ranked.
contract PenaltyMatchTimeoutTest is PlayBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _startFriend();
    }

    function _noRankedActivity() internal view {
        (address[10] memory players,,,) = pm.getTopTen();
        assertEq(players[0], address(0));
    }

    function test_CommitStepOneCommitterWinsAfterDeadline() public {
        _commitAs(alice, id, alice, 1);
        uint256 dl = _m(id).deadline;
        vm.warp(dl);
        vm.prank(stranger);
        vm.expectRevert(PenaltyMatch.NotExpired.selector);
        pm.claimTimeout(id);

        vm.warp(dl + 1);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchFinished(id, alice, true);
        _claim(alice, id);
        PenaltyMatch.Match memory m = _m(id);
        assertEq(uint8(m.status), uint8(PenaltyMatch.Status.Finished));
        assertEq(m.winner, alice);
    }

    function test_CommitStepSeatTwoCommitterWins() public {
        _commitAs(keyB, id, bob, 1);
        vm.warp(_m(id).deadline + 1);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchFinished(id, bob, true);
        _claim(keyA, id);
        assertEq(_m(id).winner, bob);
    }

    function test_CommitStepNobodyCommittedIsAbandonment() public {
        uint256 rid = _startRanked(carol, dave);
        vm.warp(_m(rid).deadline + 1);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchFinished(rid, address(0), false);
        _claim(stranger, rid);
        _assertStatus(rid, PenaltyMatch.Status.Finished);
        assertEq(_m(rid).winner, address(0));
        _assertRecord(carol, 0, 0, 0, 0);
        _assertRecord(dave, 0, 0, 0, 0);
        _noRankedActivity();
        assertEq(pm.currentMatch(carol), 0);
        assertEq(pm.currentMatch(dave), 0);
    }

    function test_RevealStepOneRevealerWins() public {
        _bothCommit(id, 1, 2);
        _revealAs(alice, id, 1);
        vm.warp(_m(id).deadline + 1);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchFinished(id, alice, true);
        _claim(stranger, id);
        assertEq(_m(id).winner, alice);
    }

    function test_RevealStepSeatTwoRevealerWins() public {
        _bothCommit(id, 1, 2);
        _revealAs(keyB, id, 2);
        vm.warp(_m(id).deadline + 1);
        _claim(stranger, id);
        assertEq(_m(id).winner, bob);
    }

    function test_RevealStepNobodyRevealedIsAbandonment() public {
        uint256 rid = _startRanked(carol, dave);
        _bothCommit(rid, 1, 2);
        vm.warp(_m(rid).deadline + 1);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchFinished(rid, address(0), false);
        _claim(stranger, rid);
        assertEq(_m(rid).winner, address(0));
        _assertRecord(carol, 0, 0, 0, 0);
        _assertRecord(dave, 0, 0, 0, 0);
        _noRankedActivity();
    }

    function test_RevealStepClaimNotExpiredAtDeadline() public {
        _bothCommit(id, 1, 2);
        uint256 dl = _m(id).deadline;
        vm.warp(dl);
        vm.expectRevert(PenaltyMatch.NotExpired.selector);
        _claim(stranger, id);
        vm.warp(dl + 1);
        _claim(stranger, id);
        _assertStatus(id, PenaltyMatch.Status.Finished);
    }

    function test_RevealDeadlineRestartsAtSecondCommit() public {
        _commitAs(alice, id, alice, 1);
        vm.warp(block.timestamp + 15);
        _commitAs(bob, id, bob, 2);
        uint256 dl = block.timestamp + 20;
        assertEq(_m(id).deadline, dl);
        vm.warp(dl);
        vm.expectRevert(PenaltyMatch.NotExpired.selector);
        _claim(stranger, id);
    }

    function test_NextKickDeadlineRefreshedAfterResolution() public {
        _bothCommit(id, 1, 2);
        vm.warp(block.timestamp + 10);
        _revealAs(alice, id, 1);
        _revealAs(bob, id, 2);
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.deadline, block.timestamp + 20);
        assertEq(uint8(m.phase), uint8(PenaltyMatch.Phase.Committing));
    }

    function test_ActionsAllowedAtDeadlineRevertStepExpiredAfter() public {
        uint256 dl = _m(id).deadline;
        vm.warp(dl);
        _commitAs(alice, id, alice, 1); // exactly at the deadline is still in time
        vm.warp(dl + 1);
        bytes32 h = keccak256("late");
        vm.expectRevert(PenaltyMatch.StepExpired.selector);
        _commitRaw(bob, id, h);
    }

    function test_RevealAfterDeadlineRevertsStepExpired() public {
        _bothCommit(id, 1, 2);
        _revealAs(alice, id, 1);
        vm.warp(_m(id).deadline + 1);
        bytes32 salt = _salt(0, 2);
        vm.expectRevert(PenaltyMatch.StepExpired.selector);
        _revealRaw(bob, id, 2, salt);
    }

    function test_ClaimTimeoutInvalidStatus() public {
        // unknown id
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        _claim(stranger, 999);
        // Open
        uint256 open = _create(carol, address(0));
        vm.warp(block.timestamp + 1000);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        _claim(stranger, open);
        // Cancelled
        vm.prank(carol);
        pm.cancelMatch(open);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        _claim(stranger, open);
        // Finished (and double claim)
        _claim(stranger, id);
        vm.expectRevert(PenaltyMatch.InvalidStatus.selector);
        _claim(stranger, id);
    }

    function test_StrangerClaimMatchesSeatClaim() public {
        // identical scenario claimed by a seat vs a stranger gives the same outcome
        _commitAs(alice, id, alice, 1);
        uint256 snap = vm.snapshotState();
        vm.warp(_m(id).deadline + 1);
        _claim(stranger, id);
        address byStranger = _m(id).winner;
        vm.revertToState(snap);
        vm.warp(_m(id).deadline + 1);
        _claim(bob, id);
        assertEq(_m(id).winner, byStranger);
        assertEq(byStranger, alice);
    }

    function test_WalletsFreeAfterForfeit() public {
        _commitAs(alice, id, alice, 1);
        vm.warp(_m(id).deadline + 1);
        _claim(stranger, id);
        assertEq(pm.currentMatch(alice), 0);
        assertEq(pm.currentMatch(bob), 0);
        uint256 next = _create(alice, keyA);
        _join(bob, next, keyB);
        _assertStatus(next, PenaltyMatch.Status.Active);
        (uint256 q,) = _quick(carol);
        assertTrue(q != 0);
    }

    function test_ForfeitMidMatchKeepsScoreAndAwardsCommitter() public {
        _kickGoal(id, true); // alice scores kick 0
        _commitAs(bob, id, bob, 1);
        vm.warp(_m(id).deadline + 1);
        _claim(stranger, id);
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.winner, bob);
        assertEq(m.score1, 1);
        assertEq(m.kicks, 1);
    }
}

/// Kick resolution, early finish, sudden death and the 62-kick cap.
contract PenaltyMatchKickTest is PlayBase {
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _startFriend();
    }

    function test_ShooterAlternatesAndKickResolvedEvent() public {
        // kick 0: alice (seat 1) shoots 0, bob dives 1 -> goal
        _bothCommit(id, 0, 1);
        _revealAs(alice, id, 0);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.KickResolved(id, 0, alice, 0, 1, true, 1, 0);
        _revealAs(bob, id, 1);

        // kick 1: bob (seat 2) shoots dir2=2, alice dives dir1=2 -> saved
        _bothCommit(id, 2, 2);
        _revealAs(alice, id, 2);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.KickResolved(id, 1, bob, 2, 2, false, 1, 0);
        _revealAs(bob, id, 2);
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.lastShot, 2);
        assertEq(m.lastDive, 2);
        assertFalse(m.lastGoal);
    }

    function test_SeatTwoShotUsesSeatTwoDirection() public {
        _kick(id, 0, 1); // kick 0 : shot 0 (alice) vs dive 1 -> goal
        _kick(id, 0, 1); // kick 1 : bob shoots 1, alice dives 0 -> goal
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.lastShot, 1);
        assertEq(m.lastDive, 0);
        assertEq(m.score2, 1);
    }

    function test_GoalIffShotDiffersFromDiveAllCombos() public {
        for (uint8 s = 0; s < 3; s++) {
            for (uint8 d = 0; d < 3; d++) {
                uint256 snap = vm.snapshotState();
                uint256 mid = _create(carol, address(0));
                _join(dave, mid, address(0));
                _kick(mid, s, d);
                PenaltyMatch.Match memory m = _m(mid);
                assertEq(m.lastGoal, s != d);
                assertEq(m.score1, s != d ? 1 : 0);
                assertEq(m.goalBits, s != d ? 1 : 0);
                vm.revertToState(snap);
            }
        }
    }

    function test_GoalBitsScoresAndLastKick() public {
        _playMask(id, 13, 4); // kicks 0..3 => goal, miss, goal, goal
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.goalBits, 13);
        assertEq(m.score1, 2);
        assertEq(m.score2, 1);
        assertEq(m.kicks, 4);
        assertEq(uint8(m.status), uint8(PenaltyMatch.Status.Active));
        assertTrue(m.lastGoal);
    }

    function test_KickResetsPerKickState() public {
        _bothCommit(id, 1, 2);
        _revealAs(alice, id, 1);
        _revealAs(bob, id, 2);
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.commit1, bytes32(0));
        assertEq(m.commit2, bytes32(0));
        assertFalse(m.revealed1);
        assertFalse(m.revealed2);
        assertEq(m.dir1, 0);
        assertEq(m.dir2, 0);
        assertEq(uint8(m.phase), uint8(PenaltyMatch.Phase.Committing));
    }

    function test_EarlyFinishSeatOneWinsAfterSixKicks() public {
        _playMask(id, 0x155, 5); // alice scores kicks 0,2,4; bob misses
        PenaltyMatch.Match memory m = _m(id);
        assertEq(uint8(m.status), uint8(PenaltyMatch.Status.Active), "3-0 after 5 kicks not yet decided");
        assertEq(m.score1, 3);
        _kickGoal(id, false); // kick 5: bob misses again -> bob can no longer catch up
        m = _m(id);
        assertEq(uint8(m.status), uint8(PenaltyMatch.Status.Finished));
        assertEq(m.kicks, 6);
        assertEq(m.winner, alice);
        assertEq(pm.currentMatch(alice), 0);
        assertEq(pm.currentMatch(bob), 0);
    }

    function test_EarlyFinishSeatTwoWinsAfterSixKicks() public {
        _play(id, false);
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.kicks, 6);
        assertEq(m.winner, bob);
        assertEq(m.score1, 0);
        assertEq(m.score2, 3);
    }

    function test_FinishedEventOnDecidingKick() public {
        _playMask(id, 0x155, 5);
        _bothCommit(id, 0, 0); // kick 5: bob shoots 0, alice dives 0 -> saved, alice 3-0 is decided
        _revealAs(alice, id, 0);
        vm.expectEmit(true, false, false, true, address(pm));
        emit PenaltyMatch.MatchFinished(id, alice, false);
        _revealAs(bob, id, 0);
    }

    function test_FinalRegulationKickDecides() public {
        _playMask(id, 511, 10); // alice 5, bob 4 goals; bob misses the 10th kick
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.kicks, 10);
        assertEq(m.score1, 5);
        assertEq(m.score2, 4);
        assertEq(m.winner, alice);
        assertEq(uint8(m.status), uint8(PenaltyMatch.Status.Finished));
    }

    function test_RegulationTieGoesToSuddenDeath() public {
        _playMask(id, type(uint256).max, 10);
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.kicks, 10);
        assertEq(m.score1, 5);
        assertEq(m.score2, 5);
        assertEq(uint8(m.status), uint8(PenaltyMatch.Status.Active));
        assertEq(m.winner, address(0));
    }

    function test_SuddenDeathSeatOneWinsAfterEvenKickCount() public {
        _playMask(id, type(uint256).max, 10);
        _kickGoal(id, true); // kick 10: alice leads 6-5 but only 11 kicks taken
        assertEq(uint8(_m(id).status), uint8(PenaltyMatch.Status.Active));
        _kickGoal(id, false); // kick 11: bob misses -> 12 kicks, 6-5
        PenaltyMatch.Match memory m = _m(id);
        assertEq(uint8(m.status), uint8(PenaltyMatch.Status.Finished));
        assertEq(m.kicks, 12);
        assertEq(m.winner, alice);
    }

    function test_SuddenDeathSeatTwoWins() public {
        _playMask(id, type(uint256).max, 10);
        _kickGoal(id, false);
        _kickGoal(id, true);
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.kicks, 12);
        assertEq(m.winner, bob);
        assertEq(m.score2, 6);
    }

    function test_SuddenDeathContinuesWhileLevel() public {
        _playMask(id, type(uint256).max, 12); // 6-6 after 12
        assertEq(uint8(_m(id).status), uint8(PenaltyMatch.Status.Active));
        _kickGoal(id, false);
        _kickGoal(id, true); // kick 13 bob scores -> 6-7 after 14
        PenaltyMatch.Match memory m = _m(id);
        assertEq(m.kicks, 14);
        assertEq(m.winner, bob);
    }

    function test_MaxKicksIsDrawWithWinnerZeroAndNoRecords() public {
        uint256 rid = _startRanked(carol, dave);
        _playMask(rid, type(uint256).max, 62);
        PenaltyMatch.Match memory m = _m(rid);
        assertEq(m.kicks, 62);
        assertEq(m.score1, 31);
        assertEq(m.score2, 31);
        assertEq(m.goalBits, (uint64(1) << 62) - 1);
        assertEq(uint8(m.status), uint8(PenaltyMatch.Status.Finished));
        assertEq(m.winner, address(0));
        _assertRecord(carol, 0, 0, 0, 0);
        _assertRecord(dave, 0, 0, 0, 0);
        assertEq(pm.currentMatch(carol), 0);
        assertEq(pm.currentMatch(dave), 0);
    }
}

/// Ranked records and the top-ten board.
contract PenaltyMatchRankedTest is PlayBase {
    function _top() internal view returns (address[10] memory p, uint32[10] memory w) {
        (p, w,,) = pm.getTopTen();
    }

    function test_WinnerAndLoserRecords() public {
        uint256 rid = _startRanked(alice, bob);
        _play(rid, true);
        assertEq(_m(rid).winner, alice);
        _assertRecord(alice, 1, 0, 1, 1);
        _assertRecord(bob, 0, 1, 0, 0);
    }

    function test_SeatTwoWinnerRecords() public {
        uint256 rid = _startRanked(alice, bob);
        _play(rid, false);
        _assertRecord(bob, 1, 0, 1, 1);
        _assertRecord(alice, 0, 1, 0, 0);
    }

    function test_StreakAndBestStreakAccumulate() public {
        _rankedWin(alice, bob);
        _rankedWin(alice, bob);
        _rankedWin(alice, bob);
        _assertRecord(alice, 3, 0, 3, 3);
        _assertRecord(bob, 0, 3, 0, 0);
    }

    function test_LoserStreakResetsButBestStreakKept() public {
        _rankedWin(alice, bob);
        _rankedWin(alice, bob);
        _assertRecord(alice, 2, 0, 2, 2);
        _rankedWin(bob, alice);
        _assertRecord(alice, 2, 1, 0, 2);
        _assertRecord(bob, 1, 2, 1, 1);
        _rankedWin(alice, bob);
        _assertRecord(alice, 3, 1, 1, 2);
        _assertRecord(bob, 1, 3, 0, 1);
    }

    function test_TopTenOrderingAndTiesKeepEarlierPriority() public {
        _win(alice);
        _win(bob); // ties alice at 1 -> below her
        (address[10] memory p,) = _top();
        assertEq(p[0], alice);
        assertEq(p[1], bob);

        _win(bob); // bob 2 > alice 1
        (p,) = _top();
        assertEq(p[0], bob);
        assertEq(p[1], alice);

        _win(alice); // alice 2 ties bob -> stays below
        (p,) = _top();
        assertEq(p[0], bob);
        assertEq(p[1], alice);

        _win(carol);
        _win(alice); // alice 3 passes bob
        (address[10] memory players, uint32[10] memory wins, uint32[10] memory streaks, uint32[10] memory bests) =
            pm.getTopTen();
        assertEq(players[0], alice);
        assertEq(players[1], bob);
        assertEq(players[2], carol);
        assertEq(players[3], address(0));
        assertEq(wins[0], 3);
        assertEq(wins[1], 2);
        assertEq(wins[2], 1);
        assertEq(streaks[0], 3);
        assertEq(bests[0], 3);
        assertEq(streaks[1], 2);
        assertEq(bests[1], 2);
        assertEq(streaks[2], 1);
    }

    function test_TopTenStreakReflectsLossesSinceLatestWin() public {
        _win(alice);
        _win(alice);
        _rankedWin(bob, alice); // alice loses once; still on the board with 2 wins
        (address[10] memory players, uint32[10] memory wins, uint32[10] memory streaks, uint32[10] memory bests) =
            pm.getTopTen();
        assertEq(players[0], alice);
        assertEq(wins[0], 2);
        assertEq(streaks[0], 0);
        assertEq(bests[0], 2);
        assertEq(players[1], bob);
    }

    function test_FullBoardTieDoesNotDisplaceThenHigherWinsDo() public {
        for (uint160 i = 0; i < 10; i++) {
            _win(address(0x100 + i));
        }
        address newcomer = address(0x200);
        _win(newcomer); // 1 win ties the last-placed player -> not admitted
        (address[10] memory p,) = _top();
        assertEq(p[0], address(0x100));
        assertEq(p[9], address(0x109));
        for (uint256 j = 0; j < 10; j++) {
            assertTrue(p[j] != newcomer);
        }
        _win(newcomer); // 2 wins -> enters at the top, evicting the last
        (p,) = _top();
        assertEq(p[0], newcomer);
        assertEq(p[1], address(0x100));
        assertEq(p[9], address(0x108));
    }

    function test_UnrankedFriendRoomNeverTouchesRecords() public {
        uint256 fid = _startFriend();
        _play(fid, true);
        _assertStatus(fid, PenaltyMatch.Status.Finished);
        assertEq(_m(fid).winner, alice);
        _assertRecord(alice, 0, 0, 0, 0);
        _assertRecord(bob, 0, 0, 0, 0);
        (address[10] memory p,) = _top();
        assertEq(p[0], address(0));
    }

    function test_UnrankedForfeitNeverTouchesRecords() public {
        uint256 fid = _startFriend();
        _commitAs(alice, fid, alice, 1);
        vm.warp(_m(fid).deadline + 1);
        _claim(stranger, fid);
        assertEq(_m(fid).winner, alice);
        _assertRecord(alice, 0, 0, 0, 0);
        _assertRecord(bob, 0, 0, 0, 0);
    }

    function test_ForfeitCountsAsRankedWin() public {
        uint256 rid = _startRanked(carol, dave);
        _commitAs(carol, rid, carol, 1);
        vm.warp(_m(rid).deadline + 1);
        _claim(stranger, rid);
        _assertRecord(carol, 1, 0, 1, 1);
        _assertRecord(dave, 0, 1, 0, 0);
        (address[10] memory p,) = _top();
        assertEq(p[0], carol);
    }

    function test_AbandonmentLeavesRecordsUntouched() public {
        uint256 rid = _startRanked(carol, dave);
        vm.warp(_m(rid).deadline + 1);
        _claim(stranger, rid);
        _assertRecord(carol, 0, 0, 0, 0);
        _assertRecord(dave, 0, 0, 0, 0);
    }
}

/// Fuzz: commitment binding and direction validation.
contract PenaltyMatchPlayFuzzTest is PlayBase {
    function testFuzz_CommitHashBindsEveryField(uint256 mid, uint16 kick, address player, uint8 dir, bytes32 salt)
        public
        view
    {
        bytes32 h = pm.commitHash(mid, kick, player, dir, salt);
        assertEq(h, keccak256(abi.encodePacked(mid, kick, player, dir, salt)));
        unchecked {
            assertTrue(h != pm.commitHash(mid + 1, kick, player, dir, salt));
            assertTrue(h != pm.commitHash(mid, kick + 1, player, dir, salt));
            assertTrue(h != pm.commitHash(mid, kick, address(uint160(player) + 1), dir, salt));
            assertTrue(h != pm.commitHash(mid, kick, player, dir + 1, salt));
            assertTrue(h != pm.commitHash(mid, kick, player, dir, bytes32(uint256(salt) + 1)));
        }
    }

    function testFuzz_RevealRequiresExactDirAndSalt(uint8 dirSeed, bytes32 salt, uint8 wrongSeed, bytes32 wrongSalt)
        public
    {
        uint8 dir = uint8(bound(dirSeed, 0, 2));
        uint8 wrongDir = uint8(bound(wrongSeed, 0, 2));
        vm.assume(wrongDir != dir || wrongSalt != salt);
        uint256 id = _startFriend();
        _commitRaw(alice, id, _h(id, 0, alice, dir, salt));
        _commitRaw(bob, id, _h(id, 0, bob, 0, S));
        vm.expectRevert(PenaltyMatch.BadReveal.selector);
        _revealRaw(alice, id, wrongDir, wrongSalt);
        _revealRaw(alice, id, dir, salt);
        assertTrue(_m(id).revealed1);
        assertEq(_m(id).dir1, dir);
    }

    function testFuzz_DirectionValidation(uint8 dir, bytes32 salt) public {
        uint256 id = _startFriend();
        _commitRaw(alice, id, _h(id, 0, alice, dir, salt));
        _commitRaw(bob, id, _h(id, 0, bob, 0, S));
        if (dir > 2) {
            vm.expectRevert(PenaltyMatch.InvalidDirection.selector);
            _revealRaw(alice, id, dir, salt);
            assertFalse(_m(id).revealed1);
        } else {
            _revealRaw(alice, id, dir, salt);
            assertTrue(_m(id).revealed1);
            assertEq(_m(id).dir1, dir);
        }
    }

    function testFuzz_GoalIffShotDiffersFromDive(uint8 a, uint8 b, uint8 c, uint8 d) public {
        a = uint8(bound(a, 0, 2));
        b = uint8(bound(b, 0, 2));
        c = uint8(bound(c, 0, 2));
        d = uint8(bound(d, 0, 2));
        uint256 id = _startFriend();
        _kick(id, a, b); // kick 0: alice shoots a, bob dives b
        _kick(id, c, d); // kick 1: bob shoots d, alice dives c
        PenaltyMatch.Match memory m = _m(id);
        bool g0 = a != b;
        bool g1 = d != c;
        assertEq(m.score1, g0 ? 1 : 0);
        assertEq(m.score2, g1 ? 1 : 0);
        assertEq(uint256(m.goalBits), (g0 ? 1 : 0) | (g1 ? 2 : 0));
        assertEq(m.lastGoal, g1);
    }
}

/// Drives random room/queue/play/timeout actions; actors are the four funded test wallets.
/// Actions are guarded so most calls succeed and the state space is actually explored.
contract PenaltyMatchHandler is Test {
    PenaltyMatch public immutable pm;
    address[4] internal actors;
    uint256[] public ids;
    bytes32 internal constant CODE = keccak256("room-code");
    bytes32 internal constant SALT = keccak256("handler-salt");

    constructor(PenaltyMatch _pm, address[4] memory _actors) {
        pm = _pm;
        actors = _actors;
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % 4];
    }

    function _id(uint256 seed) private view returns (uint256) {
        return ids.length == 0 ? 0 : ids[seed % ids.length];
    }

    function _dir(uint256 id, uint16 kick, bool first) private pure returns (uint8) {
        return uint8(uint256(keccak256(abi.encode(id, kick, first))) % 3);
    }

    function _busy(address who) private view returns (bool) {
        uint256 cid = pm.currentMatch(who);
        return cid != 0 && pm.getMatch(cid).status == PenaltyMatch.Status.Active;
    }

    function quick(uint256 a) external {
        address who = _actor(a);
        if (_busy(who)) return;
        vm.prank(who);
        (uint256 id,) = pm.quickMatch(address(0));
        ids.push(id);
    }

    function create(uint256 a) external {
        address who = _actor(a);
        if (_busy(who)) return;
        bytes32 h = keccak256(abi.encode(who, CODE));
        vm.prank(who);
        uint256 id = pm.createMatch(h, address(0));
        ids.push(id);
    }

    function join(uint256 a, uint256 i) external {
        address who = _actor(a);
        uint256 id = _id(i);
        PenaltyMatch.Match memory m = pm.getMatch(id);
        if (_busy(who) || m.status != PenaltyMatch.Status.Open || m.ranked || m.p1 == who) return;
        vm.prank(who);
        pm.joinMatch(id, CODE, address(0));
    }

    function cancel(uint256 i) external {
        uint256 id = _id(i);
        PenaltyMatch.Match memory m = pm.getMatch(id);
        if (m.status != PenaltyMatch.Status.Open) return;
        vm.prank(m.p1);
        pm.cancelMatch(id);
    }

    /// One seat commits (if it still can).
    function commitOne(uint256 i, bool first) external {
        uint256 id = _id(i);
        PenaltyMatch.Match memory m = pm.getMatch(id);
        if (m.status != PenaltyMatch.Status.Active || m.phase != PenaltyMatch.Phase.Committing) return;
        if (block.timestamp > m.deadline) return;
        if ((first ? m.commit1 : m.commit2) != bytes32(0)) return;
        address who = first ? m.p1 : m.p2;
        bytes32 h = pm.commitHash(id, m.kicks, who, _dir(id, m.kicks, first), SALT);
        vm.prank(who);
        pm.commit(id, h);
    }

    /// One seat reveals (if it still can).
    function revealOne(uint256 i, bool first) external {
        uint256 id = _id(i);
        PenaltyMatch.Match memory m = pm.getMatch(id);
        if (m.status != PenaltyMatch.Status.Active || m.phase != PenaltyMatch.Phase.Revealing) return;
        if (block.timestamp > m.deadline || (first ? m.revealed1 : m.revealed2)) return;
        vm.prank(first ? m.p1 : m.p2);
        pm.reveal(id, _dir(id, m.kicks, first), SALT);
    }

    /// Plays one whole kick if the match is at a fresh commit step.
    function playKick(uint256 i) external {
        uint256 id = _id(i);
        PenaltyMatch.Match memory m = pm.getMatch(id);
        if (m.status != PenaltyMatch.Status.Active || m.phase != PenaltyMatch.Phase.Committing) return;
        if (block.timestamp > m.deadline || m.commit1 != bytes32(0) || m.commit2 != bytes32(0)) return;
        bytes32 h1 = pm.commitHash(id, m.kicks, m.p1, _dir(id, m.kicks, true), SALT);
        bytes32 h2 = pm.commitHash(id, m.kicks, m.p2, _dir(id, m.kicks, false), SALT);
        vm.prank(m.p1);
        pm.commit(id, h1);
        vm.prank(m.p2);
        pm.commit(id, h2);
        vm.prank(m.p1);
        pm.reveal(id, _dir(id, m.kicks, true), SALT);
        vm.prank(m.p2);
        pm.reveal(id, _dir(id, m.kicks, false), SALT);
    }

    function expireAndClaim(uint256 i) external {
        uint256 id = _id(i);
        PenaltyMatch.Match memory m = pm.getMatch(id);
        if (m.status != PenaltyMatch.Status.Active) return;
        if (block.timestamp <= m.deadline) vm.warp(uint256(m.deadline) + 1);
        pm.claimTimeout(id);
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + (dt % 100));
    }
}

contract PenaltyMatchCurrentMatchInvariantTest is PlayBase {
    PenaltyMatchHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new PenaltyMatchHandler(pm, [alice, bob, carol, dave]);
        targetContract(address(handler));
    }

    /// A wallet's pointer only ever names an Open (own) or Active (seated) match, and
    /// Finished / Cancelled matches are pointed at by neither of their seats.
    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 120
    function invariant_CurrentMatchNeverPointsAtEndedMatch() public view {
        address[4] memory who = [alice, bob, carol, dave];
        for (uint256 i = 0; i < 4; i++) {
            uint256 cid = pm.currentMatch(who[i]);
            if (cid == 0) continue;
            PenaltyMatch.Match memory cm = pm.getMatch(cid);
            assertTrue(
                cm.status == PenaltyMatch.Status.Open || cm.status == PenaltyMatch.Status.Active,
                "pointer to ended match"
            );
            assertTrue(cm.p1 == who[i] || cm.p2 == who[i], "pointer to foreign match");
        }
        uint256 n = handler.idsLength();
        for (uint256 j = 0; j < n; j++) {
            uint256 id = handler.ids(j);
            PenaltyMatch.Match memory m = pm.getMatch(id);
            if (m.status == PenaltyMatch.Status.Finished || m.status == PenaltyMatch.Status.Cancelled) {
                assertTrue(pm.currentMatch(m.p1) != id, "p1 still pointing");
                assertTrue(pm.currentMatch(m.p2) != id, "p2 still pointing");
            }
        }
    }

    /// Deterministic walk through every way a match ends: both seats end at exactly zero.
    function test_CurrentMatchZeroForBothSeatsOnceFinishedOrCancelled() public {
        // finished by play
        uint256 a = _startRanked(alice, bob);
        assertEq(pm.currentMatch(alice), a);
        assertEq(pm.currentMatch(bob), a);
        _play(a, true);
        assertEq(pm.currentMatch(alice), 0);
        assertEq(pm.currentMatch(bob), 0);

        // finished by forfeit
        uint256 b = _startRanked(alice, bob);
        _commitAs(bob, b, bob, 1);
        vm.warp(_m(b).deadline + 1);
        _claim(stranger, b);
        assertEq(pm.currentMatch(alice), 0);
        assertEq(pm.currentMatch(bob), 0);

        // finished by abandonment
        uint256 c = _startFriend();
        vm.warp(_m(c).deadline + 1);
        _claim(stranger, c);
        assertEq(pm.currentMatch(alice), 0);
        assertEq(pm.currentMatch(bob), 0);

        // cancelled by creator, by TTL replacement
        uint256 d = _create(carol, address(0));
        vm.prank(carol);
        pm.cancelMatch(d);
        assertEq(pm.currentMatch(carol), 0);
        (uint256 e,) = _quick(carol);
        vm.warp(block.timestamp + 91);
        _quick(dave); // cancels stale e
        _assertStatus(e, PenaltyMatch.Status.Cancelled);
        assertEq(pm.currentMatch(carol), 0);
    }
}
