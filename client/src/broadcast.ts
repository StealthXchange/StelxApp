// The broadcaster's address and fee are bound into the proof, so fetch them before building a transaction.
import type { Hex } from "viem";
import type { BuiltTx } from "./wallet.ts";

export interface BroadcasterInfo {
  url: string;
  address: Hex;
  /** The relay's stelx1 address. The fee is paid as a note to this key. */
  shieldedAddress: string;
  pool: Hex;
  chainId: number;
  fee: bigint;
}

export async function fetchBroadcasterInfo(url: string): Promise<BroadcasterInfo> {
  const r = await fetch(new URL("/info", url));
  if (!r.ok) throw new Error(`broadcaster ${url}: ${r.status}`);
  const j = await r.json();
  if (!j.shieldedAddress) throw new Error("broadcaster does not publish a shielded address");
  return {
    url, address: j.address, shieldedAddress: j.shieldedAddress,
    pool: j.pool, chainId: Number(j.chainId), fee: BigInt(j.fee),
  };
}

/** First responsive broadcaster from a list. */
export async function pickBroadcaster(urls: string[]): Promise<BroadcasterInfo> {
  const errors: string[] = [];
  for (const u of urls) {
    try { return await fetchBroadcasterInfo(u); } catch (e: any) { errors.push(`${u}: ${e.message}`); }
  }
  throw new Error(`no broadcaster reachable:\n${errors.join("\n")}`);
}

export async function submitViaBroadcaster(info: BroadcasterInfo, tx: BuiltTx): Promise<Hex> {
  const r = await fetch(new URL("/transact", info.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: tx.to, data: tx.data }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`broadcaster rejected: ${j.error}${j.detail ? ` (${j.detail})` : ""}`);
  return j.hash as Hex;
}

export async function waitForBroadcast(info: BroadcasterInfo, hash: Hex, timeoutMs = 60_000): Promise<"success" | "reverted"> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(new URL(`/tx/${hash}`, info.url));
    const j = await r.json();
    if (j.status === "success" || j.status === "reverted") return j.status;
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error("timed out waiting for broadcast");
}
