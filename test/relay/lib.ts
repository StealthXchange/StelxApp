// Scratch harness for relay adversarial experiments. Local anvil only.
import { createServer, request as httpRequest } from "node:http";
import type { Hex } from "viem";
import { encodeFunctionData, decodeFunctionData } from "viem";
import { startLocal, BROADCASTER_MNEMONIC, BROADCASTER_KEY, E, type Local } from "../helpers/local.ts";
import { Wallet, POOL_ABI } from "../../client/src/wallet.ts";
import { keysFromMnemonic, newMnemonic } from "../../client/src/keys.ts";
import { createBroadcaster } from "../../broadcaster/server.ts";
import { fetchBroadcasterInfo, submitViaBroadcaster, waitForBroadcast, type BroadcasterInfo } from "../../client/src/broadcast.ts";
import { shutdownProver } from "../../client/src/prover.ts";

export { Wallet, POOL_ABI, keysFromMnemonic, newMnemonic, createBroadcaster, fetchBroadcasterInfo, submitViaBroadcaster, waitForBroadcast, shutdownProver, BROADCASTER_MNEMONIC, BROADCASTER_KEY, E };
export type { Local, BroadcasterInfo };

const t0 = Date.now();
export const log = (...m: any[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(2)}s]`, ...m);

/** A JSON-RPC proxy in front of anvil that counts calls and can inject failures. */
export interface Proxy {
  url: string;
  counts: Map<string, number>;
  /** Return a status to reply with instead of forwarding, or null to forward. */
  before: (method: string, params: any[]) => number | null;
  /** After forwarding: return a status to reply with instead of the real response (the call DID reach anvil). */
  after: (method: string, params: any[], response: string) => number | null;
  log: { at: number; method: string; status: number }[];
  latencyMs: number;
  errors: { method: string; body: string }[];
  close(): Promise<void>;
}

export async function startProxy(upstream: string, port = 0): Promise<Proxy> {
  const up = new URL(upstream);
  const p: Proxy = {
    url: "", counts: new Map(), before: () => null, after: () => null, log: [], latencyMs: 0, errors: [],
    close: () => new Promise((r) => server.close(() => r())),
  };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    let body: any;
    try { body = JSON.parse(raw); } catch { body = {}; }
    const method = Array.isArray(body) ? "batch" : body.method;
    const params = Array.isArray(body) ? [] : body.params ?? [];
    p.counts.set(method, (p.counts.get(method) ?? 0) + 1);
    if (p.latencyMs) await new Promise((r) => setTimeout(r, p.latencyMs));
    const pre = p.before(method, params);
    if (pre !== null) {
      p.log.push({ at: Date.now(), method, status: pre });
      res.writeHead(pre, { "content-type": "text/plain" });
      return res.end("Too Many Requests");
    }
    const fwd = httpRequest({ hostname: up.hostname, port: up.port, method: "POST", path: "/", headers: { "content-type": "application/json" } }, (ur) => {
      let out = "";
      ur.on("data", (d) => (out += d));
      ur.on("end", () => {
        if (out.includes('"error"')) p.errors.push({ method, body: out.slice(0, 400) });
        const post = p.after(method, params, out);
        if (post !== null) {
          p.log.push({ at: Date.now(), method, status: post });
          res.writeHead(post, { "content-type": "text/plain" });
          return res.end("Too Many Requests");
        }
        p.log.push({ at: Date.now(), method, status: 200 });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(out);
      });
    });
    fwd.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
    fwd.end(raw);
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  p.url = `http://127.0.0.1:${(server.address() as any).port}`;
  return p;
}

export async function rpc(url: string, method: string, params: any[] = []): Promise<any> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

export interface Env {
  local: Local;
  relay: ReturnType<typeof createBroadcaster>;
  relayUrl: string;
  info: BroadcasterInfo;
  proxy?: Proxy;
  stop(): Promise<void>;
}

export async function setup(anvilPort: number, opts: { fee?: bigint; viaProxy?: boolean; ratePerMinute?: number } = {}): Promise<Env> {
  const fee = opts.fee ?? 0n;
  const local = await startLocal(anvilPort, fee);
  const proxy = opts.viaProxy ? await startProxy(local.rpc) : undefined;
  const relay = createBroadcaster({
    rpcUrl: proxy?.url ?? local.rpc, chainId: 31337, pool: local.pool, privateKey: BROADCASTER_KEY,
    fee, mnemonic: BROADCASTER_MNEMONIC, port: 0, ratePerMinute: opts.ratePerMinute ?? 100000,
  });
  const port = await relay.listen();
  const relayUrl = `http://127.0.0.1:${port}`;
  const info = await fetchBroadcasterInfo(relayUrl);
  local.cfg.broadcaster = info.address;
  local.cfg.broadcasterAddress = info.shieldedAddress;
  local.cfg.fee = info.fee;
  return {
    local, relay, relayUrl, info, proxy,
    stop: async () => { await relay.close().catch(() => {}); await proxy?.close(); await shutdownProver(); local.stop(); },
  };
}

export async function fundedUser(env: Env, amount: bigint): Promise<{ mnemonic: string; wallet: Wallet }> {
  const mnemonic = newMnemonic();
  const w = await Wallet.create(mnemonic, env.local.cfg);
  await env.local.send(env.local.depositor, await w.buildShield(env.local.weth, amount));
  return { mnemonic, wallet: w };
}

export async function relayBalance(env: Env): Promise<bigint> {
  return env.local.pub.getBalance({ address: env.info.address });
}

export async function nonceOf(env: Env, tag: "latest" | "pending" = "latest"): Promise<number> {
  return env.local.pub.getTransactionCount({ address: env.info.address, blockTag: tag });
}

export function short(e: any): string { return String(e?.message ?? e).replace(/\s+/g, " ").slice(0, 260); }
