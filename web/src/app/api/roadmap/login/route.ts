import { NextResponse } from "next/server";
import { configured, endSession, handles, limited, passwordOk, sameSiteJson, startSession, visitor } from "@/lib/roadmap/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!configured()) return NextResponse.json({ error: "Team area isn't set up yet." }, { status: 503 });
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  if (await limited(`rm:rl:login:${visitor(req)}`, 8, 900)) {
    return NextResponse.json({ error: "Too many tries. Wait 15 minutes." }, { status: 429 });
  }
  const { name, password } = await req.json().catch(() => ({}));
  if (!handles().includes(name) || !passwordOk(password)) {
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }
  await startSession(name);
  return NextResponse.json({ me: name });
}

export async function DELETE(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  await endSession();
  return NextResponse.json({ me: null });
}
