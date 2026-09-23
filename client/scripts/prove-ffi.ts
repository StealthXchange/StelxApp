// FFI entry point for ProofIntegration.t.sol: proves the transaction described by one JSON argument and prints
// abi.encode(bytes proof, uint256 root, uint256 boundParamsHash, uint256[2] nullifiers, uint256[3] commitments, uint256 newRoot).
import { encodeAbiParameters, type Hex } from "viem";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { prove, shutdownProver } from "../src/prover.ts";

const raw = process.argv[2];
if (!raw) { console.error("usage: node prove-ffi.ts '<json>'"); process.exit(2); }
const j = JSON.parse(raw);
const big = (x: string | number) => BigInt(x);

const result = await prove(
  {
    spendingKey: big(j.spendingKey),
    token: big(j.token),
    leaves: (j.leaves as string[]).map(big),
    inputs: (j.inputs as any[]).map((n) => ({ value: big(n.value), blinding: big(n.blinding), leafIndex: Number(n.leafIndex) })),
    outputs: (j.outputs as any[]).map((o) => ({ publicKey: big(o.publicKey), value: big(o.value), blinding: big(o.blinding) })),
    bound: {
      extAmount: big(j.extAmount),
      recipient: j.recipient as Hex,
      broadcaster: j.broadcaster as Hex,
      fee: big(j.fee),
      encryptedNotes: (j.encryptedNotes as Hex[]),
      chainId: big(j.chainId),
      pool: j.pool as Hex,
    },
  },
  {
    wasm: fileURLToPath(new URL("../../build/transaction_js/transaction.wasm", import.meta.url)),
    zkey: fileURLToPath(new URL("../../build/transaction_final.zkey", import.meta.url)),
    verificationKey: JSON.parse(readFileSync(new URL("../../build/verification_key.json", import.meta.url), "utf8")),
  },
);

process.stdout.write(
  encodeAbiParameters(
    [{ type: "bytes" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256[2]" }, { type: "uint256[3]" }, { type: "uint256" }],
    [result.proof, result.root, result.boundParamsHash, result.nullifiers, result.commitments, result.newRoot],
  ),
);

await shutdownProver();
process.exit(0);
