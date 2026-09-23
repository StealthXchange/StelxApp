import * as snarkjs from "snarkjs";
import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { FIELD_SIZE, type Field } from "./field.ts";
import { commitmentOf, nullifierOf, publicKeyOf, MAX_VALUE } from "./note.ts";
import { MerkleTree, TREE_DEPTH } from "./tree.ts";

export const N_INS = 2;
export const N_OUTS = 3;

export interface InputNote {
  value: bigint;
  blinding: Field;
  leafIndex: number;
}

export interface OutputNote {
  publicKey: Field;
  value: bigint;
  blinding: Field;
}

export interface BoundParams {
  extAmount: bigint;      // <= 0
  recipient: Hex;
  broadcaster: Hex;
  fee: bigint;
  /** One per output note; hashed into boundParamsHash, so the count must match the contract's. */
  encryptedNotes: Hex[];
  chainId: bigint;
  pool: Hex;
}

export interface TransactionRequest {
  spendingKey: Field;
  token: Field;
  leaves: Field[];         // every commitment in the tree, in order
  inputs: InputNote[];     // 1 or 2 real notes; the rest are fillers
  outputs: OutputNote[];   // exactly N_OUTS; outputs[2] is the broadcaster fee note
  bound: BoundParams;
  /** Full withdrawal: outputs[0] and outputs[1] are proved zero; only a paid fee note is inserted. */
  isExit?: boolean;
}

export interface BuiltInputs {
  input: Record<string, unknown>;
  root: Field;
  publicAmount: Field;
  boundParamsHash: Field;
  /** 0 on a private send; the asset address as a field when value leaves. */
  publicToken: Field;
  isExit: boolean;
  nullifiers: [Field, Field];
  commitments: [Field, Field, Field];
  newRoot: Field;                 // root once mined: +2 leaves, +1 if a relay is paid; an exit adds only the fee note
}

export interface ProvedTransaction extends Omit<BuiltInputs, "input"> {
  proof: Hex;                     // abi.encode(a, b, c)
}

/** `wasm` and `zkey` may be a path (Node), a URL (browser) or raw bytes. */
export interface ProvingArtifacts {
  wasm: string | Uint8Array;
  zkey: string | Uint8Array;
  verificationKey: object;
}

/** keccak256(abi.encode(...)) mod FIELD_SIZE; types and order must match the contract exactly. */
export function boundParamsHash(b: BoundParams): Field {
  const encoded = encodeAbiParameters(
    [
      { type: "int256" }, { type: "address" }, { type: "address" }, { type: "uint256" },
      { type: "bytes[]" }, { type: "uint256" }, { type: "address" },
    ],
    [b.extAmount, b.recipient, b.broadcaster, b.fee, b.encryptedNotes, b.chainId, b.pool],
  );
  return BigInt(keccak256(encoded)) % FIELD_SIZE;
}

function randomField(): Field {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  let x = 0n;
  for (const v of bytes) x = (x << 8n) | BigInt(v);
  return x % FIELD_SIZE;
}

/** Everything up to the proof itself, so inputs can be inspected or fed to the CLI. */
export async function buildInputs(req: TransactionRequest): Promise<BuiltInputs> {
  if (req.outputs.length !== N_OUTS) throw new Error(`exactly ${N_OUTS} outputs`);
  if (req.inputs.length < 1 || req.inputs.length > N_INS) throw new Error(`1 to ${N_INS} inputs`);
  if (req.bound.extAmount > 0n) throw new Error("extAmount must be <= 0; deposits go through shield()");

  const tree = await MerkleTree.create(req.leaves);
  const root = tree.root;
  const publicKey = await publicKeyOf(req.spendingKey);

  // Real inputs, then zero-value fillers, which skip the in-circuit Merkle check.
  const inValue: bigint[] = [];
  const inPrivateKey: Field[] = [];
  const inBlinding: Field[] = [];
  const inLeafIndex: number[] = [];
  const inPathElements: Field[][] = [];
  const nullifiers: Field[] = [];
  let sumIns = 0n;

  for (const n of req.inputs) {
    const c = await commitmentOf({ publicKey, token: req.token, value: n.value, blinding: n.blinding });
    if (tree.leaf(n.leafIndex) !== c) throw new Error(`input note is not at leaf ${n.leafIndex}`);
    const p = tree.path(n.leafIndex);
    inValue.push(n.value);
    inPrivateKey.push(req.spendingKey);
    inBlinding.push(n.blinding);
    inLeafIndex.push(n.leafIndex);
    inPathElements.push(p.elements);
    nullifiers.push(await nullifierOf(req.spendingKey, n.leafIndex));
    sumIns += n.value;
  }
  while (inValue.length < N_INS) {
    // A filler's nullifier is retired without an inclusion proof, so its key must be fresh:
    // the spending key would burn the wallet's note at leaf 0.
    let k = randomField();
    while (k === req.spendingKey || k === 0n || inPrivateKey.includes(k)) k = randomField();
    inValue.push(0n);
    inPrivateKey.push(k);
    inBlinding.push(randomField());
    inLeafIndex.push(0);
    inPathElements.push(Array.from({ length: TREE_DEPTH }, () => 0n));
    nullifiers.push(await nullifierOf(k, 0));
  }

  const commitments: Field[] = [];
  let sumOuts = 0n;
  for (const o of req.outputs) {
    if (o.value < 0n || o.value > MAX_VALUE) throw new Error("output value out of range");
    commitments.push(await commitmentOf({ publicKey: o.publicKey, token: req.token, value: o.value, blinding: o.blinding }));
    sumOuts += o.value;
  }

  // The fee is an output note, already in sumOuts; only extAmount leaves the pool.
  const leaving = -req.bound.extAmount;
  if (sumIns !== sumOuts + leaving) {
    throw new Error(`value not conserved: in ${sumIns}, out ${sumOuts}, leaving ${leaving}`);
  }
  const publicAmount = leaving === 0n ? 0n : FIELD_SIZE - leaving;
  const bph = boundParamsHash(req.bound);

  // On an exit the circuit forces outValue[0] and outValue[1] to zero, not outValue[2]:
  // the fee slot pays the relay.
  const isExit = req.isExit === true;
  if (isExit && req.outputs.slice(0, 2).some((o) => o.value !== 0n)) {
    throw new Error("an exit must have both value outputs zero; spend the change first");
  }

  const input = {
    root: root.toString(),
    publicAmount: publicAmount.toString(),
    boundParamsHash: bph.toString(),
    // Private: the asset every note in this transaction is denominated in.
    token: req.token.toString(),
    // Public: zero on a private send so the asset is not revealed; the circuit
    // binds it to `token` only when value leaves the pool.
    publicToken: leaving === 0n ? "0" : req.token.toString(),
    isExit: isExit ? "1" : "0",
    // When 0, the circuit forces the fee slot empty.
    hasFee: req.bound.fee > 0n ? "1" : "0",
    inputNullifier: nullifiers.map(String),
    outputCommitment: commitments.map(String),
    inValue: inValue.map(String),
    inPrivateKey: inPrivateKey.map(String),
    inBlinding: inBlinding.map(String),
    inLeafIndex: inLeafIndex.map(String),
    inPathElements: inPathElements.map((row) => row.map(String)),
    outValue: req.outputs.map((o) => o.value.toString()),
    outPublicKey: req.outputs.map((o) => o.publicKey.toString()),
    outBlinding: req.outputs.map((o) => o.blinding.toString()),
  };

  // Insert exactly what ShieldedPool.transact inserts, or newRoot will not match the chain:
  // two value notes unless exiting, plus the fee note only when a relay is paid.
  const hasFee = req.bound.fee > 0n;
  if (isExit) {
    if (hasFee) tree.insert(commitments[2]);
  } else {
    tree.insert(commitments[0]);
    tree.insert(commitments[1]);
    if (hasFee) tree.insert(commitments[2]);
  }

  return {
    input,
    root,
    publicAmount,
    boundParamsHash: bph,
    publicToken: leaving === 0n ? 0n : req.token,
    isExit,
    nullifiers: [nullifiers[0], nullifiers[1]],
    commitments: [commitments[0], commitments[1], commitments[2]],
    newRoot: tree.root,
  };
}

/** snarkjs proof -> abi.encode(a, b, c). G2 coordinates are swapped for the EVM. */
export function encodeProof(proof: any): Hex {
  const a: [bigint, bigint] = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
  const b: [[bigint, bigint], [bigint, bigint]] = [
    [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
    [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
  ];
  const c: [bigint, bigint] = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];
  return encodeAbiParameters(
    [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }],
    [a, b, c],
  );
}

export async function prove(
  req: TransactionRequest,
  artifacts: ProvingArtifacts,
): Promise<ProvedTransaction> {
  const built = await buildInputs(req);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(built.input, artifacts.wasm, artifacts.zkey);

  if (!(await snarkjs.groth16.verify(artifacts.verificationKey, publicSignals, proof))) {
    throw new Error("proof failed local verification");
  }

  const { input: _input, ...rest } = built;
  return { proof: encodeProof(proof), ...rest };
}

/** Stops snarkjs worker threads. Call when done, or the process (e.g. Foundry ffi) does not exit. */
export async function shutdownProver(): Promise<void> {
  const curve = (globalThis as any).curve_bn128;
  if (curve && typeof curve.terminate === "function") await curve.terminate();
}
