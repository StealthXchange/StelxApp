import { NextResponse } from "next/server";
import { clean, newId, redis, sameSiteJson, whoami } from "@/lib/roadmap/server";
import { ITEMS } from "@/app/roadmap/items";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const me = await whoami();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const text = clean(body.text, 1000);
  if (!ITEMS.some((i) => i.id === body.itemId) || !text) return NextResponse.json({ error: "Empty note." }, { status: 400 });
  const note = { id: newId(), itemId: body.itemId, by: me, at: Date.now(), text };
  await redis("LPUSH", "rm:notes", JSON.stringify(note));
  await redis("LTRIM", "rm:notes", 0, 499);
  return NextResponse.json({ note });
}

export async function DELETE(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const me = await whoami();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  const rows = (await redis<string[]>("LRANGE", "rm:notes", 0, 499)) ?? [];
  const row = rows.find((r) => { try { const n = JSON.parse(r); return n.id === id && n.by === me; } catch { return false; } });
  if (!row) return NextResponse.json({ error: "Not your note." }, { status: 403 });
  await redis("LREM", "rm:notes", 1, row);
  return NextResponse.json({ ok: true });
}
