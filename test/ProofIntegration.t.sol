// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ShieldedPool, IPoseidonT3, IPoseidonT5, ITransactionVerifier} from "../contracts/ShieldedPool.sol";
import {Groth16Verifier} from "../contracts/TransactionVerifier.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockWETH2 is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

library HasherDeployer2 {
    function deploy(bytes memory creationCode) internal returns (address addr) {
        assembly { addr := create(0, add(creationCode, 0x20), mload(creationCode)) }
        require(addr != address(0), "hasher deploy failed");
    }
}

/// Real circuit, real Groth16 verifier, and real proofs from the TypeScript prover via FFI.
contract ProofIntegrationTest is Test {
    MockWETH2 weth;
    IPoseidonT3 hash2;
    IPoseidonT5 hash4;
    ShieldedPool pool;
    address treasury = address(0x7EA5);
    string vectors;

    address alice = address(0xA11CE);
    address recipient = address(0xCAFE);
    address broadcaster = address(0xB0B);

    uint256 constant SPEND_KEY = 1;
    uint256 pk1;
    uint256 pk2;

    uint256 constant V_A = 5 ether;
    uint256 constant V_B = 3 ether;
    uint256 constant BL_A = 111;
    uint256 constant BL_B = 222;

    function setUp() public {
        hash2 = IPoseidonT3(HasherDeployer2.deploy(vm.parseBytes(vm.readFile("build/PoseidonT3.bin"))));
        hash4 = IPoseidonT5(HasherDeployer2.deploy(vm.parseBytes(vm.readFile("build/PoseidonT5.bin"))));
        weth = new MockWETH2();
        ITransactionVerifier verifier = ITransactionVerifier(address(new Groth16Verifier()));
        IERC20[] memory assets = new IERC20[](1);
        assets[0] = weth;
        pool = new ShieldedPool(assets, hash2, hash4, verifier, treasury);
        vectors = vm.readFile("vectors.json");
        pk1 = vm.parseJsonUint(vectors, ".keys[0].pk");
        pk2 = vm.parseJsonUint(vectors, ".keys[1].pk");

        weth.mint(alice, 100 ether);
        vm.prank(alice);
        weth.approve(address(pool), type(uint256).max);
    }

    /// Shields a note worth exactly `value`, grossing up the deposit to cover the protocol fee.
    function _shield(uint256 publicKey, uint256 value, uint256 blinding) internal returns (uint256 commitment) {
        uint256 bps = pool.FEE_BPS();
        uint256 gross = (value * 10_000) / (10_000 - bps);
        while (gross - (gross * bps) / 10_000 < value) gross++;
        require(gross - (gross * bps) / 10_000 == value, "cannot gross up to an exact note value");

        bytes memory blob = abi.encodePacked(bytes32(publicKey), bytes32(blinding), bytes32(value));
        vm.prank(alice);
        pool.shield(address(weth), gross, blob);
        commitment = hash4.poseidon([publicKey, uint256(uint160(address(weth))), value, blinding]);
    }

    struct Proved {
        bytes proof;
        uint256 root;
        uint256 boundParamsHash;
        uint256[2] nullifiers;
        uint256[3] commitments;
        uint256 newRoot;
    }

    function _prove(
        uint256[] memory leaves,
        int256 extAmount,
        uint256 fee,
        bytes[] memory encryptedNotes,
        uint256 outValue0,
        uint256 outValue1
    ) internal returns (Proved memory p) {
        string memory json = string.concat(
            '{"spendingKey":"', vm.toString(SPEND_KEY),
            '","token":"', vm.toString(uint256(uint160(address(weth)))),
            '","leaves":[', _quotedList(leaves), '],'
        );
        json = string.concat(json,
            '"inputs":[{"value":"', vm.toString(V_A), '","blinding":"', vm.toString(BL_A), '","leafIndex":0},',
            '{"value":"', vm.toString(V_B), '","blinding":"', vm.toString(BL_B), '","leafIndex":1}],'
        );
        json = string.concat(json,
            '"outputs":[{"publicKey":"', vm.toString(pk2), '","value":"', vm.toString(outValue0), '","blinding":"333"},',
            '{"publicKey":"', vm.toString(pk1), '","value":"', vm.toString(outValue1), '","blinding":"444"},',
            // The relay fee, paid inside the pool as the third note.
            '{"publicKey":"', vm.toString(pk1), '","value":"', vm.toString(fee), '","blinding":"555"}],'
        );
        json = string.concat(json,
            '"extAmount":"', vm.toString(extAmount),
            '","recipient":"', vm.toString(recipient),
            '","broadcaster":"', vm.toString(broadcaster),
            '","fee":"', vm.toString(fee), '",'
        );
        json = string.concat(json,
            '"encryptedNotes":["', vm.toString(encryptedNotes[0]), '","', vm.toString(encryptedNotes[1]),
            '","', vm.toString(encryptedNotes[2]), '"],',
            '"chainId":"', vm.toString(block.chainid),
            '","pool":"', vm.toString(address(pool)), '"}'
        );
        string[] memory cmd = new string[](3);
        cmd[0] = "node";
        cmd[1] = "client/scripts/prove-ffi.ts";
        cmd[2] = json;
        bytes memory out = vm.ffi(cmd);
        (p.proof, p.root, p.boundParamsHash, p.nullifiers, p.commitments, p.newRoot) =
            abi.decode(out, (bytes, uint256, uint256, uint256[2], uint256[3], uint256));
    }

    function _quotedList(uint256[] memory xs) internal view returns (string memory s) {
        for (uint256 i = 0; i < xs.length; i++) {
            s = string.concat(s, i == 0 ? "" : ",", '"', vm.toString(xs[i]), '"');
        }
    }

    function _inputs(Proved memory p, int256 extAmount, uint256 fee, bytes[] memory notes)
        internal view returns (ShieldedPool.PublicInputs memory q)
    {
        q.root = p.root;
        q.nullifiers = new uint256[](2);
        q.nullifiers[0] = p.nullifiers[0]; q.nullifiers[1] = p.nullifiers[1];
        q.commitments = new uint256[](3);
        q.commitments[0] = p.commitments[0]; q.commitments[1] = p.commitments[1];
        q.commitments[2] = p.commitments[2];
        q.extAmount = extAmount;
        q.recipient = recipient;
        q.broadcaster = broadcaster;
        q.fee = fee;
        q.encryptedNotes = notes;
        // Zero when nothing leaves the pool, matching the publicToken the prover sets.
        q.token = (extAmount == 0 && fee == 0) ? address(0) : address(weth);
    }

    /// Shield twice, then one proof that sends 6 to pk2, keeps 0.95 as change,
    /// withdraws 1 to a public address and pays the broadcaster 0.05.
    function test_real_proof_send_and_unshield() public {
        uint256[] memory leaves = new uint256[](2);
        leaves[0] = _shield(pk1, V_A, BL_A);
        leaves[1] = _shield(pk1, V_B, BL_B);
        assertEq(pool.nextLeafIndex(), 2);

        bytes[] memory notes = new bytes[](3);
        notes[0] = hex"aa01"; notes[1] = hex"bb02"; notes[2] = hex"cc03";
        int256 extAmount = -1 ether;
        uint256 fee = 0.05 ether;
        Proved memory p = _prove(leaves, extAmount, fee, notes, 6 ether, 0.95 ether);

        assertEq(p.root, pool.merkleRoot(), "prover and contract agree on the root before");

        pool.transact(p.proof, _inputs(p, extAmount, fee, notes));

        assertTrue(pool.isNullifierSpent(p.nullifiers[0]));
        assertTrue(pool.isNullifierSpent(p.nullifiers[1]));
        assertEq(pool.nextLeafIndex(), 5, "2 shields + 3 outputs");
        assertEq(pool.merkleRoot(), p.newRoot, "prover and contract agree on the root after");
        assertEq(weth.balanceOf(recipient), 1 ether - (1 ether * pool.FEE_BPS()) / 10_000);
        assertEq(weth.balanceOf(broadcaster), 0, "relay fee must stay inside the pool");
        assertGe(
            weth.balanceOf(address(pool)),
            pool.shieldedBalance(address(weth)) + pool.treasuryBalance(address(weth)),
            "pool must cover what it owes"
        );
    }

    /// Changing a bound parameter after proving changes the bound-params hash, so the proof fails.
    function test_real_proof_tampered_recipient_rejected() public {
        uint256[] memory leaves = new uint256[](2);
        leaves[0] = _shield(pk1, V_A, BL_A);
        leaves[1] = _shield(pk1, V_B, BL_B);
        bytes[] memory notes = new bytes[](3);
        notes[0] = hex"aa01"; notes[1] = hex"bb02"; notes[2] = hex"cc03";
        Proved memory p = _prove(leaves, -1 ether, 0.05 ether, notes, 6 ether, 0.95 ether);

        ShieldedPool.PublicInputs memory q = _inputs(p, -1 ether, 0.05 ether, notes);
        q.recipient = address(0xEE11);
        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        pool.transact(p.proof, q);

        q = _inputs(p, -1 ether, 0.05 ether, notes);
        q.fee = 0.5 ether; // and a larger fee, with extAmount adjusted to keep the sum
        q.extAmount = -0.55 ether;
        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        pool.transact(p.proof, q);

        q = _inputs(p, -1 ether, 0.05 ether, notes);
        q.encryptedNotes[0] = hex"deadbeef";
        vm.expectRevert(ShieldedPool.InvalidProof.selector);
        pool.transact(p.proof, q);
    }

    function test_real_proof_replay_rejected() public {
        uint256[] memory leaves = new uint256[](2);
        leaves[0] = _shield(pk1, V_A, BL_A);
        leaves[1] = _shield(pk1, V_B, BL_B);
        bytes[] memory notes = new bytes[](3);
        notes[0] = hex"aa01"; notes[1] = hex"bb02"; notes[2] = hex"cc03";
        Proved memory p = _prove(leaves, 0, 0, notes, 6 ether, 2 ether);

        pool.transact(p.proof, _inputs(p, 0, 0, notes));
        vm.expectRevert(ShieldedPool.NullifierAlreadySpent.selector);
        pool.transact(p.proof, _inputs(p, 0, 0, notes));
    }

    function test_real_proof_malformed_rejected() public {
        uint256[] memory leaves = new uint256[](2);
        leaves[0] = _shield(pk1, V_A, BL_A);
        leaves[1] = _shield(pk1, V_B, BL_B);
        bytes[] memory notes = new bytes[](3);
        notes[0] = hex"aa01"; notes[1] = hex"bb02"; notes[2] = hex"cc03";
        Proved memory p = _prove(leaves, 0, 0, notes, 6 ether, 2 ether);

        bytes memory bad = p.proof;
        bad[5] ^= 0x01;
        vm.expectRevert();
        pool.transact(bad, _inputs(p, 0, 0, notes));
    }
}
