// Times a seed-only wallet scanning a local chain that holds N shielded notes (default 500).
// Usage: node test/perf.cold-start.ts [notes]
import { startLocal, E } from "./helpers/local.ts";
import { Wallet } from "../client/src/wallet.ts";
import { shutdownProver } from "../client/src/prover.ts";
import { encodeFunctionData, type Hex } from "viem";
import { POOL_ABI } from "../client/src/wallet.ts";
import { fieldToBytes32 } from "../client/src/field.ts";
import { randomBlinding, publicKeyOf } from "../client/src/note.ts";

const N = Number(process.argv[2] ?? 500);
const MNEMONIC = "test test test test test test test test test test test junk";

const local = await startLocal(8549, E / 100n);
try {
  const me = await Wallet.create(MNEMONIC, local.cfg);
  const myPk = me.keys.spending.publicKey;

  const t0 = Date.now();
  let mine = 0;
  for (let i = 0; i < N; i++) {
    const ours = i % 25 === 0;
    const pk = ours ? myPk : await publicKeyOf(randomBlinding());
    if (ours) mine++;
    const blob = new Uint8Array(96);
    blob.set(fieldToBytes32(pk), 0);
    blob.set(fieldToBytes32(randomBlinding()), 32);
    blob.set(fieldToBytes32(E / 1000n), 64);
    const data = encodeFunctionData({ abi: POOL_ABI, functionName: "shield", args: [local.weth, E / 1000n, ("0x" + Buffer.from(blob).toString("hex")) as Hex] });
    await local.send(local.depositor, { to: local.pool, data });
    if ((i + 1) % 100 === 0) console.log(`  shielded ${i + 1}/${N}`);
  }
  console.log(`filled ${N} notes in ${((Date.now() - t0) / 1000).toFixed(1)} s (chain side, not measured)`);

  const t1 = Date.now();
  const fresh = await Wallet.create(MNEMONIC, local.cfg);
  const r = await fresh.scan();
  const balance = await fresh.getBalance(local.weth);
  const ms = Date.now() - t1;

  console.log(`cold start at ${r.leaves} notes: ${ms} ms total, ${(ms / r.leaves).toFixed(2)} ms per note`);
  console.log(`owned ${r.owned} (expected ${mine}), balance ${balance} (expected ${BigInt(mine) * (E / 1000n)})`);
  if (r.owned !== mine || balance !== BigInt(mine) * (E / 1000n)) { console.error("MISMATCH"); process.exitCode = 1; }
} finally {
  await shutdownProver();
  local.stop();
}
