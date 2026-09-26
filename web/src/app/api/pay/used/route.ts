import { NextResponse } from "next/server";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = new URL(req.url).searchParams.get("user") ?? "";
  if (!isAddress(user)) return NextResponse.json({ error: "Bad address." }, { status: 400 });
  const r = await fetch(`https://api.relay.link/requests/v2?user=${user}&limit=1`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !Array.isArray(j.requests)) return NextResponse.json({ error: "Couldn't reach Relay." }, { status: 502 });
  return NextResponse.json({ used: j.requests.length > 0 }, { headers: { "Cache-Control": "no-store" } });
}
