import { NextResponse } from "next/server";
import { clean, configured, mentionsIn, newId, redis, sameSiteJson, whoami } from "@/lib/roadmap/server";

export const dynamic = "force-dynamic";

const parse = (rows: string[] | null) => (rows ?? []).flatMap((r) => { try { return [JSON.parse(r)]; } catch { return []; } });

export async function GET() {
  if (!configured()) return NextResponse.json({ chat: [] });
  const me = await whoami();
  const [chat, seen] = await Promise.all([
    redis<string[]>("LRANGE", "rm:chat", 0, 199),
    me ? redis<string | null>("GET", `rm:seen:${me}`) : Promise.resolve(null),
  ]);
  return NextResponse.json({ chat: parse(chat), seen: Number(seen ?? 0) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const me = await whoami();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.seen === true) {
    await redis("SET", `rm:seen:${me}`, Date.now());
    return NextResponse.json({ ok: true });
  }
  const text = clean(body.text, 1000);
  if (!text) return NextResponse.json({ error: "Empty message." }, { status: 400 });
  const msg = { id: newId(), by: me, at: Date.now(), text, mentions: mentionsIn(text), idea: body.idea === true };
  await redis("LPUSH", "rm:chat", JSON.stringify(msg));
  await redis("LTRIM", "rm:chat", 0, 999);
  return NextResponse.json({ msg });
}
