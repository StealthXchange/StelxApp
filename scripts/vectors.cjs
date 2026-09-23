// Writes vectors.json (keys, commitments, nullifiers, tree roots) from the definitions using circomlibjs.
// Usage: node scripts/vectors.cjs (deterministic: same file every run)

const { buildPoseidon } = require("circomlibjs");
const { writeFileSync } = require("fs");
const { join } = require("path");

const DEPTH = 24;

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const AAPL = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9";

(async () => {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const H = (xs) => F.toObject(poseidon(xs.map(BigInt)));
  const str = (x) => x.toString();

  // Keys 0 and 1 are spending keys 1 and 2, which the proof tests use.
  // p - 1 exercises field reduction; the last is an arbitrary 253-bit value.
  const secret = [1n, 2n, 7n, F.p - 1n, 0x1f7a9c3e5b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4n];
  const keys = secret.map((sk) => ({ sk: str(sk), pk: str(H([sk])) }));

  // Covers zero value and the 120-bit maximum; notes 0 and 5 differ only in blinding.
  const specs = [
    { key: 0, token: WETH, value: 2500000000000000000n, blinding: 1001n },
    { key: 1, token: USDG, value: 250000000n, blinding: 1002n },
    { key: 2, token: AAPL, value: 0n, blinding: 1003n },
    { key: 3, token: WETH, value: (1n << 120n) - 1n, blinding: 1004n },
    { key: 4, token: USDG, value: 1n, blinding: F.p - 1n },
    { key: 0, token: WETH, value: 2500000000000000000n, blinding: 1006n },
  ];
  const notes = specs.map((n) => {
    const pk = BigInt(keys[n.key].pk);
    const tokenField = BigInt(n.token);
    return {
      key: n.key, pk: str(pk), token: n.token, tokenField: str(tokenField),
      value: str(n.value), blinding: str(n.blinding),
      commitment: str(H([pk, tokenField, n.value, n.blinding])),
    };
  });

  // Includes index 2^16 and the last index of a depth-24 tree.
  const spends = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [0, 5], [1, 65536], [0, 16777215]];
  const nullifiers = spends.map(([key, leaf]) => ({ key, leaf, nullifier: str(H([BigInt(keys[key].sk), BigInt(leaf)])) }));

  const zeros = [0n];
  for (let d = 1; d <= DEPTH; d++) zeros.push(H([zeros[d - 1], zeros[d - 1]]));

  // Naive full rebuild: the reference the incremental trees must match.
  const levels = (leaves) => {
    const out = [leaves.slice()];
    for (let d = 0; d < DEPTH; d++) {
      const cur = out[d], next = [];
      for (let i = 0; i < cur.length; i += 2) next.push(H([cur[i], i + 1 < cur.length ? cur[i + 1] : zeros[d]]));
      out.push(next.length ? next : [zeros[d + 1]]);
    }
    return out;
  };
  const leaves = notes.map((n) => BigInt(n.commitment));
  const roots = leaves.map((_, i) => str(levels(leaves.slice(0, i + 1))[DEPTH][0]));
  const path = (leaf) => {
    const lv = levels(leaves), siblings = [], bits = [];
    for (let d = 0, i = leaf; d < DEPTH; d++, i >>= 1) {
      siblings.push(str((i ^ 1) < lv[d].length ? lv[d][i ^ 1] : zeros[d]));
      bits.push(i & 1);
    }
    return { leaf, siblings, bits };
  };

  const out = {
    about: "STELX test vectors. Written by scripts/vectors.cjs, checked independently by test/vectors.check.mjs.",
    field: str(F.p),
    treeDepth: DEPTH,
    poseidon: { h1: str(H([1n])), h12: str(H([1n, 2n])), h1234: str(H([1n, 2n, 3n, 4n])) },
    definitions: {
      pk: "Poseidon([sk])",
      commitment: "Poseidon([pk, tokenField, value, blinding])",
      tokenField: "the token address as a uint160",
      nullifier: "Poseidon([sk, leaf])",
      node: "Poseidon([left, right]); zeros[0] = 0, zeros[d] = Poseidon([zeros[d-1], zeros[d-1]]); leaves fill left to right from 0",
    },
    keys,
    notes,
    nullifiers,
    tree: { zeros: zeros.map(str), empty: str(zeros[DEPTH]), roots, paths: [path(0), path(leaves.length - 1)] },
  };

  writeFileSync(join(__dirname, "..", "vectors.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`vectors.json: ${keys.length} keys, ${notes.length} notes, ${nullifiers.length} nullifiers, root ${roots.at(-1).slice(0, 12)}…`);
})();
