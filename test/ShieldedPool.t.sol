// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {ShieldedPool, IPoseidonT3, IPoseidonT5, ITransactionVerifier} from "../contracts/ShieldedPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockLowDecimals is ERC20 {
    constructor() ERC20("Low Decimals", "LOW") {}
    function decimals() public pure override returns (uint8) { return 4; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockUSDG is ERC20 {
    constructor() ERC20("Global Dollar", "USDG") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockShortfallToken is ERC20 {
    constructor() ERC20("Shortfall", "SHORT") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function transfer(address to, uint256 amount) public override returns (bool) {
        return super.transfer(to, amount - amount / 100);
    }
}

contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// Accepts or rejects every proof. Real-proof tests are in ProofIntegration.t.sol.
contract StubVerifier is ITransactionVerifier {
    bool public ok = true;
    function set(bool v) external { ok = v; }
    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[11] calldata)
        external view returns (bool)
    {
        return ok;
    }
}

library HasherDeployer {
    function deploy(bytes memory creationCode) internal returns (address addr) {
        assembly { addr := create(0, add(creationCode, 0x20), mload(creationCode)) }
        require(addr != address(0), "hasher deploy failed");
    }
}

contract ShieldedPoolTest is Test {
    uint256 constant R = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    /// Slot of `nextLeafIndex`: after filledSubtrees (TREE_DEPTH words from slot 1),
    /// zeros (TREE_DEPTH + 1), knownRoots and currentRoot.
    function _nextLeafSlot() internal view returns (uint256) {
        uint256 depth = pool.TREE_DEPTH();
        return 1 + depth + (depth + 1) + 2;
    }

    MockWETH weth;
    address treasury = address(0x7EA5);
    MockWETH other;
    IPoseidonT3 hash2;
    IPoseidonT5 hash4;
    StubVerifier verifier;
    ShieldedPool pool;

    string vectors;

    address alice = address(0xA11CE);

    function setUp() public {
        hash2 = IPoseidonT3(HasherDeployer.deploy(vm.parseBytes(vm.readFile("build/PoseidonT3.bin"))));
        hash4 = IPoseidonT5(HasherDeployer.deploy(vm.parseBytes(vm.readFile("build/PoseidonT5.bin"))));
        weth = new MockWETH();
        other = new MockWETH();
        verifier = new StubVerifier();
        IERC20[] memory assets = new IERC20[](2);
        assets[0] = weth;
        assets[1] = other;
        pool = new ShieldedPool(assets, hash2, hash4, verifier, treasury);
        vectors = vm.readFile("vectors.json");

        weth.mint(alice, 1_000_000 ether);
        vm.prank(alice);
        weth.approve(address(pool), type(uint256).max);
    }

    function test_poseidon_sanity_matches_vectors() public view {
        assertEq(hash2.poseidon([uint256(1), 2]), vm.parseJsonUint(vectors, ".poseidon.h12"));
        assertEq(hash4.poseidon([uint256(1), 2, 3, 4]), vm.parseJsonUint(vectors, ".poseidon.h1234"));
    }

    function test_zero_nodes_match_vectors() public view {
        uint256[] memory zeros = vm.parseJsonUintArray(vectors, ".tree.zeros");
        for (uint256 i = 0; i < zeros.length; i++) {
            assertEq(pool.zeroAt(i), zeros[i], "zero node");
        }
        assertEq(pool.merkleRoot(), vm.parseJsonUint(vectors, ".tree.empty"), "empty root");
    }

    function test_roots_after_each_insert_match_vectors() public {
        // The vector notes use mainnet token addresses, so their commitments go into a harness, not the pool.
        TreeHarness t = new TreeHarness(hash2);
        uint256[] memory roots = vm.parseJsonUintArray(vectors, ".tree.roots");
        for (uint256 i = 0; i < roots.length; i++) {
            uint256 c = vm.parseJsonUint(vectors, string.concat(".notes[", vm.toString(i), "].commitment"));
            t.insert(c);
            uint256 expected = roots[i];
            assertEq(t.root(), expected, string.concat("root after insert ", vm.toString(i + 1)));
        }
    }

    function test_shield_commitment_matches_vector_formula() public {
        uint256 publicKey = vm.parseJsonUint(vectors, ".keys[0].pk");
        uint256 blinding = 111;
        uint256 amount = 1 ether;
        bytes memory blob = abi.encodePacked(bytes32(publicKey), bytes32(blinding), bytes32(_net(amount)), hex"deadbeef");

        uint256 expectedCommitment = hash4.poseidon([publicKey, uint256(uint160(address(weth))), _net(amount), blinding]);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit ShieldedPool.Shield(0, expectedCommitment, address(weth), blob);
        pool.shield(address(weth), amount, blob);

        TreeHarness t = new TreeHarness(hash2);
        t.insert(expectedCommitment);
        assertEq(pool.merkleRoot(), t.root(), "root after one shield");
        assertEq(pool.nextLeafIndex(), 1);
        assertEq(weth.balanceOf(address(pool)), amount);
    }

    function test_shield_rejects_wrong_token() public {
        bytes memory blob = new bytes(96);
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.UnsupportedToken.selector);
        pool.shield(address(0xBEEF), 1, blob);
    }

    function test_shield_rejects_short_blob() public {
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.BadNoteBlob.selector);
        pool.shield(address(weth), 1, new bytes(95));
    }

    function test_shield_rejects_out_of_field_key() public {
        uint256 amt = pool.minShield(address(weth));
        bytes memory blob = abi.encodePacked(bytes32(R), bytes32(uint256(1)), bytes32(_net(amt)));
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.NotInField.selector);
        pool.shield(address(weth), amt, blob);
    }

    function test_shield_rejects_value_above_circuit_range() public {
        bytes memory blob = new bytes(96);
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.ValueTooLarge.selector);
        pool.shield(address(weth), (1 << 120), blob);
    }

    function _inputs() internal view returns (ShieldedPool.PublicInputs memory p) {
        p.root = pool.merkleRoot();
        p.nullifiers = new uint256[](2);
        p.nullifiers[0] = 11; p.nullifiers[1] = 22;
        p.commitments = new uint256[](3);
        p.commitments[0] = 33; p.commitments[1] = 44; p.commitments[2] = 55;
        p.encryptedNotes = new bytes[](3);
        p.encryptedNotes[0] = hex"01"; p.encryptedNotes[1] = hex"02"; p.encryptedNotes[2] = hex"03";
        p.broadcaster = address(0xB0B);
        p.token = address(weth);
    }

    function _proof() internal pure returns (bytes memory) {
        uint256[2] memory a; uint256[2][2] memory b; uint256[2] memory c;
        return abi.encode(a, b, c);
    }

    /// Reads pool.FEE_BPS(), so call it before vm.prank or the prank is spent on that call.
    function _blob(uint256 gross) internal view returns (bytes memory) {
        uint256 net = gross - (gross * pool.FEE_BPS()) / 10_000;
        return abi.encodePacked(bytes32(0), bytes32(0), bytes32(net));
    }

    function _net(uint256 gross) internal view returns (uint256) {
        return gross - (gross * pool.FEE_BPS()) / 10_000;
    }

    function _fund() internal {
        bytes memory blob = _blob(10 ether);
        vm.prank(alice);
        pool.shield(address(weth), 10 ether, blob);
    }

    function test_shield_rejects_blob_value_that_disagrees_with_amount() public {
        bytes memory blob = _blob(2 ether);
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.AmountMismatch.selector);
        pool.shield(address(weth), 1 ether, blob);
    }

    function test_transact_private_send_records_nullifiers_and_leaves() public {
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        pool.transact(_proof(), p);
        assertTrue(pool.isNullifierSpent(11));
        assertTrue(pool.isNullifierSpent(22));
        assertEq(pool.nextLeafIndex(), 3);
    }

    function test_transact_double_spend_rejected() public {
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        pool.transact(_proof(), p);
        p.root = pool.merkleRoot();
        p.commitments[0] = 55; p.commitments[1] = 66;
        vm.expectRevert(ShieldedPool.NullifierAlreadySpent.selector);
        pool.transact(_proof(), p);
    }

    function test_transact_same_nullifier_twice_in_one_tx_rejected() public {
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        p.nullifiers[1] = p.nullifiers[0];
        vm.expectRevert(ShieldedPool.DuplicateNullifier.selector);
        pool.transact(_proof(), p);
    }

    function test_transact_unknown_root_rejected() public {
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        p.root = 12345;
        vm.expectRevert(ShieldedPool.UnknownRoot.selector);
        pool.transact(_proof(), p);
    }

    function test_transact_invalid_proof_rejected() public {
        _fund();
        verifier.set(false);
        ShieldedPool.PublicInputs memory p = _inputs();
        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        pool.transact(_proof(), p);
    }

    function test_transact_rejects_positive_ext_amount() public {
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = 1;
        vm.expectRevert(ShieldedPool.BadExtAmount.selector);
        pool.transact(_proof(), p);
    }

    function test_transact_rejects_out_of_field_nullifier() public {
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        p.nullifiers[0] = R;
        vm.expectRevert(ShieldedPool.NotInField.selector);
        pool.transact(_proof(), p);
    }

    function test_unshield_pays_recipient_and_leaves_the_relay_fee_inside() public {
        uint256 amountIn = 10 ether;
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = -3 ether;
        p.recipient = address(0xCAFE);
        p.fee = 0.1 ether;
        pool.transact(_proof(), p);
        assertEq(weth.balanceOf(address(0xCAFE)), _net(3 ether));
        assertEq(weth.balanceOf(address(0xB0B)), 0, "broadcaster fee stays inside the pool");
        // Only the net withdrawal leaves; the relay fee note and the protocol fee stay in the pool.
        assertEq(weth.balanceOf(address(pool)), amountIn - _net(3 ether));
    }

    function test_every_root_stays_known() public {
        _fund();
        uint256 emptyRoot = vm.parseJsonUint(vectors, ".tree.empty");
        uint256 oldRoot = pool.merkleRoot();
        uint256 amt = pool.minShield(address(weth));
        bytes memory blob = abi.encodePacked(bytes32(0), bytes32(0), bytes32(_net(amt)));
        for (uint256 i = 0; i < 100; i++) {
            vm.prank(alice);
            pool.shield(address(weth), amt, blob);
        }
        assertTrue(pool.isKnownRoot(emptyRoot), "empty root known");
        assertTrue(pool.isKnownRoot(oldRoot), "root from 100 inserts ago known");
        assertTrue(pool.isKnownRoot(pool.merkleRoot()), "current root known");
        assertFalse(pool.isKnownRoot(0));
        assertFalse(pool.isKnownRoot(12345));
    }

    function test_shield_rejects_zero_amount() public {
        bytes memory blob = new bytes(96);
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.ValueTooSmall.selector);
        pool.shield(address(weth), 0, blob);
    }

    function test_shield_rejects_oversized_blob() public {
        bytes memory blob = new bytes(96 + pool.MAX_NOTE_BYTES() + 1);
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.BadNoteBlob.selector);
        pool.shield(address(weth), 1, blob);
    }

    function test_transact_rejects_int256_min_ext_amount() public {
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = type(int256).min;
        vm.expectRevert(ShieldedPool.BadExtAmount.selector);
        pool.transact(_proof(), p);
    }

    function test_transact_rejects_zero_or_self_recipient_with_value() public {
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = -1 ether;
        p.recipient = address(0);
        vm.expectRevert(ShieldedPool.BadRecipient.selector);
        pool.transact(_proof(), p);
        p.recipient = address(pool);
        vm.expectRevert(ShieldedPool.BadRecipient.selector);
        pool.transact(_proof(), p);
    }

    function test_transact_rejects_oversized_ciphertext() public {
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        p.encryptedNotes[0] = new bytes(pool.MAX_NOTE_BYTES() + 1);
        vm.expectRevert(ShieldedPool.BadNoteBlob.selector);
        pool.transact(_proof(), p);
    }

    function test_pool_insert_matches_naive_rebuild_over_forty_shields() public {
        uint256[] memory leaves = new uint256[](40);
        uint256 publicKey = vm.parseJsonUint(vectors, ".keys[2].pk");
        for (uint256 i = 0; i < 40; i++) {
            uint256 blinding = 1000 + i;
            uint256 amount = 1 ether + i;
            bytes memory blob = abi.encodePacked(bytes32(publicKey), bytes32(blinding), bytes32(_net(amount)));
            vm.prank(alice);
            pool.shield(address(weth), amount, blob);
            leaves[i] = hash4.poseidon([publicKey, uint256(uint160(address(weth))), _net(amount), blinding]);
            assertEq(pool.merkleRoot(), _naiveRoot(_prefix(leaves, i + 1)), "root after shield through the pool");
        }
    }

    function _prefix(uint256[] memory xs, uint256 n) internal pure returns (uint256[] memory out) {
        out = new uint256[](n);
        for (uint256 i = 0; i < n; i++) out[i] = xs[i];
    }

    function test_full_tree_transact_reverts_rather_than_destroying_change() public {
        _fund();
        vm.store(address(pool), bytes32(_nextLeafSlot()), bytes32(pool.TREE_CAPACITY()));
        assertEq(pool.nextLeafIndex(), pool.TREE_CAPACITY());

        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = -3 ether;
        p.recipient = address(0xCAFE);
        uint256 rootBefore = pool.merkleRoot();

        vm.expectRevert(ShieldedPool.TreeFull.selector);
        pool.transact(_proof(), p);

        assertFalse(pool.isNullifierSpent(11), "nullifier must not be retired");
        assertEq(weth.balanceOf(address(0xCAFE)), 0, "no payout on a reverted spend");
        assertEq(pool.merkleRoot(), rootBefore, "no state change");
    }

    function test_shield_stops_at_the_ceiling_leaving_room_to_spend() public {
        _fund();
        vm.store(address(pool), bytes32(_nextLeafSlot()), bytes32(pool.SHIELD_CEILING()));

        bytes memory blob = _blob(1 ether);
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.TreeFull.selector);
        pool.shield(address(weth), 1 ether, blob);

        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = -3 ether;
        p.recipient = address(0xCAFE);
        pool.transact(_proof(), p);
        assertTrue(pool.isNullifierSpent(11), "spend must still succeed below capacity");
        assertEq(weth.balanceOf(address(0xCAFE)), _net(3 ether));
    }

    function test_notes_in_one_asset_cannot_withdraw_another() public {
        // `other` is supported and held by the pool, so only the per-token ledger can refuse this.
        other.mint(address(pool), 50 ether);

        _fund();
        bytes memory blob = _blob(4 ether);
        vm.prank(alice);
        pool.shield(address(weth), 4 ether, blob);

        assertEq(pool.shieldedBalance(address(weth)), _net(10 ether) + _net(4 ether), "weth owed is net of fees");
        assertEq(pool.shieldedBalance(address(other)), 0, "the other asset owes nothing");

        ShieldedPool.PublicInputs memory p = _inputs();
        p.token = address(other);
        p.extAmount = -1 ether;
        p.recipient = address(0xCAFE);
        vm.expectRevert(ShieldedPool.PoolUndercollateralised.selector);
        pool.transact(_proof(), p);

        assertEq(other.balanceOf(address(0xCAFE)), 0, "no cross-asset payout");
    }

    function test_withdrawing_an_unsupported_asset_is_refused() public {
        _fund();
        bytes memory blob = _blob(2 ether);
        vm.prank(alice);
        pool.shield(address(weth), 2 ether, blob);

        ShieldedPool.PublicInputs memory p = _inputs();
        p.token = address(new MockWETH());
        p.extAmount = -1 ether;
        p.recipient = address(0xCAFE);
        vm.expectRevert(ShieldedPool.UnsupportedToken.selector);
        pool.transact(_proof(), p);
    }

    function test_shielded_balance_tracks_deposits_and_withdrawals() public {
        _fund();
        bytes memory blob = _blob(6 ether);
        vm.prank(alice);
        pool.shield(address(weth), 6 ether, blob);
        uint256 owed = pool.shieldedBalance(address(weth));
        assertEq(owed, _net(10 ether) + _net(6 ether), "weth owed is net of fees");

        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = -2 ether;
        p.recipient = address(0xCAFE);
        p.fee = 0.1 ether;
        pool.transact(_proof(), p);

        assertEq(pool.shieldedBalance(address(weth)), owed - 2 ether, "only the withdrawal leaves; the fee stays as a note");
        assertLe(pool.shieldedBalance(address(weth)), weth.balanceOf(address(pool)), "never owe more than held");
    }

    function test_private_send_does_not_touch_the_asset_ledger() public {
        _fund();
        bytes memory blob = _blob(3 ether);
        vm.prank(alice);
        pool.shield(address(weth), 3 ether, blob);
        uint256 owedBefore = pool.shieldedBalance(address(weth));

        ShieldedPool.PublicInputs memory p = _inputs();
        p.token = address(0);
        p.extAmount = 0;
        p.fee = 0;
        pool.transact(_proof(), p);

        assertEq(pool.shieldedBalance(address(weth)), owedBefore, "a private send must not change what is owed");
    }

    function test_a_relayed_private_send_publishes_no_asset() public {
        _fund();
        uint256 owedBefore = pool.shieldedBalance(address(weth));

        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = 0;
        p.fee = 0.05 ether;
        p.token = address(0);
        pool.transact(_proof(), p);

        assertEq(pool.shieldedBalance(address(weth)), owedBefore, "a relayed send must not move the ledger");
        assertEq(weth.balanceOf(address(0xB0B)), 0, "relay fee must not reach a public address");
    }

    function test_a_transfer_that_under_delivers_reverts() public {
        MockShortfallToken short = new MockShortfallToken();
        IERC20[] memory assets = new IERC20[](1);
        assets[0] = short;
        ShieldedPool p = new ShieldedPool(assets, hash2, hash4, verifier, treasury);

        short.mint(alice, 100 ether);
        vm.prank(alice);
        short.approve(address(p), type(uint256).max);

        // shield() checks its own delta, so fund the pool and the ledger directly to test the outbound path.
        short.mint(address(p), 50 ether);
        vm.store(
            address(p),
            keccak256(abi.encode(address(short), _shieldedBalanceSlot(p))),
            bytes32(uint256(50 ether))
        );
        assertEq(p.shieldedBalance(address(short)), 50 ether, "ledger not primed: wrong slot");

        ShieldedPool.PublicInputs memory q = _inputs();
        q.token = address(short);
        q.extAmount = -10 ether;
        q.recipient = address(0xCAFE);

        vm.expectRevert(ShieldedPool.TransferShortfall.selector);
        p.transact(_proof(), q);

        assertEq(short.balanceOf(address(0xCAFE)), 0, "no partial payout may stand");
        assertEq(p.shieldedBalance(address(short)), 50 ether, "a reverted withdrawal must not move the ledger");
    }

    function _shieldedBalanceSlot(ShieldedPool p) internal returns (uint256) {
        for (uint256 slot = 0; slot < 80; slot++) {
            bytes32 key = keccak256(abi.encode(address(0xBEEF), slot));
            vm.store(address(p), key, bytes32(uint256(12345)));
            bool hit = p.shieldedBalance(address(0xBEEF)) == 12345;
            vm.store(address(p), key, bytes32(uint256(0)));
            if (hit) return slot;
        }
        revert("shieldedBalance slot not found");
    }

    function test_a_relayed_exit_inserts_the_fee_note() public {
        _fund();
        uint256 before = pool.nextLeafIndex();

        ShieldedPool.PublicInputs memory p = _inputs();
        p.isExit = true;
        p.extAmount = -2 ether;
        p.recipient = address(0xCAFE);
        p.fee = 0.05 ether;
        pool.transact(_proof(), p);

        assertEq(pool.nextLeafIndex(), before + 1, "a relayed exit inserts the fee note and nothing else");
    }

    function test_a_self_submitted_exit_still_inserts_nothing() public {
        _fund();
        uint256 before = pool.nextLeafIndex();

        ShieldedPool.PublicInputs memory p = _inputs();
        p.isExit = true;
        p.extAmount = -2 ether;
        p.recipient = address(0xCAFE);
        p.fee = 0;
        pool.transact(_proof(), p);

        assertEq(pool.nextLeafIndex(), before, "a self-submitted exit must cost no leaves");
    }

    function test_a_full_tree_can_still_be_left_without_a_relay() public {
        _fund();
        vm.store(address(pool), bytes32(_nextLeafSlot()), bytes32(pool.TREE_CAPACITY()));

        ShieldedPool.PublicInputs memory p = _inputs();
        p.isExit = true;
        p.extAmount = -1 ether;
        p.recipient = address(0xCAFE);
        p.fee = 0;
        pool.transact(_proof(), p);
        assertEq(weth.balanceOf(address(0xCAFE)), _net(1 ether), "a full tree must still be leavable");
    }

    function test_a_self_submitted_transact_emits_only_the_two_inserted_leaves() public {
        _fund();
        uint256 before = pool.nextLeafIndex();

        ShieldedPool.PublicInputs memory p = _inputs();
        p.fee = 0;

        vm.recordLogs();
        pool.transact(_proof(), p);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 seen = 0;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != keccak256("Transact(uint256[],uint256[],bytes[])")) continue;
            seen++;
            (, uint256[] memory cms, bytes[] memory notes) =
                abi.decode(logs[i].data, (uint256[], uint256[], bytes[]));
            assertEq(cms.length, 2, "a fee-free transact must publish two commitments");
            assertEq(notes.length, 2, "and two ciphertexts");
            assertEq(cms[0], p.commitments[0], "first inserted leaf");
            assertEq(cms[1], p.commitments[1], "second inserted leaf");
        }
        assertEq(seen, 1, "exactly one Transact event");
        assertEq(pool.nextLeafIndex(), before + 2, "and it inserted exactly two");
    }

    function test_a_relayed_transact_emits_all_three_inserted_leaves() public {
        _fund();
        uint256 before = pool.nextLeafIndex();

        ShieldedPool.PublicInputs memory p = _inputs();
        p.fee = 0.05 ether;

        vm.recordLogs();
        pool.transact(_proof(), p);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != keccak256("Transact(uint256[],uint256[],bytes[])")) continue;
            (, uint256[] memory cms, bytes[] memory notes) =
                abi.decode(logs[i].data, (uint256[], uint256[], bytes[]));
            assertEq(cms.length, 3, "a relayed transact must publish three commitments");
            assertEq(notes.length, 3, "and three ciphertexts");
            assertEq(cms[2], p.commitments[2], "the fee note is the third");
        }
        assertEq(pool.nextLeafIndex(), before + 3, "and it inserted exactly three");
    }

    function test_deposit_floor_scales_with_each_assets_decimals() public {
        MockUSDG usdg = new MockUSDG();
        IERC20[] memory assets = new IERC20[](2);
        assets[0] = weth;
        assets[1] = usdg;
        ShieldedPool multi = new ShieldedPool(assets, hash2, hash4, verifier, treasury);

        assertEq(multi.minShield(address(weth)), 1e12, "18-decimal floor is a millionth of a token");
        assertEq(multi.minShield(address(usdg)), 1, "6-decimal floor is a millionth of a token");

        assertLt(multi.minShield(address(usdg)), 1e12, "USDG floor must not be a million tokens");
    }

    function test_floor_refuses_dust_and_accepts_the_minimum_in_both_assets() public {
        MockUSDG usdg = new MockUSDG();
        IERC20[] memory assets = new IERC20[](2);
        assets[0] = weth;
        assets[1] = usdg;
        ShieldedPool multi = new ShieldedPool(assets, hash2, hash4, verifier, treasury);

        usdg.mint(alice, 1_000_000e6);
        weth.mint(alice, 1_000 ether);
        vm.startPrank(alice);
        usdg.approve(address(multi), type(uint256).max);
        weth.approve(address(multi), type(uint256).max);
        vm.stopPrank();

        uint256 wMin = multi.minShield(address(weth));
        bytes memory tooSmall = abi.encodePacked(bytes32(0), bytes32(0), bytes32(uint256(0)));
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.ValueTooSmall.selector);
        multi.shield(address(weth), wMin - 1, tooSmall);

        uint256 amt = 100e6;
        uint256 net = amt - (amt * multi.FEE_BPS()) / 10_000;
        bytes memory blob = abi.encodePacked(bytes32(0), bytes32(0), bytes32(net));
        vm.prank(alice);
        multi.shield(address(usdg), amt, blob);
        assertEq(multi.shieldedBalance(address(usdg)), net, "a normal USDG deposit must work");
    }

    function test_floor_is_never_zero_for_low_decimal_assets() public {
        MockLowDecimals low = new MockLowDecimals();
        IERC20[] memory assets = new IERC20[](1);
        assets[0] = low;
        ShieldedPool p = new ShieldedPool(assets, hash2, hash4, verifier, treasury);

        assertGt(p.minShield(address(low)), 0, "a 4-decimal asset must not get a zero floor");

        low.mint(alice, 1_000e4);
        vm.prank(alice);
        low.approve(address(p), type(uint256).max);

        bytes memory blob = abi.encodePacked(bytes32(0), bytes32(0), bytes32(uint256(0)));
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.ValueTooSmall.selector);
        p.shield(address(low), 0, blob);
    }

    /// Fuzzed over the offset because even and odd starts take different paths in _insertPair.
    function testFuzz_paired_insert_equals_two_single_inserts(uint8 offset, uint256 a, uint256 b) public {
        a = bound(a, 1, R - 1);
        b = bound(b, 1, R - 1);
        uint256 n = offset % 7;

        TreeHarness paired = new TreeHarness(hash2);
        TreeHarness single = new TreeHarness(hash2);

        for (uint256 i = 0; i < n; i++) {
            uint256 leaf = uint256(keccak256(abi.encode("filler", i))) % R;
            if (leaf == 0) leaf = 1;
            paired.insert(leaf);
            single.insert(leaf);
        }
        assertEq(paired.root(), single.root(), "harnesses diverged before the pair");
        assertEq(paired.next(), single.next(), "offsets diverged");

        paired.insertPair(a, b);
        single.insert(a);
        single.insert(b);

        assertEq(paired.root(), single.root(), "paired insert produced a different root");
        assertEq(paired.next(), single.next(), "paired insert moved the leaf count differently");
    }

    function test_pool_paired_insert_matches_single_insert_harness() public {
        _fund();   // one leaf in the pool, so the pair starts at an odd index
        TreeHarness h = new TreeHarness(hash2);

        uint256 net = _net(10 ether);
        h.insert(hash4.poseidon([0, uint256(uint160(address(weth))), net, 0]));
        assertEq(h.root(), pool.merkleRoot(), "harness does not match the pool after one shield");

        ShieldedPool.PublicInputs memory p = _inputs();
        p.commitments[0] = 12345; p.commitments[1] = 67890; p.commitments[2] = 13579;
        pool.transact(_proof(), p);

        // No relay fee here, so the third note is not inserted.
        h.insert(12345);
        h.insert(67890);
        assertEq(pool.merkleRoot(), h.root(), "pool's paired insert disagrees with two single inserts");
        assertEq(pool.nextLeafIndex(), h.next(), "leaf counts disagree");
    }

    function test_paired_insert_is_cheaper_than_two_singles() public {
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        uint256 before = gasleft();
        pool.transact(_proof(), p);
        uint256 used = before - gasleft();
        emit log_named_uint("transact gas with paired insertion", used);
        assertLt(used, 2_600_000, "three outputs: a pair plus a single");
    }

    /// Mainnet lists 194 stock and ETF tokens plus WETH and USDG, and the allowlist is fixed at
    /// construction, so the whole set must deploy in one transaction.
    function test_deploys_with_the_full_mainnet_asset_set() public {
        uint256 N = 196;
        IERC20[] memory many = new IERC20[](N);
        for (uint256 i = 0; i < N; i++) many[i] = IERC20(address(new MockWETH()));

        uint256 before = gasleft();
        ShieldedPool big = new ShieldedPool(many, hash2, hash4, verifier, treasury);
        uint256 used = before - gasleft();
        emit log_named_uint("constructor gas for 196 assets", used);

        // Arbitrum-style chains allow ~32M per block; stay well inside it.
        assertLt(used, 25_000_000, "constructor too large for one transaction");
        assertTrue(big.isSupported(address(many[0])), "first asset not registered");
        assertTrue(big.isSupported(address(many[N - 1])), "last asset not registered");
        assertEq(big.supportedTokens(N - 1), address(many[N - 1]), "enumeration wrong at the end");
    }

    function test_ledgers_stay_independent_across_many_assets() public {
        uint256 N = 8;
        IERC20[] memory many = new IERC20[](N);
        MockWETH[] memory toks = new MockWETH[](N);
        for (uint256 i = 0; i < N; i++) { toks[i] = new MockWETH(); many[i] = IERC20(address(toks[i])); }
        ShieldedPool multi = new ShieldedPool(many, hash2, hash4, verifier, treasury);

        for (uint256 i = 0; i < N; i++) {
            uint256 amt = (i + 1) * 1 ether;
            toks[i].mint(alice, amt);
            vm.prank(alice);
            toks[i].approve(address(multi), type(uint256).max);
            uint256 net = amt - (amt * multi.FEE_BPS()) / 10_000;
            bytes memory b = abi.encodePacked(bytes32(0), bytes32(0), bytes32(net));
            vm.prank(alice);
            multi.shield(address(toks[i]), amt, b);
        }

        for (uint256 i = 0; i < N; i++) {
            uint256 amt = (i + 1) * 1 ether;
            uint256 net = amt - (amt * multi.FEE_BPS()) / 10_000;
            assertEq(multi.shieldedBalance(address(toks[i])), net, "an asset's ledger is wrong");
            assertLe(
                multi.shieldedBalance(address(toks[i])) + multi.treasuryBalance(address(toks[i])),
                toks[i].balanceOf(address(multi)),
                "an asset owes more than the pool holds of it"
            );
        }

        ShieldedPool.PublicInputs memory p = _inputs();
        p.token = address(toks[0]);
        p.extAmount = -5 ether;      // far more than asset 0's 1 ether
        p.recipient = address(0xCAFE);
        vm.expectRevert(ShieldedPool.PoolUndercollateralised.selector);
        multi.transact(_proof(), p);
    }

    function test_owed_never_exceeds_held() public {
        _fund();
        bytes memory blob = _blob(7 ether);
        vm.prank(alice);
        pool.shield(address(weth), 7 ether, blob);

        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = -2 ether;
        p.recipient = address(0xCAFE);
        p.fee = 0.05 ether;
        pool.transact(_proof(), p);

        assertLe(
            pool.shieldedBalance(address(weth)) + pool.treasuryBalance(address(weth)),
            weth.balanceOf(address(pool)),
            "pool owes more than it holds"
        );
    }

    function test_fee_is_taken_on_the_way_in() public {
        uint256 gross = 5 ether;
        uint256 expectedFee = (gross * pool.FEE_BPS()) / 10_000;

        bytes memory blob = _blob(gross);
        vm.prank(alice);
        pool.shield(address(weth), gross, blob);

        assertEq(pool.treasuryBalance(address(weth)), expectedFee, "shield fee not collected");
        assertEq(pool.shieldedBalance(address(weth)), gross - expectedFee, "note must be worth the net");
    }

    function test_fee_is_taken_on_the_way_out_but_not_from_the_broadcaster() public {
        _fund();
        uint256 feeBefore = pool.treasuryBalance(address(weth));

        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = -4 ether;
        p.recipient = address(0xCAFE);
        p.fee = 0.2 ether;
        pool.transact(_proof(), p);

        assertEq(
            pool.treasuryBalance(address(weth)) - feeBefore,
            (4 ether * pool.FEE_BPS()) / 10_000,
            "withdrawal fee wrong"
        );
        assertEq(weth.balanceOf(address(0xB0B)), 0, "broadcaster fee must not leave the pool");
    }

    function test_private_send_pays_no_protocol_fee() public {
        _fund();
        uint256 feeBefore = pool.treasuryBalance(address(weth));

        ShieldedPool.PublicInputs memory p = _inputs();
        p.token = address(0);
        p.extAmount = 0;
        p.fee = 0;
        pool.transact(_proof(), p);

        assertEq(pool.treasuryBalance(address(weth)), feeBefore, "a private send must be free");
    }

    function test_a_withdrawal_too_small_to_charge_still_pays() public {
        _fund();
        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = -100;
        p.recipient = address(0xDEAD);
        pool.transact(_proof(), p);
        assertEq(weth.balanceOf(address(0xDEAD)), 100, "dust withdrawal must still pay out");
    }

    function test_fees_can_be_collected_to_the_treasury_and_only_there() public {
        _fund();
        uint256 owed = pool.treasuryBalance(address(weth));
        assertGt(owed, 0, "nothing to collect");

        // Anyone may call it; fees only ever go to the immutable treasury.
        vm.prank(address(0xBEEF));
        pool.collectFees(address(weth));

        assertEq(weth.balanceOf(treasury), owed, "treasury not paid");
        assertEq(pool.treasuryBalance(address(weth)), 0, "ledger not cleared");

        pool.collectFees(address(weth));
        assertEq(weth.balanceOf(treasury), owed, "second collect must be a no-op");
    }

    function test_collecting_fees_cannot_touch_note_balances() public {
        _fund();
        uint256 owedToNotes = pool.shieldedBalance(address(weth));
        pool.collectFees(address(weth));
        assertEq(pool.shieldedBalance(address(weth)), owedToNotes, "note balances must be untouched");
        assertGe(weth.balanceOf(address(pool)), owedToNotes, "pool must still cover its notes");
    }

    function test_exit_succeeds_when_the_tree_is_completely_full() public {
        _fund();
        vm.store(address(pool), bytes32(_nextLeafSlot()), bytes32(pool.TREE_CAPACITY()));

        ShieldedPool.PublicInputs memory p = _inputs();
        p.isExit = true;
        p.extAmount = -3 ether;
        p.recipient = address(0xCAFE);

        uint256 leafBefore = pool.nextLeafIndex();
        pool.transact(_proof(), p);

        assertEq(pool.nextLeafIndex(), leafBefore, "an exit must not insert");
        assertEq(weth.balanceOf(address(0xCAFE)), _net(3 ether), "an exit pays out net of the protocol fee");
        assertTrue(pool.isNullifierSpent(11), "an exit must retire its inputs");
    }

    function test_full_tree_blocks_inserting_transact_but_not_exit() public {
        _fund();
        vm.store(address(pool), bytes32(_nextLeafSlot()), bytes32(pool.TREE_CAPACITY()));

        ShieldedPool.PublicInputs memory p = _inputs();
        p.extAmount = -1 ether;
        p.recipient = address(0xCAFE);
        vm.expectRevert(ShieldedPool.TreeFull.selector);
        pool.transact(_proof(), p);
    }

    function test_exit_and_normal_transact_differ_only_in_insertion() public {
        _fund();

        ShieldedPool.PublicInputs memory p = _inputs();
        p.isExit = true;
        p.extAmount = -1 ether;
        p.recipient = address(0xCAFE);
        uint256 before = pool.nextLeafIndex();
        pool.transact(_proof(), p);
        assertEq(pool.nextLeafIndex(), before, "exit must insert nothing");

        ShieldedPool.PublicInputs memory q = _inputs();
        q.nullifiers[0] = 55; q.nullifiers[1] = 66;
        q.commitments[0] = 77; q.commitments[1] = 88;
        q.extAmount = -1 ether;
        q.recipient = address(0xCAFE);
        pool.transact(_proof(), q);
        assertEq(pool.nextLeafIndex(), before + 2, "no relay fee: the empty fee note is not inserted");
    }

    function test_reserve_can_drain_every_note_the_ceiling_allows() public view {
        uint256 capacity = pool.TREE_CAPACITY();
        uint256 ceiling = pool.SHIELD_CEILING();

        // Worst case: every leaf below the ceiling is a distinct unspent note.
        uint256 outstanding = ceiling;

        uint256 reserve = capacity - ceiling;
        // forge-lint: disable-next-line(divide-before-multiply)
        uint256 clearable = (reserve / 2) * 2; // (reserve / N_OUTS) * N_INS

        assertGe(clearable, outstanding, "reserve cannot clear every outstanding note");
    }

    function test_shield_rejects_below_minimum() public {
        _fund();
        bytes memory blob = _blob(1);
        vm.prank(alice);
        vm.expectRevert(ShieldedPool.ValueTooSmall.selector);
        pool.shield(address(weth), 1, blob);

        uint256 min = pool.minShield(address(weth));
        bytes memory ok = abi.encodePacked(bytes32(0), bytes32(0), bytes32(_net(min)));
        uint256 before = pool.nextLeafIndex();
        vm.prank(alice);
        pool.shield(address(weth), min, ok);
        assertEq(pool.nextLeafIndex(), before + 1, "the minimum itself is accepted");
    }

    function testFuzz_incremental_root_equals_naive_rebuild(uint256[6] memory raw) public {
        TreeHarness t = new TreeHarness(hash2);
        uint256[] memory leaves = new uint256[](6);
        for (uint256 i = 0; i < 6; i++) {
            leaves[i] = raw[i] % R;
            t.insert(leaves[i]);
        }
        assertEq(t.root(), _naiveRoot(leaves), "incremental vs naive");
    }

    function _naiveRoot(uint256[] memory leaves) internal view returns (uint256) {
        uint256 depth = pool.TREE_DEPTH();
        uint256[] memory level = leaves;
        for (uint256 d = 0; d < depth; d++) {
            uint256 len = (level.length + 1) / 2;
            uint256[] memory next = new uint256[](len);
            for (uint256 i = 0; i < len; i++) {
                uint256 left = level[2 * i];
                uint256 right = 2 * i + 1 < level.length ? level[2 * i + 1] : pool.zeroAt(d);
                next[i] = hash2.poseidon([left, right]);
            }
            level = next;
        }
        return level[0];
    }
}

/// A standalone copy of the pool's insert algorithm, so the tree is tested apart from the pool.
contract TreeHarness {
    uint256 constant DEPTH = 24; // must track ShieldedPool.TREE_DEPTH
    IPoseidonT3 immutable H;
    uint256[DEPTH] filled;
    uint256[DEPTH + 1] zeros;
    uint256 public root;
    uint256 public next;

    constructor(IPoseidonT3 h) {
        H = h;
        uint256 z = 0;
        for (uint256 i = 0; i < DEPTH; i++) { filled[i] = z; zeros[i] = z; z = h.poseidon([z, z]); }
        zeros[DEPTH] = z;
        root = z;
    }

    function insert(uint256 leaf) public {
        uint256 cur = leaf;
        uint256 idx = next;
        for (uint256 l = 0; l < DEPTH; l++) {
            if (idx & 1 == 0) { filled[l] = cur; cur = H.poseidon([cur, zeros[l]]); }
            else { cur = H.poseidon([filled[l], cur]); }
            idx >>= 1;
        }
        root = cur;
        next++;
    }

    /// Mirrors ShieldedPool._insertPair.
    function insertPair(uint256 a, uint256 b) external {
        uint256 first = next;
        if (first & 1 == 1) { insert(a); insert(b); return; }

        filled[0] = a;
        uint256 cur = H.poseidon([a, b]);
        uint256 idx = first >> 1;
        for (uint256 l = 1; l < DEPTH; l++) {
            if (idx & 1 == 0) { filled[l] = cur; cur = H.poseidon([cur, zeros[l]]); }
            else { cur = H.poseidon([filled[l], cur]); }
            idx >>= 1;
        }
        root = cur;
        next = first + 2;
    }
}
