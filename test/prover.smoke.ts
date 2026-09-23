// Direct prover check outside Foundry: one real proof, timed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prove, shutdownProver } from "../client/src/prover.ts";
import { commitmentOf, publicKeyOf } from "../client/src/note.ts";
const vectors = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url), "utf8"));
const E = 10n ** 18n;
const token = BigInt("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const pk1 = await publicKeyOf(1n);
const pk2 = BigInt(vectors.keys[1].pk);
const cA = await commitmentOf({ publicKey: pk1, token, value: 5n * E, blinding: 111n });
const cB = await commitmentOf({ publicKey: pk1, token, value: 3n * E, blinding: 222n });
const t0 = Date.now();
const r = await prove({
  spendingKey: 1n, token, leaves: [cA, cB],
  inputs: [{ value: 5n * E, blinding: 111n, leafIndex: 0 }, { value: 3n * E, blinding: 222n, leafIndex: 1 }],
  outputs: [{ publicKey: pk2, value: 6n * E, blinding: 333n }, { publicKey: pk1, value: 95n * E / 100n, blinding: 444n }, { publicKey: pk1, value: 5n * E / 100n, blinding: 555n }],
  bound: { extAmount: -E, recipient: "0x000000000000000000000000000000000000cafe", broadcaster: "0x0000000000000000000000000000000000000b0b", fee: 5n * E / 100n, encryptedNotes: ["0xaa01", "0xbb02", "0xcc03"], chainId: 31337n, pool: "0x1111111111111111111111111111111111111111" },
}, {
  wasm: fileURLToPath(new URL("../build/transaction_js/transaction.wasm", import.meta.url)),
  zkey: fileURLToPath(new URL("../build/transaction_final.zkey", import.meta.url)),
  verificationKey: JSON.parse(readFileSync(new URL("../build/verification_key.json", import.meta.url), "utf8")),
});
console.log(`proved and verified in ${((Date.now() - t0) / 1000).toFixed(1)} s; proof ${(r.proof.length - 2) / 2} bytes; root ${String(r.root).slice(0, 10)}… newRoot ${String(r.newRoot).slice(0, 10)}…`);
await shutdownProver();
process.exit(0);
