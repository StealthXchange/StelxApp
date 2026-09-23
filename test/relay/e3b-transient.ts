// Checks whether a transient RPC failure makes the relay report failure while the transaction still mines.
// The proxy lets the send reach anvil but replaces its response with a 429 once, so viem retries into "nonce too low".
import { setup, fundedUser, keysFromMnemonic, newMnemonic, submitViaBroadcaster, waitForBroadcast, log, short, POOL_ABI, E } from "./lib.ts";
import { decodeFunctionData } from "viem";

const env = await setup(Number(process.env.PORT ?? 8630), { viaProxy: true });
try {
  const u = await fundedUser(env, 1n * E);
  await u.wallet.scan();
  const dest = (await keysFromMnemonic(newMnemonic())).address;
  const tx = await u.wallet.buildTransfer(dest, env.local.weth, E / 10n);
  const nf = (decodeFunctionData({ abi: POOL_ABI, data: tx.data }).args[1] as any).nullifiers as bigint[];

  let sends = 0;
  env.proxy!.after = (m) => {
    if (m === "eth_sendRawTransaction") { sends++; log(`  send attempt #${sends} -> ${sends === 1 ? "429" : "forward"}`); if (sends === 1) return 429; }
    return null;
  };
  let clientErr: string | null = null, hash: string | null = null;
  try { hash = await submitViaBroadcaster(env.info, tx); }
  catch (e) { clientErr = short(e); }
  log(`sendRawTransaction reached anvil ${sends} time(s)`);
  log(hash ? `client got 202 ${hash}` : `client got ERROR: ${clientErr}`);

  await new Promise((r) => setTimeout(r, 1500));
  const spent = await env.local.pub.readContract({ address: env.local.pool, abi: POOL_ABI, functionName: "isNullifierSpent", args: [nf[0]] });
  log(`note ACTUALLY spent on chain: ${spent}`);
  if (!hash && spent) log("=> RELAY REPORTED FAILURE BUT THE USER'S NOTE WAS SPENT. Client shows 'did not go through / notes untouched'.");
  if (hash) { try { log(`waitForBroadcast: ${await waitForBroadcast(env.info, hash, 10000)}`); } catch (e) { log(`waitForBroadcast: ${short(e)}`); } }
} finally {
  await env.stop();
}
