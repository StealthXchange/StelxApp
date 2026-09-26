import { NextResponse } from "next/server";
import { createPublicClient, getAddress, http, isAddress, parseAbi } from "viem";
import { ONRAMP_RECHECK, onrampChain } from "@/lib/pool/onrampRoutes";
import { configured, limited, sameSiteJson, visitor } from "@/lib/roadmap/server";

export const dynamic = "force-dynamic";

const RPC: Record<number, string> = { 5042: "https://rpc.mainnet.arc.io" };
const BALANCE = parseAbi(["function balanceOf(address a) view returns (uint256)"]);

export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const chain = onrampChain(Number(b.chainId));
  if (!chain || !ONRAMP_RECHECK.has(chain.id) || !RPC[chain.id] || !isAddress(b.depositAddress)) {
    return NextResponse.json({ error: "Check the chain and address." }, { status: 400 });
  }
  const deposit = getAddress(b.depositAddress);
  if (configured() && ((await limited(`onramp:rx:${visitor(req)}`, 60)) || (await limited(`onramp:rx:${deposit}`, 1, 55)))) {
    return NextResponse.json({ error: "Asked a moment ago." }, { status: 429 });
  }

  let balance: bigint;
  try {
    const client = createPublicClient({ transport: http(RPC[chain.id]) });
    balance = await client.readContract({ address: chain.usdc as `0x${string}`, abi: BALANCE, functionName: "balanceOf", args: [deposit] });
  } catch {
    return NextResponse.json({ error: `Couldn't read ${chain.name}.` }, { status: 502 });
  }
  if (balance === 0n) return NextResponse.json({ balance: "0", asked: false });

  const key = process.env.RELAY_API_KEY?.trim();
  const r = await fetch("https://api.relay.link/transactions/deposit-address/reindex", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "x-api-key": key } : {}) },
    cache: "no-store",
    body: JSON.stringify({ chainId: chain.id, depositAddress: deposit, currency: chain.usdc }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) console.warn("[onramp] Relay reindex:", r.status, j.message);
  return NextResponse.json({ balance: balance.toString(), asked: r.ok, message: typeof j.message === "string" ? j.message : null });
}
