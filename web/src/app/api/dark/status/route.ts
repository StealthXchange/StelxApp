import { NextResponse } from "next/server";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = q.get("id") ?? "";
  const deposit = q.get("deposit") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(id) || !isAddress(deposit)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const key = process.env.RELAY_API_KEY?.trim();

  const [intent, byDeposit] = await Promise.all([
    fetch(`https://api.relay.link/intents/status/v3?requestId=${id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(key ? `https://api.relay.link/requests/v3?depositAddress=${deposit}&limit=5` : `https://api.relay.link/requests/v2?depositAddress=${deposit}&limit=5`, {
      cache: "no-store",
      headers: key ? { "x-api-key": key } : {},
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  type Tx = { hash?: string; chainId?: number };
  type RelayRequest = { id?: string; status?: string; createdAt?: string; data?: { inTxs?: Tx[]; outTxs?: Tx[] } };
  const requests = ((Array.isArray(byDeposit?.requests) ? byDeposit.requests : []) as RelayRequest[]).map((r) => ({
    id: String(r.id ?? ""),
    status: String(r.status ?? "unknown"),
    createdAt: r.createdAt ?? null,
    inTx: r.data?.inTxs?.[0]?.hash ?? null,
    outTx: r.data?.outTxs?.[0]?.hash ?? null,
    outChainId: r.data?.outTxs?.[0]?.chainId ?? null,
  }));
  if (!intent && !byDeposit) return NextResponse.json({ error: "Couldn't reach Relay." }, { status: 502 });
  return NextResponse.json({
    status: String(intent?.status ?? "unknown"),
    txHashes: Array.isArray(intent?.txHashes) ? intent.txHashes : [],
    requests,
  }, { headers: { "Cache-Control": "no-store" } });
}
