import { NextResponse } from "next/server";
import { configured, redis, whoami } from "@/lib/roadmap/server";

export const dynamic = "force-dynamic";

const parse = <T,>(rows: string[] | null): T[] => (rows ?? []).flatMap((r) => { try { return [JSON.parse(r) as T]; } catch { return []; } });

export async function GET() {
  if (!configured()) return NextResponse.json({ ready: false });
  const me = await whoami();
  const [notes, ticks, status, dev] = await Promise.all([
    redis<string[]>("LRANGE", "rm:notes", 0, 499),
    redis<string[]>("HGETALL", "rm:ticks"),
    redis<string[]>("HGETALL", "rm:status"),
    redis<string[]>("HGETALL", "rm:dev"),
  ]);
  const pairs = (a: string[] | null) => Object.fromEntries((a ?? []).flatMap((v, i, arr) => (i % 2 ? [] : [[v, arr[i + 1]]])));

  const [ideaRows, votes, replyRows] = await Promise.all([
    redis<string[]>("HVALS", "rm:ideas"), redis<string[]>("HGETALL", "rm:ideavotes"), redis<string[]>("HVALS", "rm:ideareplies"),
  ]);
  const voteMap = pairs(votes);

  type Reply = { id: string; idea: string; by: string; at: number; text: string };
  const replies = new Map<string, Reply[]>();
  for (const r of parse<Reply>(replyRows).sort((a, b) => a.at - b.at)) replies.set(r.idea, [...(replies.get(r.idea) ?? []), r]);
  const ideas = parse<{ id: string; text: string; from: string; at: number; approved: boolean }>(ideaRows)
    .filter((i) => i.approved || me)
    .map((i) => ({ ...i, votes: Number(voteMap[i.id] ?? 0), replies: replies.get(i.id) ?? [] }))
    .sort((a, b) => Number(a.approved) - Number(b.approved) || b.votes - a.votes || b.at - a.at);
  const out: Record<string, unknown> = { ready: true, me, notes: parse(notes), ticks: pairs(ticks), status: pairs(status), dev: pairs(dev), ideas };

  out.chat = parse(await redis<string[]>("LRANGE", "rm:chat", 0, 199));
  if (me) out.seen = Number((await redis<string | null>("GET", `rm:seen:${me}`)) ?? 0);
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
