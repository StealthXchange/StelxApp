import { NextResponse } from "next/server";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = new URL(req.url).searchParams.get("user") ?? "";
  if (!isAddress(user)) return NextResponse.json({ error: "Bad address." }, { status: 400 });
  const r = await fetch(`https://api.relay.link/requests/v2?user=${user}&limit=10`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ error: "Couldn't reach Relay." }, { status: 502 });
  type Tx = { hash?: string; chainId?: number };
  type RelayRequest = { id?: string; status?: string; createdAt?: string; depositAddress?: { depositTxHash?: string }; data?: { inTxs?: Tx[]; outTxs?: Tx[] } };
  const requests = ((Array.isArray(j.requests) ? j.requests : []) as RelayRequest[]).map((q) => ({
    id: String(q.id ?? ""),
    status: String(q.status ?? "unknown"),
    createdAt: q.createdAt ?? null,

    inTx: q.depositAddress?.depositTxHash ?? q.data?.inTxs?.[0]?.hash ?? null,
    inChainId: q.data?.inTxs?.[0]?.chainId ?? null,
    outTx: q.data?.outTxs?.[0]?.hash ?? null,
  }));
  return NextResponse.json({ requests }, { headers: { "Cache-Control": "no-store" } });
}
