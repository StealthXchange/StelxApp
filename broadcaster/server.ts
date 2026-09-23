// Relay that submits pool transact() calls and pays their gas in return for a fee note.
// The pool does not trust it: altering recipient, amount or fee makes the transaction fail.
import { createServer } from "node:http";
import { createPublicClient, createWalletClient, decodeFunctionData, http, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { POOL_ABI } from "../client/src/wallet.ts";
import { keysFromMnemonic } from "../client/src/keys.ts";
import { tryDecryptNote, decodePlaintext } from "../client/src/crypto.ts";
import { commitmentOf } from "../client/src/note.ts";

export interface BroadcasterConfig {
  rpcUrl: string;
  chainId: number;
  pool: Hex;
  privateKey: Hex;
  fee: bigint;
  /** The relay's pool seed. Fees arrive as notes to its shielded address. */
  mnemonic: string;
  port: number;
  /** Requests per minute per client address. */
  ratePerMinute?: number;
}

export function createBroadcaster(cfg: BroadcasterConfig) {
  const account = privateKeyToAccount(cfg.privateKey);
  let keysPromise: ReturnType<typeof keysFromMnemonic> | null = null;
  const relayKeys = () => (keysPromise ??= keysFromMnemonic(cfg.mnemonic));
  const chain = { id: cfg.chainId, name: `chain-${cfg.chainId}`, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } } as const;
  const pub = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  const buckets = new Map<string, { tokens: number; at: number }>();
  const limit = cfg.ratePerMinute ?? 30;

  function allow(ip: string): boolean {
    const now = Date.now();
    const b = buckets.get(ip) ?? { tokens: limit, at: now };
    b.tokens = Math.min(limit, b.tokens + ((now - b.at) / 60000) * limit);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    buckets.set(ip, b);
    return true;
  }

  // Calldata checks only. The declared fee is not proof of payment; see verifyPayment.
  function inspect(to: Hex, data: Hex): { ok: true } | { ok: false; reason: string } {
    if (to.toLowerCase() !== cfg.pool.toLowerCase()) return { ok: false, reason: "not the pool" };
    let decoded;
    try { decoded = decodeFunctionData({ abi: POOL_ABI, data }); } catch { return { ok: false, reason: "not pool calldata" }; }
    if (decoded.functionName !== "transact") return { ok: false, reason: "only transact() is broadcast" };
    const inputs = decoded.args[1] as any;
    if ((inputs.broadcaster as string).toLowerCase() !== account.address.toLowerCase()) return { ok: false, reason: "proof is bound to a different broadcaster" };
    if (BigInt(inputs.fee) < cfg.fee) return { ok: false, reason: `fee below minimum ${cfg.fee}` };
    return { ok: true };
  }

  // The fee note's value, token and owner are private. Payment is proven only by decrypting it and
  // matching its commitment; both are bound by boundParamsHash, so neither can be swapped later.
  async function verifyPayment(inputs: any): Promise<{ ok: true } | { ok: false; reason: string }> {
    const notes = inputs.encryptedNotes as Hex[];
    const commitments = inputs.commitments as readonly bigint[];
    const i = notes.length - 1;   // the fee note is the last output
    if (!notes[i] || notes[i] === "0x") return { ok: false, reason: "no fee note" };

    const bytes = Uint8Array.from(Buffer.from(notes[i].slice(2), "hex"));
    const keys = await relayKeys();
    const plain = tryDecryptNote(keys.viewing.privateKey, bytes);
    if (!plain) return { ok: false, reason: "fee note is not addressed to us" };

    let note;
    try { note = decodePlaintext(keys.spending.publicKey, plain); } catch { return { ok: false, reason: "fee note is malformed" }; }

    const expected = await commitmentOf({
      publicKey: keys.spending.publicKey,
      token: note.token, value: note.value, blinding: note.blinding,
    });
    if (expected !== BigInt(commitments[i])) {
      return { ok: false, reason: "fee note does not match its commitment: not ours, or not that value" };
    }
    if (note.value < cfg.fee) return { ok: false, reason: `fee note pays ${note.value}, below minimum ${cfg.fee}` };
    return { ok: true };
  }

  async function handleTransact(body: any): Promise<{ status: number; json: any }> {
    const to = body?.to as Hex, data = body?.data as Hex;
    if (typeof to !== "string" || typeof data !== "string") return { status: 400, json: { error: "expected { to, data }" } };
    const check = inspect(to, data);
    if (!check.ok) return { status: 400, json: { error: check.reason } };

    const decoded = decodeFunctionData({ abi: POOL_ABI, data });
    const paid = await verifyPayment(decoded.args[1] as any);
    if (!paid.ok) return { status: 400, json: { error: paid.reason } };

    try {
      await pub.call({ account: account.address, to, data });
    } catch (e: any) {
      return { status: 400, json: { error: "simulation reverted", detail: String(e?.shortMessage ?? e?.message ?? e).slice(0, 300) } };
    }

    // Serialized: one signer, one nonce sequence. Signed before sending so the hash is known even if
    // the RPC reply is lost; only an explicit refusal from the node means nothing was sent.
    return serial(async () => {
      let signed: Hex;
      try {
        const request = await wallet.prepareTransactionRequest({ to, data });
        signed = await wallet.signTransaction(request as any);
      } catch (e: any) {
        return { status: 503, json: { error: "relay could not prepare the transaction; nothing was sent", detail: brief(e) } };
      }
      const hash = keccak256(signed);
      try {
        await wallet.sendRawTransaction({ serializedTransaction: signed });
      } catch (e: any) {
        if (/already known|known transaction/i.test(brief(e))) return { status: 202, json: { hash } };
        if (!transportFailure(e)) {
          return { status: 503, json: { error: "relay could not send the transaction; nothing was sent", detail: brief(e) } };
        }
        return { status: 202, json: { hash, uncertain: true } };
      }
      return { status: 202, json: { hash } };
    });
  }

  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }
  const brief = (e: any) => String(e?.details ?? e?.shortMessage ?? e?.message ?? e).slice(0, 300);
  // No answer from the node, as opposed to a refusal, so it may have the transaction.
  // viem nests the transport error; walk the causes.
  const transportFailure = (e: any) => {
    for (let x = e; x; x = x.cause) if (x?.name === "HttpRequestError" || x?.name === "TimeoutError") return true;
    return false;
  };

  const server = createServer(async (req, res) => {
    const ip = req.socket.remoteAddress ?? "?";
    const send = (status: number, json: any) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
    if (!allow(ip)) return send(429, { error: "rate limited" });
    try {
      if (req.method === "GET" && req.url === "/info") {
        const keys = await relayKeys();
        return send(200, {
          address: account.address,
          shieldedAddress: keys.address,
          pool: cfg.pool,
          chainId: cfg.chainId,
          fee: cfg.fee.toString(),
        });
      }
      if (req.method === "GET" && req.url?.startsWith("/tx/")) {
        const hash = req.url.slice(4) as Hex;
        const r = await pub.getTransactionReceipt({ hash }).catch(() => null);
        return send(200, r ? { status: r.status, blockNumber: r.blockNumber.toString() } : { status: "pending" });
      }
      if (req.method === "POST" && req.url === "/transact") {
        let raw = "";
        for await (const chunk of req) { raw += chunk; if (raw.length > 200_000) return send(413, { error: "too large" }); }
        const out = await handleTransact(JSON.parse(raw));
        return send(out.status, out.json);
      }
      send(404, { error: "not found" });
    } catch (e: any) {
      send(500, { error: String(e?.shortMessage ?? e?.message ?? e).slice(0, 300) });
    }
  });

  return {
    address: account.address,
    listen: () => new Promise<number>((resolve) => server.listen(cfg.port, () => resolve((server.address() as any).port))),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// Run directly: node broadcaster/server.ts
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = (k: string, d?: string) => process.env[k] ?? d ?? (() => { throw new Error(`missing env ${k}`); })();
  const b = createBroadcaster({
    rpcUrl: env("RPC_URL"),
    chainId: Number(env("CHAIN_ID")),
    pool: env("POOL") as Hex,
    privateKey: env("BROADCASTER_KEY") as Hex,
    mnemonic: env("BROADCASTER_MNEMONIC"),
    fee: BigInt(env("FEE", "0")),
    port: Number(env("PORT", "8787")),
    // The limiter keys on the socket address, so behind a reverse proxy all clients share one bucket.
    // In that setup, set this high and rate-limit per client at the proxy.
    ratePerMinute: Number(env("RATE_PER_MINUTE", "30")),
  });
  const port = await b.listen();
  console.log(`broadcaster ${b.address} listening on :${port}`);
}
