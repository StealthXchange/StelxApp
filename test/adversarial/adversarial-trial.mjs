// Adversarial trial of the transaction circuit: each case mutates a valid witness and checks whether the constraints hold.
// Uses its own Poseidon and tree, not client/src. Usage: node test/adversarial/adversarial-trial.mjs [out.json]
import fs from "node:fs";
import { createRequire } from "node:module";
import { buildPoseidon } from "circomlibjs";

// The circom witness calculator is CommonJS in a "type":"module" repo, so load a .cjs copy from the temp dir.
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const calcSrc = new URL("../../build/transaction_js/witness_calculator.js", import.meta.url);
const calcCjs = path.join(os.tmpdir(), "stelx-witness_calculator.cjs");
fs.copyFileSync(calcSrc, calcCjs);
const builder = require(calcCjs);

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DEPTH = 24, N_INS = 2, N_OUTS = 3, VALUE_BITS = 120;
const MAX_VALUE = (1n << 120n) - 1n;
const TOKEN = BigInt("0x33e4191705c386532ba27cBF171Db86919200B94");

const P = await buildPoseidon();
const H = (xs) => P.F.toObject(P(xs.map((x) => BigInt(x))));

const pubOf = (priv) => H([priv]);
const commit = (pk, value, blinding) => H([pk, TOKEN, value, blinding]);
const nullif = (priv, idx) => H([priv, BigInt(idx)]);

class Tree {
  constructor() {
    this.zeros = [0n];
    for (let d = 0; d < DEPTH; d++) this.zeros.push(H([this.zeros[d], this.zeros[d]]));
    this.levels = Array.from({ length: DEPTH + 1 }, () => []);
  }
  insert(leaf) {
    const i = this.levels[0].length;
    this.levels[0].push(leaf);
    let idx = i;
    for (let d = 0; d < DEPTH; d++) {
      const p = idx >> 1;
      const l = this.levels[d][2 * p];
      const r = this.levels[d][2 * p + 1] ?? this.zeros[d];
      this.levels[d + 1][p] = H([l, r]);
      idx = p;
    }
    return i;
  }
  get root() { return this.levels[DEPTH][0] ?? this.zeros[DEPTH]; }
  path(i) {
    const el = []; let idx = i;
    for (let d = 0; d < DEPTH; d++) { el.push(this.levels[d][idx ^ 1] ?? this.zeros[d]); idx >>= 1; }
    return el;
  }
}

let seed = 12345n;
const rnd = () => { seed = (seed * 6364136223846793005n + 1442695040888963407n) % FIELD; return seed % (FIELD - 1n) + 1n; };

function scenario({ inVals = [5n, 7n], outVals = [4n, 8n], leaving = 0n, fillerSlots = [] } = {}) {
  const tree = new Tree();
  const key = rnd();
  const pk = pubOf(key);
  for (let k = 0; k < 3; k++) tree.insert(commit(pubOf(rnd()), 1n, rnd()));
  const notes = inVals.map((v, i) => {
    if (fillerSlots.includes(i)) {
      const fk = rnd();
      return { key: fk, value: 0n, blinding: rnd(), idx: 0, inTree: false };
    }
    const b = rnd();
    const idx = tree.insert(commit(pk, v, b));
    return { key, value: v, blinding: b, idx, inTree: true };
  });
  // Two-output cases get a zero-value third output, as in a transaction that pays no relay.
  const padded = [...outVals];
  while (padded.length < N_OUTS) padded.push(0n);
  const outs = padded.map((v) => ({ pk: pubOf(rnd()), value: v, blinding: rnd() }));
  const publicAmount = leaving === 0n ? 0n : FIELD - leaving;
  const input = {
    root: tree.root,
    publicAmount,
    boundParamsHash: rnd(),
    token: TOKEN,
    isExit: 0n,
    publicToken: TOKEN,
    hasFee: 0n,
    inputNullifier: notes.map((n) => nullif(n.key, n.idx)),
    outputCommitment: outs.map((o) => commit(o.pk, o.value, o.blinding)),
    inValue: notes.map((n) => n.value),
    inPrivateKey: notes.map((n) => n.key),
    inBlinding: notes.map((n) => n.blinding),
    inLeafIndex: notes.map((n) => BigInt(n.idx)),
    inPathElements: notes.map((n) => (n.inTree ? tree.path(n.idx) : Array(DEPTH).fill(0n))),
    outValue: outs.map((o) => o.value),
    outPublicKey: outs.map((o) => o.pk),
    outBlinding: outs.map((o) => o.blinding),
  };
  return { input, tree, notes, outs, key };
}

const toStr = (v) => (typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(toStr) : v);

const wasm = fs.readFileSync(new URL("../../build/transaction_js/transaction.wasm", import.meta.url));

async function run(input) {
  const wc = await builder(wasm);
  await wc.calculateWitness(toStr(input), true);
}

const cases = [];
const add = (id, name, expect, build, why) => cases.push({ id, name, expect, build, why });

add("C0", "control: private send, 2 real inputs -> 2 outputs, publicAmount 0", "PASS",
  () => scenario().input, "baseline legitimate transaction");
add("C1", "control: unshield, inputs 5+7 -> outputs 0+2, leaving 10", "PASS",
  () => scenario({ outVals: [0n, 2n], leaving: 10n }).input, "baseline legitimate withdrawal");
add("C2", "control: 1 real input + 1 zero-value filler (how the client fills unused slots)", "PASS",
  () => scenario({ inVals: [12n, 0n], outVals: [5n, 7n], fillerSlots: [1] }).input, "filler design");
add("C3", "boundary: leaving = 2^121-2 (max reachable), outputs 0", "PASS",
  () => scenario({ inVals: [MAX_VALUE, MAX_VALUE], outVals: [0n, 0n], leaving: 2n * MAX_VALUE }).input,
  "largest legal withdrawal must be accepted");

add("A1", "mint: outputs sum 20, inputs sum 12, publicAmount 0", "FAIL",
  () => scenario({ inVals: [5n, 7n], outVals: [10n, 10n] }).input, "value conservation");
add("A2", "mint via publicAmount: publicAmount = +8 (value 'entering' through transact)", "FAIL",
  () => { const s = scenario({ inVals: [5n, 7n], outVals: [10n, 10n] }); s.input.publicAmount = 8n; return s.input; },
  "publicAmount may only be 0 or r-L; +8 makes -publicAmount = r-8, outside Num2Bits(121)");
add("A3", "filler carrying value: a slot not in the tree given value 1", "FAIL",
  () => { const s = scenario({ inVals: [11n, 0n], outVals: [6n, 6n], fillerSlots: [1] });
          s.input.inValue[1] = 1n; return s.input; },
  "non-zero value enables the root check, which the filler cannot satisfy");
add("A4", "output overflow: outValue = 2^120", "FAIL",
  () => { const s = scenario({ inVals: [MAX_VALUE, 1n], outVals: [0n, 0n] });
          s.input.outValue[0] = 1n << 120n; s.input.outputCommitment[0] = commit(s.outs[0].pk, 1n << 120n, s.outs[0].blinding); return s.input; },
  "Num2Bits(120) on outputs");
add("A5", "input overflow: a note with value 2^120 that IS in the tree", "FAIL",
  () => {
          const s = scenario({ inVals: [1n, 1n], outVals: [1n, 1n] });
          const big = 1n << 120n, b = rnd();
          const idx = s.tree.insert(commit(pubOf(s.key), big, b));
          s.input.root = s.tree.root;
          s.input.inValue[0] = big; s.input.inBlinding[0] = b; s.input.inLeafIndex[0] = BigInt(idx);
          s.input.inPathElements = [s.tree.path(idx), s.tree.path(s.notes[1].idx)];
          s.input.inputNullifier[0] = nullif(s.key, idx);
          s.input.outValue = [big, 1n]; s.input.outputCommitment[0] = commit(s.outs[0].pk, big, s.outs[0].blinding);
          return s.input; },
  "Num2Bits(120) on inputs, independent of the inductive argument");
add("A6", "leaving too large: publicAmount = r - 2^121 (one past the bound)", "FAIL",
  () => { const s = scenario({ inVals: [MAX_VALUE, MAX_VALUE], outVals: [0n, 0n] });
          s.input.publicAmount = FIELD - (1n << 121n); return s.input; },
  "Num2Bits(121) on -publicAmount");
add("A7", "leafIndex out of range: inLeafIndex = 16777216 (2^24)", "FAIL",
  () => { const s = scenario(); s.input.inLeafIndex[0] = 16777216n;
          s.input.inputNullifier[0] = nullif(s.key, 16777216); return s.input; },
  "Num2Bits(24) on the index");
add("A8", "double-spend in one tx: both inputs are the same note", "FAIL",
  () => { const s = scenario({ inVals: [6n, 6n], outVals: [6n, 6n] });
          for (const f of ["inValue","inPrivateKey","inBlinding","inLeafIndex","inPathElements","inputNullifier"]) s.input[f][1] = s.input[f][0];
          return s.input; },
  "pairwise IsEqual on nullifiers must be 0");
add("A9", "nullifier mismatch: published nullifier = real + 1", "FAIL",
  () => { const s = scenario(); s.input.inputNullifier[0] = (s.input.inputNullifier[0] + 1n) % FIELD; return s.input; },
  "nullifier === public input");
add("A10", "wrong sibling: one Merkle path element corrupted on a valued input", "FAIL",
  () => { const s = scenario(); s.input.inPathElements[0][3] = (s.input.inPathElements[0][3] + 1n) % FIELD; return s.input; },
  "root recomputation fails while enabled");
add("A11", "commitment mismatch: published output commitment = real + 1", "FAIL",
  () => { const s = scenario(); s.input.outputCommitment[0] = (s.input.outputCommitment[0] + 1n) % FIELD; return s.input; },
  "commitment === public input");
add("A12", "wrong token: public token differs from the token the leaves were built with", "FAIL",
  () => { const s = scenario(); s.input.token = TOKEN + 1n; return s.input; },
  "input commitments no longer match the leaves in the tree");
add("A13", "wrong root: root = real + 1 with valued inputs", "FAIL",
  () => { const s = scenario(); s.input.root = (s.input.root + 1n) % FIELD; return s.input; },
  "ForceEqualIfEnabled on root");
add("A14", "steal a note: spend a leaf that exists, with a different private key", "FAIL",
  () => { const s = scenario(); const thief = rnd();
          s.input.inPrivateKey[0] = thief; s.input.inputNullifier[0] = nullif(thief, s.notes[0].idx); return s.input; },
  "publicKey derives from the key, so the commitment no longer matches the leaf");
add("A15", "two valued inputs claiming the same leafIndex with different keys", "FAIL",
  () => { const s = scenario({ inVals: [5n, 5n], outVals: [5n, 5n] });
          const k2 = rnd();
          s.input.inPrivateKey[1] = k2; s.input.inLeafIndex[1] = s.input.inLeafIndex[0];
          s.input.inPathElements[1] = s.input.inPathElements[0]; s.input.inputNullifier[1] = nullif(k2, s.notes[0].idx);
          return s.input; },
  "only one commitment sits at an index; the second cannot prove inclusion");
add("A16", "by design: zero-value filler with a wrong root is accepted", "PASS",
  () => { const s = scenario({ inVals: [12n, 0n], outVals: [5n, 7n], fillerSlots: [1] });
          s.input.inPathElements[1] = Array(DEPTH).fill(999n); return s.input; },
  "root check is skipped for value 0 — safe because it adds nothing to the sum");
add("A17", "BOUNDARY OF GUARANTEE: filler publishes the nullifier of the REAL spending key at an unused index", "PASS",
  () => { const s = scenario({ inVals: [12n, 0n], outVals: [5n, 7n], fillerSlots: [1] });
          const burnIdx = 40;
          s.input.inPrivateKey[1] = s.key; s.input.inLeafIndex[1] = BigInt(burnIdx);
          s.input.inputNullifier[1] = nullif(s.key, burnIdx); return s.input; },
  "circuit accepts this; the contract will retire Poseidon(key,40), burning any future note at index 40 — a CLIENT invariant, not a circuit one");
add("A18", "boundParamsHash = 0 (circuit does not validate it, only keeps it alive)", "PASS",
  () => { const s = scenario(); s.input.boundParamsHash = 0n; return s.input; },
  "binding is enforced by the contract recomputing the hash; the circuit only squares it so it survives in the vk");
add("A19", "field semantics: private inValue supplied as p+5 (out of field)", "PASS",
  () => { const s = scenario({ inVals: [5n, 7n] }); s.input.inValue[0] = FIELD + 5n; return s.input; },
  "witness calculator reduces mod p, so p+5 behaves as 5 — private signals never reach the contract's NotInField check; harmless here, noted for completeness");

add("A20", "multi-asset: withdraw a different asset than the notes hold", "FAIL",
  () => { const s = scenario({ leaving: 3n, outVals: [4n, 5n] }); s.input.publicToken = TOKEN + 1n; return s.input; },
  "isPublic * (publicToken - token) === 0 — with value leaving, the published asset must equal the notes' asset, or one ticker could be drained using another's notes");

add("A21", "multi-asset: a private send may publish any token (it is not bound)", "PASS",
  () => { const s = scenario({ leaving: 0n }); s.input.publicToken = 999n; return s.input; },
  "deliberate: publicAmount is 0 so the binding is off, which is what stops a private transfer revealing which instrument moved");

add("A22", "relay fee: claim no fee but hide value in the fee slot", "FAIL",
  () => { const s = scenario({ inVals: [10n, 0n], outVals: [4n, 1n, 5n], fillerSlots: [1] }); s.input.hasFee = 0n; return s.input; },
  "(1 - hasFee) * outValue[nOuts-1] === 0 — the contract skips inserting the fee note when hasFee is clear, so value smuggled there would be destroyed rather than spendable");

add("A23", "relay fee: a paid relay, hasFee set", "PASS",
  () => { const s = scenario({ inVals: [10n, 0n], outVals: [4n, 1n, 5n], fillerSlots: [1] }); s.input.hasFee = 1n; return s.input; },
  "the intended shape: recipient, change, and the relay's note. The amount is public calldata; a relay verifies its note by decrypting the ciphertext and re-hashing against the commitment");

const results = [];
for (const c of cases) {
  let actual, msg = "";
  try { await run(c.build()); actual = "PASS"; }
  catch (e) { actual = "FAIL"; msg = String(e.message || e).split("\n").filter(Boolean).slice(0, 2).join(" | ").slice(0, 160); }
  const ok = actual === c.expect;
  results.push({ id: c.id, name: c.name, expect: c.expect, actual, ok, why: c.why, detail: msg });
  console.log(`${ok ? "ok " : "!! "} ${c.id.padEnd(4)} expect ${c.expect.padEnd(4)} got ${actual.padEnd(4)}  ${c.name}`);
  if (msg) console.log(`        ${msg}`);
}
const summary = { total: results.length, asExpected: results.filter((r) => r.ok).length, unexpected: results.filter((r) => !r.ok) };
console.log(`\n${summary.asExpected}/${summary.total} cases behaved as expected`);
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ summary, results }, null, 2));
process.exit(summary.unexpected.length ? 1 : 0);
