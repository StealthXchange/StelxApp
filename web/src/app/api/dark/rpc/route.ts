import { NextResponse } from "next/server";
import { rpcCallProblem } from "@/lib/pool/darkRpc";
import { UPSTREAM } from "@/lib/pool/darkUpstream";
import { configured, limited, sameSiteJson, visitor } from "@/lib/roadmap/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const chainId = Number(new URL(req.url).searchParams.get("chain"));
  const call = await req.json().catch(() => null);
  const problem = rpcCallProblem(chainId, call);
  if (problem) return NextResponse.json({ jsonrpc: "2.0", id: call?.id ?? null, error: { code: -32601, message: problem } }, { status: 400 });
  if (configured() && (await limited(`dark:rpc:${visitor(req)}`, 3000))) {
    return NextResponse.json({ jsonrpc: "2.0", id: call.id ?? null, error: { code: -32005, message: "Too many requests. Try again in a bit." } }, { status: 429 });
  }
  const r = await fetch(UPSTREAM[chainId], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: call.id ?? 1, method: call.method, params: Array.isArray(call.params) ? call.params : [] }),
  });
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== "object") return NextResponse.json({ jsonrpc: "2.0", id: call.id ?? null, error: { code: -32603, message: "No answer from the chain." } }, { status: 502 });
  return NextResponse.json({ jsonrpc: "2.0", id: call.id ?? null, ...(j.error ? { error: j.error } : { result: j.result }) }, { headers: { "Cache-Control": "no-store" } });
}
