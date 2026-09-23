pragma circom 2.1.6;

// Proves a transaction spends notes in the tree with correct nullifiers and conserves value into new notes.
//   publicKey  = Poseidon([privateKey])
//   commitment = Poseidon([publicKey, token, value, blinding])
//   nullifier  = Poseidon([privateKey, leafIndex])
//   merkleNode = Poseidon([left, right]), zero leaf 0, depth 24

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

template Keypair() {
    signal input privateKey;
    signal output publicKey;
    component h = Poseidon(1);
    h.inputs[0] <== privateKey;
    publicKey <== h.out;
}

template Commitment() {
    signal input publicKey;
    signal input token;
    signal input value;
    signal input blinding;
    signal output out;
    component h = Poseidon(4);
    h.inputs[0] <== publicKey;
    h.inputs[1] <== token;
    h.inputs[2] <== value;
    h.inputs[3] <== blinding;
    out <== h.out;
}

template Nullifier() {
    signal input privateKey;
    signal input leafIndex;
    signal output out;
    component h = Poseidon(2);
    h.inputs[0] <== privateKey;
    h.inputs[1] <== leafIndex;
    out <== h.out;
}

// Recomputes the root from a leaf, its index bits (LSB first) and siblings. The nullifier binds
// only (privateKey, leafIndex), so this check is what stops one note yielding two nullifiers.
template MerkleProof(levels) {
    signal input leaf;
    signal input pathIndices[levels];
    signal input pathElements[levels];
    signal output root;

    component hashers[levels];
    signal cur[levels + 1];
    cur[0] <== leaf;
    for (var i = 0; i < levels; i++) {
        // Each index must be a bit. Redundant when fed from Num2Bits, kept
        // so the template is safe on its own.
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        hashers[i] = Poseidon(2);
        // bit = 0: (cur, sibling). bit = 1: (sibling, cur). One multiplication each.
        hashers[i].inputs[0] <== cur[i] + pathIndices[i] * (pathElements[i] - cur[i]);
        hashers[i].inputs[1] <== pathElements[i] + pathIndices[i] * (cur[i] - pathElements[i]);
        cur[i + 1] <== hashers[i].out;
    }
    root <== cur[levels];
}

template Transaction(levels, nIns, nOuts, valueBits) {
    // Public inputs, except token
    signal input root;
    signal input publicAmount;      // 0, or value leaving the pool as r - x
    signal input boundParamsHash;   // keccak(abi.encode(extAmount, recipient, broadcaster, fee, ciphertexts, chainId, pool)) mod r

    // Private. Every input and output note commits to this one token, and a private send
    // never publishes it, so observers cannot tell which asset moved.
    signal input token;

    // The ERC-20 the contract transfers. Bound to token only when publicAmount != 0;
    // on a private send it is unconstrained and carries no information.
    signal input publicToken;

    // When 1, outputs 0 and 1 must be zero-value and the contract does not insert them,
    // so a full tree can still be exited.
    signal input isExit;

    // 1 if the last output is a relay fee note; tells the contract whether to insert it.
    // The fee amount is public calldata; the relay checks its note by decrypting it.
    signal input hasFee;
    signal input inputNullifier[nIns];
    signal input outputCommitment[nOuts];

    // Private inputs
    signal input inValue[nIns];
    signal input inPrivateKey[nIns];
    signal input inBlinding[nIns];
    signal input inLeafIndex[nIns];
    signal input inPathElements[nIns][levels];

    // Outputs in order: recipient, change, broadcaster fee note.
    signal input outValue[nOuts];
    signal input outPublicKey[nOuts];
    signal input outBlinding[nOuts];

    component inKeypair[nIns];
    component inCommitment[nIns];
    component inNullifier[nIns];
    component inIndexBits[nIns];
    component inTree[nIns];
    component inRootCheck[nIns];
    component inValueBits[nIns];

    var sumIns = 0;
    for (var i = 0; i < nIns; i++) {
        inKeypair[i] = Keypair();
        inKeypair[i].privateKey <== inPrivateKey[i];

        inCommitment[i] = Commitment();
        inCommitment[i].publicKey <== inKeypair[i].publicKey;
        inCommitment[i].token <== token;
        inCommitment[i].value <== inValue[i];
        inCommitment[i].blinding <== inBlinding[i];

        // Filler inputs also publish a nullifier, retired with no inclusion proof. A filler's key must be
        // fresh randomness, never the spending key, or the wallet's own note at that index is burned.
        inNullifier[i] = Nullifier();
        inNullifier[i].privateKey <== inPrivateKey[i];
        inNullifier[i].leafIndex <== inLeafIndex[i];
        inNullifier[i].out === inputNullifier[i];

        // Decomposing the index proves it is below 2^levels, and supplies
        // the path bits from the same value the nullifier was built from.
        inIndexBits[i] = Num2Bits(levels);
        inIndexBits[i].in <== inLeafIndex[i];

        inTree[i] = MerkleProof(levels);
        inTree[i].leaf <== inCommitment[i].out;
        for (var j = 0; j < levels; j++) {
            inTree[i].pathIndices[j] <== inIndexBits[i].out[j];
            inTree[i].pathElements[j] <== inPathElements[i][j];
        }

        // Inclusion is enforced whenever the input carries value. Skipping it for a zero-value
        // filler is safe only because the filler adds nothing to the sum.
        inRootCheck[i] = ForceEqualIfEnabled();
        inRootCheck[i].in[0] <== root;
        inRootCheck[i].in[1] <== inTree[i].root;
        inRootCheck[i].enabled <== inValue[i];

        // Inputs are range-checked as well as outputs, so the value sums cannot wrap the field.
        inValueBits[i] = Num2Bits(valueBits);
        inValueBits[i].in <== inValue[i];

        sumIns += inValue[i];
    }

    component outCommitment[nOuts];
    component outValueBits[nOuts];
    var sumOuts = 0;
    for (var i = 0; i < nOuts; i++) {
        outCommitment[i] = Commitment();
        outCommitment[i].publicKey <== outPublicKey[i];
        outCommitment[i].token <== token;
        outCommitment[i].value <== outValue[i];
        outCommitment[i].blinding <== outBlinding[i];
        outCommitment[i].out === outputCommitment[i];

        outValueBits[i] = Num2Bits(valueBits);
        outValueBits[i].in <== outValue[i];

        sumOuts += outValue[i];
    }

    // The on-chain nullifier set is written only after verification, so
    // without this a note could be spent twice inside one transaction.
    component sameNullifier[nIns * (nIns - 1) / 2];
    var k = 0;
    for (var i = 0; i < nIns - 1; i++) {
        for (var j = i + 1; j < nIns; j++) {
            sameNullifier[k] = IsEqual();
            sameNullifier[k].in[0] <== inputNullifier[i];
            sameNullifier[k].in[1] <== inputNullifier[j];
            sameNullifier[k].out === 0;
            k++;
        }
    }

    // publicAmount must be 0 or r - L with L < 2^(valueBits + 1): a transact can withdraw value but
    // never deposit it, and the sum below cannot wrap the field whatever the contract checks.
    component leavingBits = Num2Bits(valueBits + 1);
    leavingBits.in <== -publicAmount;
    sumIns + publicAmount === sumOuts;

    // hasFee is a bit; when it is 0 the fee output must be zero-value, because the
    // contract does not insert it.
    hasFee * (1 - hasFee) === 0;
    (1 - hasFee) * outValue[nOuts - 1] === 0;

    // Every note commits to the same token, so mixing assets is unprovable. publicToken is bound to
    // token only when value leaves the pool; binding it on a private send would reveal the asset.
    component amountIsZero = IsZero();
    amountIsZero.in <== publicAmount;
    signal isPublic;
    isPublic <== 1 - amountIsZero.out;
    isPublic * (publicToken - token) === 0;

    // At least one input must carry value. Otherwise a proof needing no note or deposit could insert
    // nOuts leaves for gas alone, filling the tree and stranding every unspent note.
    component inIsZero[nIns];
    var nonZeroInputs = 0;
    for (var i = 0; i < nIns; i++) {
        inIsZero[i] = IsZero();
        inIsZero[i].in <== inValue[i];
        nonZeroInputs += 1 - inIsZero[i].out;
    }
    // nonZeroInputs is in [0, nIns]. Reject only the all-zero case.
    component noInputHasValue = IsZero();
    noInputHasValue.in <== nonZeroInputs;
    noInputHasValue.out === 0;

    // isExit is a bit. When set, outputs 0 and 1 must be zero-value, because the contract
    // skips inserting them.
    isExit * (1 - isExit) === 0;
    isExit * outValue[0] === 0;
    isExit * outValue[1] === 0;

    // Do not remove: boundParamsHash appears in no other constraint, and without one the proof
    // does not bind it, so recipient and fee could be altered.
    signal boundParamsSquare;
    boundParamsSquare <== boundParamsHash * boundParamsHash;
}

component main {public [root, publicAmount, boundParamsHash, publicToken, isExit, hasFee, inputNullifier, outputCommitment]} =
    Transaction(24, 2, 3, 120);
