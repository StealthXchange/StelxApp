// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20Metadata {
    function decimals() external view returns (uint8);
}

/// @notice Poseidon over two field elements; parameters must match the circuit's (circomlib).
interface IPoseidonT3 {
    function poseidon(uint256[2] calldata input) external pure returns (uint256);
}

/// @notice Poseidon over four field elements; parameters must match the circuit's (circomlib).
interface IPoseidonT5 {
    function poseidon(uint256[4] calldata input) external pure returns (uint256);
}

/// @notice Groth16 verifier for circuits/transaction.circom. Public signal order: root, publicAmount,
///         boundParamsHash, token, isExit, hasFee, nullifier[0..1], commitment[0..2].
interface ITransactionVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[11] calldata publicSignals
    ) external view returns (bool);
}

/// @title ShieldedPool
/// @notice Shielded pool for a fixed set of ERC-20 assets sharing one depth-24 Poseidon Merkle tree.
///         Spends are authorised by Groth16 proofs that consume nullifiers and create new notes.
contract ShieldedPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct PublicInputs {
        uint256 root;
        uint256[] nullifiers;     // exactly 2
        uint256[] commitments;    // exactly 3; [2] is the relay's fee note
        int256 extAmount;         // <= 0: value leaving the pool (0 for a private send)
        address recipient;        // receives -extAmount less the protocol fee; ignored when extAmount == 0
        address broadcaster;      // bound in the proof; not paid directly
        uint256 fee;              // paid as note [2]; the circuit sees only whether fee > 0
        bytes[] encryptedNotes;   // exactly 3, one per output commitment
        address token;            // asset to pay out; only bound in the proof when value leaves
        bool isExit;              // true: outputs [0] and [1] are provably zero-value and are not inserted
    }

    /// @dev BN254 scalar field modulus. Calldata field elements are range-checked against it, since a
    ///      value >= r would be reduced by the verifier and could alias another valid input.
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    uint256 public constant TREE_DEPTH = 24;
    // forge-lint: disable-next-line(incorrect-shift)
    uint256 public constant TREE_CAPACITY = 1 << TREE_DEPTH;

    /// @dev Caps ciphertext size so a proof cannot bind large calldata that a broadcaster pays for.
    uint256 public constant MAX_NOTE_BYTES = 1024;

    /// @dev Matches the circuit's 120-bit value range, so the conservation sum cannot wrap the field.
    uint256 public constant MAX_VALUE = (1 << 120) - 1;

    /// @notice Minimum deposit as a fraction of one whole token, scaled per asset by its decimals.
    ///         Makes filling the tree with dust deposits cost real value, not just gas.
    uint256 public constant MIN_SHIELD_NUMERATOR = 1;
    uint256 public constant MIN_SHIELD_DENOMINATOR = 1_000_000;

    /// @notice Deposits stop at half capacity, reserving the other half of the tree for spend outputs.
    uint256 public constant SHIELD_CEILING = TREE_CAPACITY / 2;

    /// @notice Protocol fee in basis points, charged on deposits and withdrawals. Private sends are free.
    uint256 public constant FEE_BPS = 10;
    uint256 private constant BPS = 10_000;

    uint256 private constant N_INS = 2;
    uint256 private constant N_OUTS = 3;

    /// @notice Recipient of protocol fees. It has no other power over the pool.
    address public immutable TREASURY;

    IPoseidonT3 public immutable HASH2;
    IPoseidonT5 public immutable HASH4;
    ITransactionVerifier public immutable VERIFIER;

    uint256[TREE_DEPTH] private filledSubtrees;
    uint256[TREE_DEPTH + 1] private zeros;
    /// @dev Every root the tree has ever had. Not a ring buffer, which cheap inserts could flush,
    ///      invalidating honest proofs built against an evicted root.
    mapping(uint256 => bool) private knownRoots;
    uint256 private currentRoot;
    uint256 public nextLeafIndex;

    mapping(uint256 => bool) private spent;

    /// @notice Assets this pool accepts, fixed at deployment.
    mapping(address => bool) public isSupported;

    address[] public supportedTokens;

    /// @notice Protocol fees awaiting collection, per asset. Pulled by collectFees rather than pushed
    ///         per transaction, so a reverting treasury cannot block withdrawals.
    mapping(address => uint256) public treasuryBalance;

    /// @notice Smallest accepted deposit per asset, in that asset's own units.
    mapping(address => uint256) public minShield;

    /// @notice Value owed to notes, per asset. Withdrawals are capped by it, so one asset's notes can
    ///         never be paid from another asset's deposits.
    mapping(address => uint256) public shieldedBalance;

    /// @notice A deposit. `commitment` is the inserted leaf; scanners insert it as given.
    event Shield(uint256 leafIndex, uint256 commitment, address token, bytes encryptedNote);
    /// @notice A private transaction. `commitments` and `encryptedNotes` are exactly the leaves
    ///         inserted, in order: two, or three when a relay is paid.
    event Transact(uint256[] nullifiers, uint256[] commitments, bytes[] encryptedNotes);
    /// @notice A full exit: inputs spent, zero-value outputs not inserted.
    event Exit(uint256[] nullifiers);
    /// @notice The relay's fee note from an exit, inserted as a leaf.
    event ExitFee(uint256 commitment, bytes encryptedNote);
    /// @notice Collected protocol fees moved to the treasury.
    event FeesCollected(address indexed token, uint256 amount);
    /// @notice Never emitted by this contract. Kept in the ABI for clients that scan other pool
    ///         deployments which do emit it.
    event OutputsDropped(uint256[] commitments);

    error BadNoteBlob();
    error NotInField();
    error ValueTooLarge();
    error AmountMismatch();
    error TreeFull();
    error UnknownRoot();
    error NullifierAlreadySpent();
    error DuplicateNullifier();
    error BadArity();
    error BadExtAmount();
    error BadProof();
    error InvalidProof();
    error ValueTooSmall();
    error BadRecipient();
    error NoCodeAtAddress();
    error ZeroCommitment();
    error NoTokens();
    error DuplicateToken();
    error UnsupportedToken();
    error PoolUndercollateralised();
    error TransferShortfall();

    /// @param tokens The complete, permanent set of assets. All share one tree and one anonymity set.
    constructor(
        IERC20[] memory tokens,
        IPoseidonT3 hash2,
        IPoseidonT5 hash4,
        ITransactionVerifier verifier,
        address treasury
    ) {
        if (tokens.length == 0) revert NoTokens();
        if (treasury == address(0) || treasury == address(this)) revert BadRecipient();
        TREASURY = treasury;
        for (uint256 i = 0; i < tokens.length; i++) {
            address t = address(tokens[i]);
            if (t == address(0) || t.code.length == 0) revert NoCodeAtAddress();
            if (isSupported[t]) revert DuplicateToken();
            isSupported[t] = true;
            supportedTokens.push(t);

            // decimals() is optional in ERC-20; assume 18 if absent. The floor only guards
            // against dust, so a wrong guess is not a safety issue.
            uint8 dec = 18;
            // slither-disable-next-line calls-loop
            try IERC20Metadata(t).decimals() returns (uint8 d) { dec = d; } catch {}
            if (dec > 36) revert UnsupportedToken();   // refuse rather than overflow
            // Rounds to zero below 6 decimals; the floor must never be zero.
            uint256 floor_ = (10 ** uint256(dec)) * MIN_SHIELD_NUMERATOR / MIN_SHIELD_DENOMINATOR;
            minShield[t] = floor_ == 0 ? 1 : floor_;
        }
        HASH2 = hash2;
        HASH4 = hash4;
        VERIFIER = verifier;

        // hash2 is called while computing zeros below; hash4 and verifier are not, so check them here.
        if (address(hash4).code.length == 0) revert NoCodeAtAddress();
        if (address(verifier).code.length == 0) revert NoCodeAtAddress();

        uint256 z = 0;
        zeros[0] = z;
        for (uint256 i = 0; i < TREE_DEPTH; i++) {
            filledSubtrees[i] = z;
            // slither-disable-next-line calls-loop
            z = hash2.poseidon([z, z]);
            zeros[i + 1] = z;
        }
        currentRoot = z;
        knownRoots[z] = true;
    }

    function merkleRoot() external view returns (uint256) {
        return currentRoot;
    }

    function isNullifierSpent(uint256 nullifier) external view returns (bool) {
        return spent[nullifier];
    }

    /// @notice True if `root` is any root the tree has ever had.
    /// @dev Paired inserts skip the intermediate root, so clients must prove against roots the chain recorded.
    function isKnownRoot(uint256 root) public view returns (bool) {
        return root != 0 && knownRoots[root];
    }

    function zeroAt(uint256 level) external view returns (uint256) {
        return zeros[level];
    }

    /// @notice Deposit `amount` of `token` as a new note.
    /// @param amount         Gross deposit; the note is worth `amount` less the protocol fee.
    /// @param encryptedNote  publicKey (32) || blinding (32) || net value (32) || ciphertext (<= MAX_NOTE_BYTES).
    /// @dev The commitment is computed here, so a shield note's owner key, blinding and value are public.
    function shield(address token, uint256 amount, bytes calldata encryptedNote) external nonReentrant {
        if (!isSupported[token]) revert UnsupportedToken();
        if (encryptedNote.length < 96 || encryptedNote.length > 96 + MAX_NOTE_BYTES) revert BadNoteBlob();
        if (amount > MAX_VALUE) revert ValueTooLarge();
        if (nextLeafIndex >= SHIELD_CEILING) revert TreeFull();

        uint256 publicKey = uint256(bytes32(encryptedNote[0:32]));
        uint256 blinding = uint256(bytes32(encryptedNote[32:64]));
        if (publicKey >= FIELD_SIZE || blinding >= FIELD_SIZE) revert NotInField();

        // Balance delta rather than `amount`, so a fee-on-transfer or rebasing asset cannot
        // mint a note larger than what arrived.
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;
        if (received != amount) revert AmountMismatch();

        // The floor applies to the gross amount. The note is worth the net, and the blob's
        // value field must equal it.
        if (amount < minShield[token]) revert ValueTooSmall();
        uint256 protocolFee = (amount * FEE_BPS) / BPS;
        uint256 net = amount - protocolFee;
        if (uint256(bytes32(encryptedNote[64:96])) != net) revert AmountMismatch();

        treasuryBalance[token] += protocolFee;
        shieldedBalance[token] += net;

        uint256 commitment = HASH4.poseidon([publicKey, uint256(uint160(token)), net, blinding]);
        uint256 leafIndex = _insert(commitment);
        emit Shield(leafIndex, commitment, token, encryptedNote);
    }

    /// @notice Spend up to two notes and create new ones, optionally withdrawing to a public address.
    /// @param proof   abi.encode(uint256[2] a, uint256[2][2] b, uint256[2] c).
    /// @param inputs  Public inputs; fields a broadcaster could alter are bound via _boundParamsHash.
    function transact(bytes calldata proof, PublicInputs calldata inputs) external nonReentrant {
        if (inputs.nullifiers.length != N_INS || inputs.commitments.length != N_OUTS
            || inputs.encryptedNotes.length != N_OUTS) revert BadArity();
        if (!isKnownRoot(inputs.root)) revert UnknownRoot();

        for (uint256 i = 0; i < N_INS; i++) {
            if (inputs.nullifiers[i] >= FIELD_SIZE) revert NotInField();
            if (spent[inputs.nullifiers[i]]) revert NullifierAlreadySpent();
        }
        if (inputs.nullifiers[0] == inputs.nullifiers[1]) revert DuplicateNullifier();
        for (uint256 i = 0; i < N_OUTS; i++) {
            if (inputs.commitments[i] >= FIELD_SIZE) revert NotInField();
            if (inputs.encryptedNotes[i].length > MAX_NOTE_BYTES) revert BadNoteBlob();
        }

        // Value only leaves through transact; deposits use shield(). The lower bound is
        // checked before negation so type(int256).min cannot panic.
        // forge-lint: disable-next-line(unsafe-typecast)
        if (inputs.extAmount > 0 || inputs.extAmount < -int256(MAX_VALUE)) revert BadExtAmount();
        uint256 withdrawn = uint256(-inputs.extAmount);
        if (inputs.fee > MAX_VALUE) revert ValueTooLarge();
        // The relay fee is paid inside the pool as note [2], so only the withdrawal crosses
        // the boundary and a relayed private send keeps publicAmount at 0.
        uint256 leaving = withdrawn; // <= MAX_VALUE, so FIELD_SIZE - leaving cannot wrap

        if (withdrawn > 0 && (inputs.recipient == address(0) || inputs.recipient == address(this))) revert BadRecipient();

        // publicAmount = -withdrawn mod FIELD_SIZE, matching the circuit's sumIns + publicAmount == sumOuts.
        uint256 publicAmount = leaving == 0 ? 0 : FIELD_SIZE - leaving;

        uint256[11] memory signals = [
            inputs.root,
            publicAmount,
            _boundParamsHash(inputs),
            // publicToken. The circuit binds it to the notes' token only when publicAmount != 0,
            // so a private send reveals nothing about which asset moved.
            uint256(uint160(inputs.token)),
            inputs.isExit ? 1 : 0,
            // hasFee: whether note [2] is inserted. The fee amount itself is public calldata,
            // bound through boundParamsHash.
            inputs.fee > 0 ? 1 : 0,
            inputs.nullifiers[0],
            inputs.nullifiers[1],
            inputs.commitments[0],
            inputs.commitments[1],
            inputs.commitments[2]
        ];

        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _decodeProof(proof);
        if (!VERIFIER.verifyProof(a, b, c, signals)) revert InvalidProof();

        // Effects before interactions.
        spent[inputs.nullifiers[0]] = true;
        spent[inputs.nullifiers[1]] = true;
        // Output values are hidden, so an output is skipped only when the proof shows it is
        // zero-value: outputs [0] and [1] in exit mode, and note [2] when no relay is paid.
        if (inputs.isExit) {
            // A self-submitted exit inserts nothing, so a full tree can always be exited.
            // A relayed exit inserts only the fee note.
            if (inputs.fee > 0) {
                if (nextLeafIndex + 1 > TREE_CAPACITY) revert TreeFull();
                _insert(inputs.commitments[2]);
                emit ExitFee(inputs.commitments[2], inputs.encryptedNotes[2]);
            }
            emit Exit(inputs.nullifiers);
        } else {
            if (nextLeafIndex + N_OUTS > TREE_CAPACITY) revert TreeFull();
            _insertPair(inputs.commitments[0], inputs.commitments[1]);
            // The event carries exactly the inserted leaves, so scanners never infer the count.
            if (inputs.fee > 0) {
                _insert(inputs.commitments[2]);
                emit Transact(inputs.nullifiers, inputs.commitments, inputs.encryptedNotes);
            } else {
                uint256[] memory inserted = new uint256[](2);
                inserted[0] = inputs.commitments[0];
                inserted[1] = inputs.commitments[1];
                bytes[] memory notes = new bytes[](2);
                notes[0] = inputs.encryptedNotes[0];
                notes[1] = inputs.encryptedNotes[1];
                emit Transact(inputs.nullifiers, inserted, notes);
            }
        }

        if (leaving > 0) {
            // inputs.token is bound to the spent notes only when value leaves, as it does here.
            if (!isSupported[inputs.token]) revert UnsupportedToken();
            if (shieldedBalance[inputs.token] < leaving) revert PoolUndercollateralised();
            shieldedBalance[inputs.token] -= leaving;

            // Protocol fee comes out of the withdrawal, not the relay fee, and rounds down.
            uint256 protocolFee = (withdrawn * FEE_BPS) / BPS;
            treasuryBalance[inputs.token] += protocolFee;

            if (withdrawn > protocolFee) {
                uint256 payout = withdrawn - protocolFee;
                // Check what actually left, so a fee-on-transfer or upgraded token reverts
                // instead of silently under-delivering against the ledger.
                uint256 balanceBefore = IERC20(inputs.token).balanceOf(address(this));
                IERC20(inputs.token).safeTransfer(inputs.recipient, payout);
                uint256 sent = balanceBefore - IERC20(inputs.token).balanceOf(address(this));
                if (sent != payout) revert TransferShortfall();
            }
        }
    }

    /// @dev Binds every field a broadcaster could alter, plus chain id and pool address against
    ///      cross-chain and cross-pool replay, reduced mod FIELD_SIZE.
    function _boundParamsHash(PublicInputs calldata inputs) internal view returns (uint256) {
        return uint256(keccak256(abi.encode(
            inputs.extAmount,
            inputs.recipient,
            inputs.broadcaster,
            inputs.fee,
            inputs.encryptedNotes,
            block.chainid,
            address(this)
        ))) % FIELD_SIZE;
    }

    function _decodeProof(bytes calldata proof)
        internal
        pure
        returns (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c)
    {
        if (proof.length != 8 * 32) revert BadProof();
        (a, b, c) = abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
    }

    /// @notice Send collected fees for `token` to TREASURY. Callable by anyone.
    function collectFees(address token) external nonReentrant {
        uint256 owed = treasuryBalance[token];
        if (owed == 0) return;
        treasuryBalance[token] = 0;
        IERC20(token).safeTransfer(TREASURY, owed);
        emit FeesCollected(token, owed);
    }

    /// @dev Inserts two leaves at adjacent indices, hashing their shared path once when they are siblings.
    function _insertPair(uint256 a, uint256 b) internal returns (uint256 firstIndex) {
        firstIndex = nextLeafIndex;
        if (firstIndex + 1 >= TREE_CAPACITY) revert TreeFull();
        if (a == 0 || b == 0) revert ZeroCommitment();

        // Odd start: the pair is split across subtrees and shares no path.
        if (firstIndex & 1 == 1) {
            _insert(a);
            _insert(b);
            return firstIndex;
        }

        // Even start: the two leaves are siblings.
        filledSubtrees[0] = a;
        uint256 current = HASH2.poseidon([a, b]);

        // Walk up from their parent at index firstIndex / 2, starting at level 1.
        uint256 idx = firstIndex >> 1;
        for (uint256 level = 1; level < TREE_DEPTH; level++) {
            if (idx & 1 == 0) {
                filledSubtrees[level] = current;
                // slither-disable-next-line calls-loop
                current = HASH2.poseidon([current, zeros[level]]);
            } else {
                // slither-disable-next-line calls-loop
                current = HASH2.poseidon([filledSubtrees[level], current]);
            }
            idx >>= 1;
        }

        currentRoot = current;
        knownRoots[current] = true;
        nextLeafIndex = firstIndex + 2;
    }

    function _insert(uint256 leaf) internal returns (uint256 index) {
        index = nextLeafIndex;
        if (index >= TREE_CAPACITY) revert TreeFull();

        // The empty leaf is 0, so a zero commitment would leave the root unchanged.
        if (leaf == 0) revert ZeroCommitment();

        uint256 current = leaf;
        uint256 idx = index;
        for (uint256 level = 0; level < TREE_DEPTH; level++) {
            if (idx & 1 == 0) {
                filledSubtrees[level] = current;
                // slither-disable-next-line calls-loop
                current = HASH2.poseidon([current, zeros[level]]);
            } else {
                // slither-disable-next-line calls-loop
                current = HASH2.poseidon([filledSubtrees[level], current]);
            }
            idx >>= 1;
        }

        currentRoot = current;
        knownRoots[current] = true;
        nextLeafIndex = index + 1;
    }
}
