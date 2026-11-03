// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PenaltyMatch} from "../PenaltyMatch.sol";

/// @dev Shared fixtures and helpers. Contains no test/fuzz/invariant functions.
abstract contract PenaltyMatchTestBase is Test {
    PenaltyMatch internal pm;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal stranger = makeAddr("stranger");
    address internal keyA = makeAddr("keyA");
    address internal keyB = makeAddr("keyB");

    bytes32 internal constant CODE = keccak256("room-code");

    function setUp() public virtual {
        vm.warp(1_000);
        vm.roll(100);
        pm = new PenaltyMatch();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        vm.deal(dave, 100 ether);
    }

    // ---------------------------------------------------------------- rooms

    function _codeHash(address creator, bytes32 code) internal pure returns (bytes32) {
        return keccak256(abi.encode(creator, code));
    }

    function _create(address creator, address key) internal returns (uint256 id) {
        vm.prank(creator);
        id = pm.createMatch(_codeHash(creator, CODE), key);
    }

    function _join(address joiner, uint256 id, address key) internal {
        vm.prank(joiner);
        pm.joinMatch(id, CODE, key);
    }

    /// alice (key keyA) creates, bob (key keyB) joins. Returns active friend match id.
    function _startFriend() internal returns (uint256 id) {
        id = _create(alice, keyA);
        _join(bob, id, keyB);
    }

    function _quick(address who) internal returns (uint256 id, bool matched) {
        vm.prank(who);
        (id, matched) = pm.quickMatch(address(0));
    }

    /// `a` queues first (seat 1), `b` joins (seat 2). Ranked, main-wallet play.
    function _startRanked(address a, address b) internal returns (uint256 id) {
        (id,) = _quick(a);
        (uint256 id2, bool matched) = _quick(b);
        assertEq(id2, id);
        assertTrue(matched);
    }

    // ---------------------------------------------------------------- play

    function _salt(uint16 kick, uint8 dir) internal pure returns (bytes32) {
        return keccak256(abi.encode("salt", kick, dir));
    }

    function _commitAs(address sender, uint256 id, address player, uint8 dir) internal {
        uint16 k = pm.getMatch(id).kicks;
        bytes32 h = pm.commitHash(id, k, player, dir, _salt(k, dir));
        vm.prank(sender);
        pm.commit(id, h);
    }

    function _revealAs(address sender, uint256 id, uint8 dir) internal {
        uint16 k = pm.getMatch(id).kicks;
        vm.prank(sender);
        pm.reveal(id, dir, _salt(k, dir));
    }

    /// Full kick through the main wallets: d1 = seat 1 direction, d2 = seat 2 direction.
    function _kick(uint256 id, uint8 d1, uint8 d2) internal {
        PenaltyMatch.Match memory m = pm.getMatch(id);
        _commitAs(m.p1, id, m.p1, d1);
        _commitAs(m.p2, id, m.p2, d2);
        _revealAs(m.p1, id, d1);
        _revealAs(m.p2, id, d2);
    }

    /// Plays one kick whose outcome is `goal`; seat 1 shoots on even kicks, seat 2 on odd.
    function _kickGoal(uint256 id, bool goal) internal {
        uint16 k = pm.getMatch(id).kicks;
        uint8 shot = 0;
        uint8 dive = goal ? 1 : 0;
        if (k % 2 == 0) _kick(id, shot, dive);
        else _kick(id, dive, shot);
    }

    /// Bit k of `mask` => kick k is a goal. Stops when finished or after `n` kicks.
    function _playMask(uint256 id, uint256 mask, uint256 n) internal {
        for (uint256 i = 0; i < n; i++) {
            if (pm.getMatch(id).status != PenaltyMatch.Status.Active) break;
            _kickGoal(id, ((mask >> i) & 1) == 1);
        }
    }

    /// Plays until finished: seat 1 scores every kick it takes and seat 2 never scores (or reverse).
    function _play(uint256 id, bool seat1Wins) internal {
        while (true) {
            PenaltyMatch.Match memory m = pm.getMatch(id);
            if (m.status != PenaltyMatch.Status.Active) break;
            bool seat1Shoots = m.kicks % 2 == 0;
            _kickGoal(id, seat1Shoots == seat1Wins);
        }
    }

    function _rankedWin(address winner, address loser) internal returns (uint256 id) {
        id = _startRanked(winner, loser);
        _play(id, true);
    }
}
