// Recomputes every value in vectors.json with circomlibjs, independently of the generator.
import { readFileSync } from "node:fs";
import { buildPoseidon } from "circomlibjs";

const v = JSON.parse(readFileSync(new URL("../vectors.json", import.meta.url)));

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (xs) => F.toString(poseidon(xs.map((x) => BigInt(x))));

let pass = 0;
const failures = [];
function check(label, expected, actual) {
  if (String(expected) === String(actual)) pass++;
  else failures.push({ label, expected: String(expected), actual: String(actual) });
}

check("field modulus", v.field, F.p);
check("poseidon([1])", v.poseidon.h1, H([1]));
check("poseidon([1,2])", v.poseidon.h12, H([1, 2]));
check("poseidon([1,2,3,4])", v.poseidon.h1234, H([1, 2, 3, 4]));

for (const [i, k] of v.keys.entries()) check(`keys[${i}].pk`, k.pk, H([k.sk]));

for (const [i, n] of v.notes.entries()) {
  check(`notes[${i}].tokenField is uint160(token)`, BigInt(n.token), n.tokenField);
  check(`notes[${i}].pk is keys[${n.key}].pk`, v.keys[n.key].pk, n.pk);
  check(`notes[${i}] value fits 120 bits`, true, BigInt(n.value) < 1n << 120n);
  check(`notes[${i}].commitment`, n.commitment, H([n.pk, n.tokenField, n.value, n.blinding]));
}

for (const [i, n] of v.nullifiers.entries()) {
  check(`nullifiers[${i}] leaf fits the tree`, true, n.leaf < 2 ** v.treeDepth);
  check(`nullifiers[${i}]`, n.nullifier, H([v.keys[n.key].sk, n.leaf]));
}

const zeros = ["0"];
for (let d = 1; d <= v.treeDepth; d++) zeros.push(H([zeros[d - 1], zeros[d - 1]]));
check("zeros count", v.treeDepth + 1, v.tree.zeros.length);
for (const [i, z] of v.tree.zeros.entries()) check(`zeros[${i}]`, z, zeros[i]);
check("empty root", v.tree.empty, zeros[v.treeDepth]);

// Deliberately naive: the reference for the incremental insert.
function rootOf(leaves) {
  let level = leaves.map(String);
  for (let d = 0; d < v.treeDepth; d++) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(H([level[i], i + 1 < level.length ? level[i + 1] : zeros[d]]));
    level = next.length ? next : [zeros[d + 1]];
  }
  return level[0];
}
const commitments = v.notes.map((n) => n.commitment);
check("one root per note", commitments.length, v.tree.roots.length);
for (const [i, r] of v.tree.roots.entries()) check(`root after ${i + 1} insert(s)`, r, rootOf(commitments.slice(0, i + 1)));

const finalRoot = v.tree.roots.at(-1);
for (const p of v.tree.paths) {
  check(`path ${p.leaf} depth`, v.treeDepth, p.siblings.length);
  const bits = Array.from({ length: v.treeDepth }, (_, b) => (p.leaf >> b) & 1);
  check(`path ${p.leaf} bits match the index`, bits.join(""), p.bits.join(""));
  let node = commitments[p.leaf];
  for (const [d, sib] of p.siblings.entries()) node = bits[d] ? H([sib, node]) : H([node, sib]);
  check(`path ${p.leaf} reaches the final root`, finalRoot, node);
}

check("commitments all distinct", commitments.length, new Set(commitments).size);
check("notes 0 and 5 differ only in blinding, and their commitments differ", true,
  v.notes[0].value === v.notes[5].value && v.notes[0].token === v.notes[5].token && commitments[0] !== commitments[5]);
check("nullifiers all distinct", v.nullifiers.length, new Set(v.nullifiers.map((n) => n.nullifier)).size);

console.log(`\n${pass} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures.slice(0, 12)) console.log(`FAIL ${f.label}\n  expected ${f.expected}\n  actual   ${f.actual}`);
  process.exit(1);
}
console.log("All vectors reproduced independently.");
