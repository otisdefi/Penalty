// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PenaltyLeaderboard
/// @notice Records wallet-reported ranked penalty shootout results and the top ten by wins.
/// @dev Intended for a testnet game, including Arc Testnet. Results are self-reported
/// by each wallet; there is no trusted referee, so this leaderboard is not cheat-proof.
/// No owner, upgrade mechanism, payable entry point, receive, or fallback is provided.
contract PenaltyLeaderboard {
    /// @notice A wallet's cumulative match results and winning streaks.
    struct Record {
        uint32 wins;
        uint32 losses;
        uint32 streak;
        uint32 bestStreak;
    }

    /// @notice Match records keyed by the reporting wallet.
    mapping(address => Record) public records;

    mapping(address => mapping(bytes32 => bool)) private recordedMatches;

    /// @dev Descending wins; tied players retain their existing relative priority.
    address[10] private top;

    /// @notice A result would exceed the uint32 capacity of a record counter.
    /// @param player The wallet whose record cannot represent another result.
    error RecordOverflow(address player);

    error MatchAlreadyRecorded(bytes32 matchId);
    error InvalidMatchId();

    /// @notice Emitted after a wallet records its own finished match.
    /// @param player The reporting wallet.
    /// @param won Whether the reported result was a win.
    /// @param wins The wallet's updated cumulative wins.
    /// @param streak The wallet's updated current winning streak.
    event MatchRecorded(address indexed player, bytes32 indexed matchId, bool won, uint32 wins, uint32 streak);

    /// @notice Record one finished ranked match for the caller.
    /// @dev Results are not verified or deduplicated. Leaderboard work is bounded
    /// by ten entries. Counter overflow reverts with RecordOverflow.
    /// @param won True for a win, false for a loss.
    function recordMatch(bytes32 matchId, bool won) external {
        if (matchId == bytes32(0)) {
            revert InvalidMatchId();
        }
        if (recordedMatches[msg.sender][matchId]) {
            revert MatchAlreadyRecorded(matchId);
        }
        recordedMatches[msg.sender][matchId] = true;
        Record storage result = records[msg.sender];
        if (won) {
            if (result.wins == type(uint32).max || result.streak == type(uint32).max) {
                revert RecordOverflow(msg.sender);
            }
            result.wins++;
            result.streak++;
            if (result.streak > result.bestStreak) {
                result.bestStreak = result.streak;
            }
            _updateTop(msg.sender);
        } else {
            if (result.losses == type(uint32).max) {
                revert RecordOverflow(msg.sender);
            }
            result.losses++;
            result.streak = 0;
        }
        emit MatchRecorded(msg.sender, matchId, won, result.wins, result.streak);
    }

    function matchRecorded(address player, bytes32 matchId) public view returns (bool) {
        return recordedMatches[player][matchId];
    }

    /// @notice Get a wallet's current match record, or zeros if it has not played.
    /// @param player The wallet to query.
    /// @return wins Total reported wins.
    /// @return losses Total reported losses.
    /// @return streak Current consecutive reported wins.
    /// @return bestStreak Highest reported winning streak.
    function getRecord(address player)
        external
        view
        returns (uint32 wins, uint32 losses, uint32 streak, uint32 bestStreak)
    {
        Record storage result = records[player];
        return (result.wins, result.losses, result.streak, result.bestStreak);
    }

    /// @notice Get the top ten in descending order of cumulative wins.
    /// @dev Equal scores do not move past an earlier player. Streak values are
    /// read from current records, including losses since a player's last win.
    /// @return players Ranked wallets; unused slots are the zero address.
    /// @return wins Cumulative wins, zero for unused slots.
    /// @return streaks Current winning streaks, zero for unused slots.
    /// @return bestStreaks Best winning streaks, zero for unused slots.
    function getTopTen()
        external
        view
        returns (
            address[10] memory players,
            uint32[10] memory wins,
            uint32[10] memory streaks,
            uint32[10] memory bestStreaks
        )
    {
        for (uint256 i = 0; i < 10; i++) {
            address player = top[i];
            if (player != address(0)) {
                Record storage result = records[player];
                players[i] = player;
                wins[i] = result.wins;
                streaks[i] = result.streak;
                bestStreaks[i] = result.bestStreak;
            }
        }
    }

    /// @dev Find in at most ten slots, admit at slot nine if eligible, then
    /// bubble upward at most nine times. Strict comparison preserves tie priority.
    function _updateTop(address player) private {
        uint256 index = 10;
        for (uint256 i = 0; i < 10; i++) {
            if (top[i] == player) {
                index = i;
                break;
            }
        }

        uint32 playerWins = records[player].wins;
        if (index == 10) {
            address last = top[9];
            if (last != address(0) && playerWins <= records[last].wins) {
                return;
            }
            index = 9;
            top[index] = player;
        }

        while (index > 0) {
            address above = top[index - 1];
            if (above != address(0) && records[above].wins >= playerWins) {
                break;
            }
            top[index] = above;
            top[index - 1] = player;
            index--;
        }
    }
}
