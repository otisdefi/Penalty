// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PenaltyMatch
/// @notice Trustless two-wallet penalty shootouts with an independent verified leaderboard.
/// @dev Friend rooms are unranked. A roomCode provides casual privacy, not a hard secret:
/// calldata and pending transactions are public. Commitments must use fresh, unpredictable salts.
/// A player refusing to reveal after seeing the opponent's reveal only forfeits the whole
/// match, never gains an advantage within that match. Ranked forfeit farming through sybils
/// or collusion is possible and out of scope. No owner, admin, upgrades, receive or fallback.
/// Native msg.value is the 18-decimal USDC gas-token view on Arc Testnet; no ERC-20 is used.
contract PenaltyMatch {
    uint256 public constant STEP_TIMEOUT = 20 seconds;
    uint16 public constant REGULATION_KICKS = 5;
    uint16 public constant MAX_KICKS = 62;
    uint256 public constant QUEUE_TTL = 90 seconds;

    enum Status { None, Open, Active, Finished, Cancelled }
    enum Phase { Committing, Revealing }

    struct Match {
        address p1;
        address p2;
        address key1;
        address key2;
        bytes32 codeHash;
        bytes32 commit1;
        bytes32 commit2;
        bool revealed1;
        bool revealed2;
        uint8 dir1;
        uint8 dir2;
        uint64 deadline;
        uint64 createdAt;
        uint64 createdBlock;
        uint16 kicks;
        uint16 score1;
        uint16 score2;
        uint64 goalBits;
        uint8 lastShot;
        uint8 lastDive;
        bool lastGoal;
        bool ranked;
        Status status;
        Phase phase;
        address winner;
    }

    /// @notice Verified ranked results only; counters have the offline leaderboard's semantics.
    struct Record {
        uint32 wins;
        uint32 losses;
        uint32 streak;
        uint32 bestStreak;
    }

    mapping(uint256 => Match) private matches;
    mapping(address => uint256) public currentMatch;
    mapping(address => Record) public records;
    uint256 public queuedMatch;
    uint256 private nextId = 1;
    address[10] private top;
    bool private entered;

    error AlreadyInMatch(uint256 id);
    error InvalidStatus();
    error InvalidPhase();
    error NotSeat();
    error NotCreator();
    error SelfJoin();
    error SessionKeyInvalid();
    error BadCode();
    error ZeroCommit();
    error AlreadyCommitted();
    error AlreadyRevealed();
    error InvalidDirection();
    error BadReveal();
    error StepExpired();
    error NotExpired();
    error ForwardFailed();
    error ReentrantCall();
    error RecordOverflow(address player);

    event MatchCreated(uint256 indexed id, address creator, bool ranked);
    event MatchJoined(uint256 indexed id, address player);
    event Committed(uint256 indexed id, uint16 kick, address player);
    event Revealed(uint256 indexed id, uint16 kick, address player, uint8 dir);
    event KickResolved(
        uint256 indexed id, uint16 kickIndex, address shooter, uint8 shot,
        uint8 dive, bool goal, uint16 score1, uint16 score2
    );
    event MatchFinished(uint256 indexed id, address winner, bool forfeit);
    event MatchCancelled(uint256 indexed id);

    /// @dev Funding callbacks cannot reenter any state-changing entry point.
    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    /// @notice Create an unranked friend room; hash = keccak256(abi.encode(creator, roomCode)).
    /// @param sessionKey Optional distinct gas-funded delegate; zero requires zero msg.value.
    function createMatch(bytes32 codeHash, address sessionKey)
        external payable nonReentrant returns (uint256 id)
    {
        _prepare(msg.sender);
        _validateKey(sessionKey);
        id = _create(codeHash, sessionKey, false);
        _forward(sessionKey);
    }

    /// @notice Join an unranked room with its casual-privacy code, starting the first commit step.
    function joinMatch(uint256 id, bytes32 roomCode, address sessionKey)
        external payable nonReentrant
    {
        _prepare(msg.sender);
        Match storage m = matches[id];
        if (m.p1 == msg.sender) revert SelfJoin();
        if (m.status != Status.Open || m.ranked) revert InvalidStatus();
        if (keccak256(abi.encode(m.p1, roomCode)) != m.codeHash) revert BadCode();
        _join(id, sessionKey);
        _forward(sessionKey);
    }

    /// @notice Join the live ranked queue slot or create a new one; expire stale waiting rooms.
    /// @return id The joined or newly created match id.
    /// @return matched True if a second seat was filled and play has started.
    function quickMatch(address sessionKey)
        external payable nonReentrant returns (uint256 id, bool matched)
    {
        _prepare(msg.sender);
        _validateKey(sessionKey);
        uint256 waiting = queuedMatch;
        if (waiting != 0) {
            Match storage m = matches[waiting];
            if (m.status == Status.Open && m.ranked) {
                if (block.timestamp > uint256(m.createdAt) + QUEUE_TTL) {
                    _cancel(waiting);
                } else if (m.p1 != msg.sender && _canJoinQueued(m, sessionKey)) {
                    _join(waiting, sessionKey);
                    queuedMatch = 0;
                    _forward(sessionKey);
                    return (waiting, true);
                }
            } else {
                queuedMatch = 0;
            }
        }
        id = _create(bytes32(0), sessionKey, true);
        queuedMatch = id;
        _forward(sessionKey);
        return (id, false);
    }

    /// @notice Cancel a waiting room as its creator wallet or creator session key.
    function cancelMatch(uint256 id) external nonReentrant {
        Match storage m = matches[id];
        if (m.status != Status.Open) revert InvalidStatus();
        if (msg.sender != m.p1 && msg.sender != m.key1) revert NotCreator();
        _cancel(id);
    }

    /// @notice Commit the current kick's direction as either seat's main wallet or delegate.
    function commit(uint256 id, bytes32 hash) external nonReentrant {
        Match storage m = matches[id];
        _checkStep(m, Phase.Committing);
        bool first = _seat(m);
        if (hash == bytes32(0)) revert ZeroCommit();
        if (first) {
            if (m.commit1 != bytes32(0)) revert AlreadyCommitted();
            m.commit1 = hash;
        } else {
            if (m.commit2 != bytes32(0)) revert AlreadyCommitted();
            m.commit2 = hash;
        }
        emit Committed(id, m.kicks, first ? m.p1 : m.p2);
        if (m.commit1 != bytes32(0) && m.commit2 != bytes32(0)) {
            m.phase = Phase.Revealing;
            m.deadline = uint64(block.timestamp + STEP_TIMEOUT);
        }
    }

    /// @notice Reveal a committed direction; the second reveal deterministically resolves the kick.
    function reveal(uint256 id, uint8 dir, bytes32 salt) external nonReentrant {
        Match storage m = matches[id];
        _checkStep(m, Phase.Revealing);
        bool first = _seat(m);
        if (dir > 2) revert InvalidDirection();
        address player = first ? m.p1 : m.p2;
        if (first ? m.revealed1 : m.revealed2) revert AlreadyRevealed();
        if (commitHash(id, m.kicks, player, dir, salt) != (first ? m.commit1 : m.commit2)) {
            revert BadReveal();
        }
        if (first) {
            m.dir1 = dir;
            m.revealed1 = true;
        } else {
            m.dir2 = dir;
            m.revealed2 = true;
        }
        emit Revealed(id, m.kicks, player, dir);
        if (m.revealed1 && m.revealed2) _resolve(id);
    }

    /// @notice Permissionless timeout settlement, including by either wallet or session key.
    /// @dev Exactly one participating seat wins; neither participating means abandonment.
    /// Permissionless settlement is intentional: actions before the deadline fully determine
    /// the outcome, and settlement frees stuck wallets.
    function claimTimeout(uint256 id) external nonReentrant {
        Match storage m = matches[id];
        if (m.status != Status.Active) revert InvalidStatus();
        if (block.timestamp <= m.deadline) revert NotExpired();
        bool first = m.phase == Phase.Committing ? m.commit1 != bytes32(0) : m.revealed1;
        bool second = m.phase == Phase.Committing ? m.commit2 != bytes32(0) : m.revealed2;
        address winner = address(0);
        if (first && !second) winner = m.p1;
        else if (second && !first) winner = m.p2;
        _finish(id, winner, winner != address(0));
    }

    /// @notice Client-compatible commitment, using the seat's MAIN wallet, never its key.
    function commitHash(uint256 id, uint16 kick, address player, uint8 dir, bytes32 salt)
        public pure returns (bytes32)
    {
        return keccak256(abi.encodePacked(id, kick, player, dir, salt));
    }

    /// @notice Return the complete match state; unknown ids return an empty None match.
    function getMatch(uint256 id) external view returns (Match memory) {
        return matches[id];
    }

    /// @notice Get a wallet's verified ranked wins, losses, current streak and best streak.
    function getRecord(address player)
        external view returns (uint32 wins, uint32 losses, uint32 streak, uint32 bestStreak)
    {
        Record storage result = records[player];
        return (result.wins, result.losses, result.streak, result.bestStreak);
    }

    /// @notice Top ten by wins, preserving existing priority on ties; unused slots are zero.
    /// @dev Streaks reflect current records, including any losses since the latest win.
    function getTopTen()
        external view returns (
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

    /// @dev Only main-wallet pointers are tracked. An existing open room is replaced atomically.
    function _prepare(address sender) private {
        uint256 id = currentMatch[sender];
        if (id == 0) return;
        Match storage m = matches[id];
        if (m.status == Status.Active) revert AlreadyInMatch(id);
        if (m.status == Status.Open && m.p1 == sender) _cancel(id);
        else delete currentMatch[sender];
    }

    function _validateKey(address key) private view {
        if (key == msg.sender || (key == address(0) && msg.value != 0)) {
            revert SessionKeyInvalid();
        }
    }

    function _create(bytes32 codeHash, address key, bool ranked) private returns (uint256 id) {
        id = nextId++;
        Match storage m = matches[id];
        m.p1 = msg.sender;
        m.key1 = key;
        m.codeHash = codeHash;
        m.createdAt = uint64(block.timestamp);
        m.createdBlock = uint64(block.number);
        m.ranked = ranked;
        m.status = Status.Open;
        currentMatch[msg.sender] = id;
        emit MatchCreated(id, msg.sender, ranked);
    }

    function _canJoinQueued(Match storage m, address key) private view returns (bool) {
        return msg.sender != m.key1 && (key == address(0) || (key != m.p1 && key != m.key1));
    }

    function _join(uint256 id, address key) private {
        Match storage m = matches[id];
        if (m.p1 == msg.sender) revert SelfJoin();
        _validateKey(key);
        if (msg.sender == m.key1 || (key != address(0) && (key == m.p1 || key == m.key1))) {
            revert SessionKeyInvalid();
        }
        m.p2 = msg.sender;
        m.key2 = key;
        m.status = Status.Active;
        m.phase = Phase.Committing;
        m.deadline = uint64(block.timestamp + STEP_TIMEOUT);
        currentMatch[msg.sender] = id;
        emit MatchJoined(id, msg.sender);
    }

    function _cancel(uint256 id) private {
        Match storage m = matches[id];
        m.status = Status.Cancelled;
        delete currentMatch[m.p1];
        if (queuedMatch == id) queuedMatch = 0;
        emit MatchCancelled(id);
    }

    /// @dev All match and queue effects precede the only external interaction.
    function _forward(address key) private {
        if (msg.value != 0) {
            (bool success,) = payable(key).call{value: msg.value}("");
            if (!success) revert ForwardFailed();
        }
    }

    function _checkStep(Match storage m, Phase phase) private view {
        if (m.status != Status.Active) revert InvalidStatus();
        if (m.phase != phase) revert InvalidPhase();
        if (block.timestamp > m.deadline) revert StepExpired();
    }

    function _seat(Match storage m) private view returns (bool first) {
        if (msg.sender == m.p1 || msg.sender == m.key1) return true;
        if (msg.sender == m.p2 || msg.sender == m.key2) return false;
        revert NotSeat();
    }

    function _resolve(uint256 id) private {
        Match storage m = matches[id];
        uint16 kick = m.kicks;
        bool red = kick % 2 == 0;
        uint8 shot = red ? m.dir1 : m.dir2;
        uint8 dive = red ? m.dir2 : m.dir1;
        bool goal = shot != dive;
        if (goal) {
            if (red) m.score1++;
            else m.score2++;
            m.goalBits |= uint64(1) << kick;
        }
        m.lastShot = shot;
        m.lastDive = dive;
        m.lastGoal = goal;
        m.kicks = kick + 1;
        emit KickResolved(id, kick, red ? m.p1 : m.p2, shot, dive, goal, m.score1, m.score2);

        address winner = _kickWinner(m);
        if (winner != address(0) || m.kicks == MAX_KICKS) {
            _finish(id, winner, false);
        } else {
            m.commit1 = bytes32(0);
            m.commit2 = bytes32(0);
            m.revealed1 = false;
            m.revealed2 = false;
            m.dir1 = 0;
            m.dir2 = 0;
            m.phase = Phase.Committing;
            m.deadline = uint64(block.timestamp + STEP_TIMEOUT);
        }
    }

    function _kickWinner(Match storage m) private view returns (address) {
        uint16 count = m.kicks;
        if (count < 2 * REGULATION_KICKS) {
            uint16 p1Left = REGULATION_KICKS - (count + 1) / 2;
            uint16 p2Left = REGULATION_KICKS - count / 2;
            if (m.score1 > m.score2 + p2Left) return m.p1;
            if (m.score2 > m.score1 + p1Left) return m.p2;
        } else if (count % 2 == 0 && m.score1 != m.score2) {
            return m.score1 > m.score2 ? m.p1 : m.p2;
        }
        return address(0);
    }

    function _finish(uint256 id, address winner, bool forfeit) private {
        Match storage m = matches[id];
        m.status = Status.Finished;
        m.winner = winner;
        delete currentMatch[m.p1];
        delete currentMatch[m.p2];
        emit MatchFinished(id, winner, forfeit);
        if (m.ranked && winner != address(0)) {
            address loser = winner == m.p1 ? m.p2 : m.p1;
            Record storage won = records[winner];
            Record storage lost = records[loser];
            if (won.wins == type(uint32).max || won.streak == type(uint32).max) {
                revert RecordOverflow(winner);
            }
            if (lost.losses == type(uint32).max) revert RecordOverflow(loser);
            won.wins++;
            won.streak++;
            if (won.streak > won.bestStreak) won.bestStreak = won.streak;
            lost.losses++;
            lost.streak = 0;
            _updateTop(winner);
        }
    }

    /// @dev Copied from PenaltyLeaderboard: bounded search and strict tie-preserving bubbling.
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
