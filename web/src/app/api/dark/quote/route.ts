import { NextResponse } from "next/server";
import { getAddress, isAddress, parseUnits } from "viem";
import {
  DARK_MAX_USD, DARK_MIN_USD, darkQuoteProblem, darkRoute, gasReserve, NATIVE, relayQuoteBody, tipFor, usdIn, withdrawalFor,
} from "@/lib/pool/darkRoutes";
import { configured, limited, sameSiteJson, visitor } from "@/lib/roadmap/server";
import { upstream } from "@/lib/pool/darkUpstream";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (configured() && (await limited(`dark:rl:${visitor(req)}`, 40))) {
    return NextResponse.json({ error: "Too many quotes. Try again in a bit." }, { status: 429 });
  }
  const b = await req.json().catch(() => ({}));
  const route = darkRoute(String(b.route));
  let target: bigint;
  try { target = BigInt(b.target); } catch { target = 0n; }
  if (!route || !isAddress(b.recipient) || !isAddress(b.refundTo) || getAddress(b.recipient) === getAddress(b.refundTo)) {
    return NextResponse.json({ error: "Check the route and addresses." }, { status: 400 });
  }
  const min = parseUnits(route.minTarget, route.decimals);
  const max = parseUnits(route.maxTarget, route.decimals);
  if (target < min || target > max) {
    return NextResponse.json({ error: `Between ${route.minTarget} and ${route.maxTarget} ${route.symbol} per transfer for now.` }, { status: 400 });
  }
  const recipient = getAddress(b.recipient);

  let reserve = 0n;
  if (route.relayCurrency === NATIVE) {
    try {
      const [block, tip] = await Promise.all([
        upstream(route.chainId, "eth_getBlockByNumber", ["latest", false]) as Promise<{ baseFeePerGas: string }>,
        upstream(route.chainId, "eth_maxPriorityFeePerGas", []).catch(() => "0x0") as Promise<string>,
      ]);
      reserve = gasReserve(route, BigInt(block.baseFeePerGas), tipFor(BigInt(tip)));
    } catch {
      return NextResponse.json({ error: `Couldn't read gas on ${route.chainName}. Try again in a moment.` }, { status: 502 });
    }
  }
  const asked = target + reserve;

  const key = process.env.RELAY_API_KEY?.trim();
  const r = await fetch("https://api.relay.link/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "x-api-key": key } : {}) },
    cache: "no-store",
    body: JSON.stringify(relayQuoteBody(route, asked, recipient, getAddress(b.refundTo))),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ error: j.message ?? "Relay couldn't quote that." }, { status: 502 });

  const problem = darkQuoteProblem(j, route, asked, recipient);
  if (problem) {
    console.warn("[dark] refused a Relay quote:", problem);
    return NextResponse.json({ error: "Relay returned an unexpected route." }, { status: 502 });
  }
  const usd = usdIn(j);
  if (usd === null || usd < DARK_MIN_USD || usd > DARK_MAX_USD) {
    const worth = usd === null ? "" : ` That is about $${usd.toFixed(2)}.`;
    return NextResponse.json({ error: `Between $${DARK_MIN_USD} and $${DARK_MAX_USD.toLocaleString("en-US")} per transfer for now.${worth}` }, { status: 400 });
  }
  const d = j.details;
  const amountIn = BigInt(d.currencyIn.amount);
  return NextResponse.json({
    requestId: j.requestId,
    depositAddress: getAddress(j.steps[0].depositAddress),
    route: route.id,
    target: target.toString(),
    reserve: reserve.toString(),
    asked: asked.toString(),
    minOut: String(d.currencyOut.minimumAmount),
    amountIn: amountIn.toString(),
    withdraw: withdrawalFor(amountIn).toString(),
    usdIn: usd,
    gasTopup: route.gasTopupUsd ? String(d.currencyGasTopup.amount) : null,
    gasTopupUsd: route.gasTopupUsd ? Number(d.currencyGasTopup.amountUsd) : null,
    timeEstimate: d.timeEstimate ?? null,
    relayFeeUsd: j.fees?.relayer?.amountUsd ?? null,
    impactPct: d.totalImpact?.percent ?? null,
  });
}
