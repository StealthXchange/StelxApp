import { NextResponse } from "next/server";
import { handles, redis, sameSiteJson, whoami } from "@/lib/roadmap/server";
import { ITEMS, STATUS_LABEL } from "@/app/roadmap/items";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const me = await whoami();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const item = ITEMS.find((i) => i.id === b.itemId);
  if (!item) return NextResponse.json({ error: "No such item." }, { status: 400 });

  if (Number.isInteger(b.milestone) && b.milestone >= 0 && b.milestone < item.milestones.length && typeof b.done === "boolean") {
    await redis("HSET", "rm:ticks", `${item.id}:${b.milestone}`, b.done ? "1" : "0");
  } else if (typeof b.status === "string" && Object.hasOwn(STATUS_LABEL, b.status)) {
    await redis("HSET", "rm:status", item.id, b.status);
  } else if (typeof b.dev === "string" && handles().includes(b.dev)) {
    await redis("HSET", "rm:dev", item.id, b.dev);
  } else {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
