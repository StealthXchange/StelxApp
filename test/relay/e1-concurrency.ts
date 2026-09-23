// N users submit valid transfers to one relay at the same instant.
// MODE=auto (anvil automine) or MODE=interval (anvil mines every BLOCK_TIME s, like a real chain).
import { setup, fundedUser, keysFromMnemonic, newMnemonic, submitViaBroadcaster, waitForBroadcast, log, short, nonceOf, relayBalance, rpc, E, POOL_ABI } from "./lib.ts";

const N = Number(process.env.N ?? 5);
const MODE = process.env.MODE ?? "auto";
const env = await setup(Number(process.env.PORT ?? 8601), { viaProxy: true });
try {
  const users = [];
  for (let i = 0; i < N; i++) users.push(await fundedUser(env, 1n * E));
  const dest = (await keysFromMnemonic(newMnemonic())).address;
  const txs = [];
  for (const u of users) { await u.wallet.scan(); txs.push(await u.wallet.buildTransfer(dest, env.local.weth, E / 10n)); }
  log(`built ${N} proofs; relay nonce latest=${await nonceOf(env)} pending=${await nonceOf(env, "pending")}`);

  if (MODE === "interval") {
    await rpc(env.local.rpc, "evm_setAutomine", [false]);
    await rpc(env.local.rpc, "evm_setIntervalMining", [Number(process.env.BLOCK_TIME ?? 2)]);
    log(`anvil: automine off, interval mining ${process.env.BLOCK_TIME ?? 2}s`);
  }
  env.proxy!.counts.clear();
  env.proxy!.latencyMs = Number(process.env.LATENCY_MS ?? 0);
  const STAGGER = Number(process.env.STAGGER_MS ?? 0);
  if (env.proxy!.latencyMs || STAGGER) log(`RPC latency ${env.proxy!.latencyMs}ms per call, submissions staggered by ${STAGGER}ms`);
  const bal0 = await relayBalance(env);

  const results = await Promise.all(txs.map((t, i) => new Promise((r) => setTimeout(r, i * STAGGER)).then(() => submitViaBroadcaster(env.info, t)).then(
    (hash) => ({ i, hash, err: null as string | null }),
    (e) => ({ i, hash: null as any, err: short(e) }),
  )));
  for (const r of results) log(`user ${r.i}: ${r.hash ? "202 hash " + r.hash : "ERROR " + r.err}`);
  log("RPC calls made by relay during the burst:", JSON.stringify(Object.fromEntries(env.proxy!.counts)));
  for (const e of env.proxy!.errors) log(`raw RPC error on ${e.method}: ${e.body}`);
  env.proxy!.latencyMs = 0;

  const outcomes = await Promise.all(results.map(async (r) => {
    if (!r.hash) return { i: r.i, outcome: "rejected at submit" };
    try { return { i: r.i, outcome: await waitForBroadcast(env.info, r.hash, 20_000) }; }
    catch (e) { return { i: r.i, outcome: "client: " + short(e) }; }
  }));
  for (const o of outcomes) log(`user ${o.i}: final = ${o.outcome}`);

  for (let i = 0; i < N; i++) {
    const d = (await import("viem")).decodeFunctionData({ abi: POOL_ABI, data: txs[i].data });
    const nf = (d.args[1] as any).nullifiers as bigint[];
    const spent = await env.local.pub.readContract({ address: env.local.pool, abi: POOL_ABI, functionName: "isNullifierSpent", args: [nf[0]] });
    log(`user ${i}: note spent on chain = ${spent}`);
  }
  const hashes = results.filter((r) => r.hash).map((r) => r.hash);
  const uniq = new Set(hashes);
  log(`distinct hashes returned: ${uniq.size} of ${hashes.length}; relay nonce now latest=${await nonceOf(env)} pending=${await nonceOf(env, "pending")}; relay gas spent ${(bal0 - await relayBalance(env))} wei`);
} finally {
  await env.stop();
}
