import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const r = await fetch(`https://api.relay.link/intents/status/v2?requestId=${id}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ error: "Couldn't reach Relay." }, { status: 502 });
  return NextResponse.json({
    status: j.status ?? "unknown",
    txHashes: Array.isArray(j.txHashes) ? j.txHashes : [],
  }, { headers: { "Cache-Control": "no-store" } });
}
