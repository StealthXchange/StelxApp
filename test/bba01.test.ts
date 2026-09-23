// A transaction that moves no value must be unprovable; one real input plus a filler must still prove.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prove, shutdownProver } from "../client/src/prover.ts";
import { commitmentOf, publicKeyOf } from "../client/src/note.ts";

const E = 10n ** 18n;
const token = BigInt("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const artifacts = {
  wasm: fileURLToPath(new URL("../build/transaction_js/transaction.wasm", import.meta.url)),
  zkey: fileURLToPath(new URL("../build/transaction_final.zkey", import.meta.url)),
  verificationKey: JSON.parse(readFileSync(new URL("../build/verification_key.json", import.meta.url), "utf8")),
};
const bound = {
  extAmount: 0n,
  recipient: "0x0000000000000000000000000000000000000000" as const,
  broadcaster: "0x0000000000000000000000000000000000000b0b" as const,
  fee: 0n,
  encryptedNotes: ["0xaa01", "0xbb02"] as [string, string],
  chainId: 31337n,
  pool: "0x1111111111111111111111111111111111111111" as const,
};

test("BBA-01: a null transaction (no value in, none out) cannot be proved", async () => {
  const pk = await publicKeyOf(1n);
  await assert.rejects(
    () =>
      prove(
        {
          spendingKey: 1n,
          token,
          leaves: [],
          inputs: [
            { value: 0n, blinding: 111n, leafIndex: 0 },
            { value: 0n, blinding: 222n, leafIndex: 1 },
          ],
          outputs: [
            { publicKey: pk, value: 0n, blinding: 333n },
            { publicKey: pk, value: 0n, blinding: 444n },
            { publicKey: pk, value: 0n, blinding: 555n },
          ],
          bound,
        },
        artifacts,
      ),
    // Only the failure is asserted; the message is toolchain text.
    (e: unknown) => e instanceof Error,
    "a value-free transaction must not be provable",
  );
});

test("BBA-01: one real input and one filler still proves, so fillers keep working", async () => {
  const pk = await publicKeyOf(1n);
  const note = await commitmentOf({ publicKey: pk, token, value: 2n * E, blinding: 111n });
  const r = await prove(
    {
      spendingKey: 1n,
      token,
      leaves: [note],
      // The client appends the zero-value filler input itself.
      inputs: [{ value: 2n * E, blinding: 111n, leafIndex: 0 }],
      outputs: [
        { publicKey: pk, value: 15n * E / 10n, blinding: 333n },
        { publicKey: pk, value: 5n * E / 10n, blinding: 444n },
        { publicKey: pk, value: 0n, blinding: 555n },
      ],
      bound,
    },
    artifacts,
  );
  assert.ok(r.proof.length > 2, "a one-note spend must still prove");
});

test.after(async () => {
  await shutdownProver();
});
