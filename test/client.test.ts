import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { poseidon, addressToField } from "../client/src/field.ts";
import { publicKeyOf, commitmentOf, nullifierOf } from "../client/src/note.ts";
import { MerkleTree } from "../client/src/tree.ts";
import { keysFromMnemonic, decodeAddress } from "../client/src/keys.ts";
import { encodePlaintext, decodePlaintext, encryptNote, tryDecryptNote } from "../client/src/crypto.ts";
import { buildInputs } from "../client/src/prover.ts";

const vectors = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url), "utf8"));

test("client note formulas reproduce the test vectors", async () => {
  for (const k of vectors.keys) {
    assert.equal((await publicKeyOf(BigInt(k.sk))).toString(), k.pk);
  }
  for (const n of vectors.notes) {
    const c = await commitmentOf({ publicKey: BigInt(n.pk), token: addressToField(n.token), value: BigInt(n.value), blinding: BigInt(n.blinding) });
    assert.equal(c.toString(), n.commitment);
  }
  for (const n of vectors.nullifiers) {
    assert.equal((await nullifierOf(BigInt(vectors.keys[n.key].sk), n.leaf)).toString(), n.nullifier);
  }
});

test("client tree reproduces the vector roots and paths", async () => {
  const t = await MerkleTree.create();
  assert.equal(t.root.toString(), vectors.tree.empty);
  for (const [i, n] of vectors.notes.entries()) {
    t.insert(BigInt(n.commitment));
    assert.equal(t.root.toString(), vectors.tree.roots[i], `root after ${i + 1}`);
  }
  for (const want of vectors.tree.paths) {
    const p = t.path(want.leaf);
    assert.deepEqual(p.elements.map(String), want.siblings);
    assert.equal(t.rootFromPath(t.leaf(want.leaf), p).toString(), vectors.tree.roots.at(-1));
  }
});

const MNEMONIC = "test test test test test test test test test test test junk";

test("keys derive deterministically and the address round-trips", async () => {
  const a = await keysFromMnemonic(MNEMONIC);
  const b = await keysFromMnemonic(MNEMONIC);
  assert.equal(a.spending.privateKey, b.spending.privateKey);
  assert.equal(a.address, b.address);
  assert.equal(a.spending.publicKey, await publicKeyOf(a.spending.privateKey));
  const d = decodeAddress(a.address);
  assert.equal(d.publicKey, a.spending.publicKey);
  assert.deepEqual(Array.from(d.viewingPublic), Array.from(a.viewing.publicKey));
  const other = await keysFromMnemonic(MNEMONIC, 1);
  assert.notEqual(other.spending.privateKey, a.spending.privateKey);
  assert.throws(() => decodeAddress(a.address.slice(0, -1) + (a.address.endsWith("0") ? "1" : "0")));
});

test("note encryption round-trips, rejects the wrong key, and re-hashes to the commitment", async () => {
  const alice = await keysFromMnemonic(MNEMONIC, 0);
  const bob = await keysFromMnemonic(MNEMONIC, 1);
  const note = { publicKey: bob.spending.publicKey, token: addressToField("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"), value: 123456789n, blinding: 987654321n, memo: new TextEncoder().encode("hi") };
  const payload = encryptNote(bob.viewing.publicKey, encodePlaintext(note));

  assert.equal(tryDecryptNote(alice.viewing.privateKey, payload), null, "wrong viewing key must fail the tag");
  const pt = tryDecryptNote(bob.viewing.privateKey, payload);
  assert.ok(pt);
  const decoded = decodePlaintext(bob.spending.publicKey, pt!);
  assert.equal(decoded.value, note.value);
  assert.equal(decoded.blinding, note.blinding);
  assert.equal(decoded.token, note.token);
  assert.equal(new TextDecoder().decode(decoded.memo), "hi");
  assert.equal(await commitmentOf(decoded), await commitmentOf(note));

  const tampered = Uint8Array.from(payload); tampered[tampered.length - 1] ^= 1;
  assert.equal(tryDecryptNote(bob.viewing.privateKey, tampered), null, "tampered ciphertext must fail the tag");
});

test("a filler input never uses the spending key, so it cannot burn the wallet's own note", async () => {
  const spendingKey = 1n;
  const token = addressToField("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
  const pk = await publicKeyOf(spendingKey);
  const c = await commitmentOf({ publicKey: pk, token, value: 5n, blinding: 111n });
  for (let i = 0; i < 20; i++) {
    const built = await buildInputs({
      spendingKey, token, leaves: [c],
      inputs: [{ value: 5n, blinding: 111n, leafIndex: 0 }],
      outputs: [{ publicKey: pk, value: 5n, blinding: 1n }, { publicKey: pk, value: 0n, blinding: 2n }, { publicKey: pk, value: 0n, blinding: 3n }],
      bound: { extAmount: 0n, recipient: "0x0000000000000000000000000000000000000000", broadcaster: "0x0000000000000000000000000000000000000001", fee: 0n, encryptedNotes: ["0x", "0x", "0x"], chainId: 1n, pool: "0x0000000000000000000000000000000000000002" },
    });
    const keys = (built.input as any).inPrivateKey as string[];
    assert.equal(keys[0], "1", "real input uses the spending key");
    assert.notEqual(keys[1], "1", "filler must not use the spending key");
    assert.notEqual(keys[1], "0");
    assert.notEqual(built.nullifiers[1], await nullifierOf(spendingKey, 0), "filler nullifier must not be the real note's nullifier");
  }
});
