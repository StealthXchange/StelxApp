import { NextResponse } from "next/server";
import { clean, configured, limited, newId, redis, sameSiteJson, visitor, whoami } from "@/lib/roadmap/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!configured()) return NextResponse.json({ error: "Not set up yet." }, { status: 503 });
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const who = visitor(req);

  if (typeof b.reply === "string" || typeof b.unreply === "string") {
    const me = await whoami();
    if (!me) return NextResponse.json({ error: "Team only." }, { status: 401 });
    if (typeof b.reply === "string") {
      if (!(await redis<number>("HEXISTS", "rm:ideas", b.reply))) return NextResponse.json({ error: "No such idea." }, { status: 404 });
      const text = clean(b.text, 500);
      if (!text) return NextResponse.json({ error: "Empty reply." }, { status: 400 });
      const id = newId();
      await redis("HSET", "rm:ideareplies", `${b.reply}:${id}`, JSON.stringify({ id, idea: b.reply, by: me, at: Date.now(), text }));
      return NextResponse.json({ ok: true });
    }
    const raw = await redis<string | null>("HGET", "rm:ideareplies", b.unreply);
    let mine = false;
    try { mine = Boolean(raw) && JSON.parse(raw!).by === me; } catch {  }
    if (!mine) return NextResponse.json({ error: "Not your reply." }, { status: 403 });
    await redis("HDEL", "rm:ideareplies", b.unreply);
    return NextResponse.json({ ok: true });
  }

  if (typeof b.approve === "string" || typeof b.remove === "string") {
    const me = await whoami();
    if (!me) return NextResponse.json({ error: "Team only." }, { status: 401 });
    const id = b.approve ?? b.remove;
    const raw = await redis<string | null>("HGET", "rm:ideas", id);
    if (!raw) return NextResponse.json({ error: "No such idea." }, { status: 404 });
    if (b.remove) {
      await redis("HDEL", "rm:ideas", id);
      await redis("HDEL", "rm:ideavotes", id);

      const keys = ((await redis<string[]>("HKEYS", "rm:ideareplies")) ?? []).filter((k) => k.startsWith(`${id}:`));
      if (keys.length) await redis("HDEL", "rm:ideareplies", ...keys);
    } else {
      await redis("HSET", "rm:ideas", id, JSON.stringify({ ...JSON.parse(raw), approved: true, by: me }));
    }
    return NextResponse.json({ ok: true });
  }

  if (typeof b.vote === "string") {
    const raw = await redis<string | null>("HGET", "rm:ideas", b.vote);
    if (!raw || !JSON.parse(raw).approved) return NextResponse.json({ error: "No such idea." }, { status: 404 });
    if (await limited(`rm:rl:vote:${who}`, 60)) return NextResponse.json({ error: "Slow down a bit." }, { status: 429 });
    const fresh = await redis<number>("SADD", `rm:voters:${b.vote}`, who);
    if (fresh === 1) await redis("HINCRBY", "rm:ideavotes", b.vote, 1);
    return NextResponse.json({ ok: true, counted: fresh === 1 });
  }

  const text = clean(b.text, 500);
  const from = clean(b.from, 30).replace(/[^A-Za-z0-9_@]/g, "");
  if (text.length < 6) return NextResponse.json({ error: "Say a little more." }, { status: 400 });
  if (await limited(`rm:rl:idea:${who}`, 3)) return NextResponse.json({ error: "That's a few already. Try again in an hour." }, { status: 429 });
  const count = await redis<number>("HLEN", "rm:ideas");
  if (count >= 2000) return NextResponse.json({ error: "Ideas are full for now." }, { status: 503 });
  const id = newId();
  await redis("HSET", "rm:ideas", id, JSON.stringify({ id, text, from, at: Date.now(), approved: false }));
  return NextResponse.json({ ok: true });
}
