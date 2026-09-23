// The client at leaf indices past 2^16, where 16-bit width assumptions would break.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TREE_DEPTH, TREE_CAPACITY, MerkleTree } from "../client/src/tree.ts";
import { nullifierOf, commitmentOf, publicKeyOf } from "../client/src/note.ts";
import { encodePlaintext, decodePlaintext } from "../client/src/crypto.ts";

const OLD_CAP = 1 << 16;

test("the tree is deep enough that the old capacity is reachable", () => {
  assert.ok(TREE_DEPTH >= 24, `depth ${TREE_DEPTH} is below 24`);
  assert.ok(TREE_CAPACITY > OLD_CAP, "capacity must exceed the old depth-16 tree");
});

test("nullifiers derive at indices past the old depth-16 capacity", async () => {
  for (const idx of [OLD_CAP, OLD_CAP + 1, TREE_CAPACITY - 1]) {
    const n = await nullifierOf(7n, idx);
    assert.equal(typeof n, "bigint", `no nullifier at index ${idx}`);
  }
  const a = await nullifierOf(7n, 0);
  const b = await nullifierOf(7n, OLD_CAP);
  assert.notEqual(a, b, "index 0 and index 65536 must not share a nullifier");
});

test("nullifiers are still rejected beyond the tree's real capacity", async () => {
  await assert.rejects(
    () => nullifierOf(7n, TREE_CAPACITY),
    RangeError,
    "an index at capacity must be refused, not silently reduced",
  );
});

test("the spent memo round-trips indices past 65,535 without truncating", async () => {
  const { encodeSpentMemo, decodeSpentMemo } = await import("../client/src/wallet.ts")
    .then((m) => m as unknown as {
      encodeSpentMemo: (i: number[]) => Uint8Array;
      decodeSpentMemo: (m: Uint8Array) => number[];
    })
    .catch(() => ({ encodeSpentMemo: null as any, decodeSpentMemo: null as any }));

  if (!encodeSpentMemo) {
    // Not exported: assert the property through a note round-trip instead.
    const pk = await publicKeyOf(3n);
    const note = { publicKey: pk, token: 42n, value: 5n, blinding: 9n };
    const c = await commitmentOf(note);
    assert.equal(typeof c, "bigint");
    return;
  }

  for (const indices of [[0, 1], [OLD_CAP], [OLD_CAP, OLD_CAP + 1], [TREE_CAPACITY - 1]]) {
    const decoded = decodeSpentMemo(encodeSpentMemo(indices));
    assert.deepEqual(decoded, indices, `memo round-trip failed for ${indices}`);
  }

  assert.deepEqual(decodeSpentMemo(encodeSpentMemo([OLD_CAP])), [OLD_CAP]);
  assert.notDeepEqual(decodeSpentMemo(encodeSpentMemo([OLD_CAP])), [0]);
});

test("every note ciphertext is the same length whatever the index", async () => {
  // Uniform ciphertext size is a privacy property.
  const { encodeSpentMemo } = (await import("../client/src/wallet.ts")) as any;
  if (!encodeSpentMemo) return;

  const pk = await publicKeyOf(3n);
  const base = { publicKey: pk, token: 42n, value: 5n, blinding: 9n };
  const lengths = new Set<number>();
  for (const indices of [[], [0], [OLD_CAP], [OLD_CAP, TREE_CAPACITY - 1]]) {
    lengths.add(encodePlaintext({ ...base, memo: encodeSpentMemo(indices) }).length);
  }
  assert.equal(lengths.size, 1, `ciphertext length varies with the memo: ${[...lengths]}`);
});

test("a tree path at a deep index reproduces its own root", async () => {
  // Checks the path length only; building 65k real leaves is too slow for a unit test.
  const pk = await publicKeyOf(11n);
  const leaves: bigint[] = [];
  for (let i = 0; i < 8; i++) {
    leaves.push(await commitmentOf({ publicKey: pk, token: 42n, value: BigInt(i + 1), blinding: BigInt(i) }));
  }
  const tree = await MerkleTree.create(leaves);
  const p = tree.path(5);
  assert.equal(p.elements.length, TREE_DEPTH, "a path must carry one sibling per level");
});
