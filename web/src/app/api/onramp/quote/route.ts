import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import {
  arrivesAs, GAS_TOPUP_USD, ONRAMP_MAX_USD, ONRAMP_MIN_SLACK, ONRAMP_MIN_USD, ONRAMP_TO, onrampChain, originCurrency, quoteProblem, usdIn,
  type OnrampAsset,
} from "@/lib/pool/onrampRoutes";
import { validRecipient } from "@/lib/pool/payRoutes";
import { configured, limited, sameSiteJson, visitor } from "@/lib/roadmap/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (configured() && (await limited(`onramp:rl:${visitor(req)}`, 40))) {
    return NextResponse.json({ error: "Too many quotes. Try again in a bit." }, { status: 429 });
  }
  const b = await req.json().catch(() => ({}));
  const chain = onrampChain(Number(b.chainId));
  const asset: OnrampAsset | null = b.asset === "usdc" || b.asset === "native" ? b.asset : null;
  let amount: bigint;
  try { amount = BigInt(b.amount); } catch { amount = 0n; }
  if (!chain || !asset || (asset === "native" && !chain.native) || !isAddress(b.recipient) || typeof b.refundTo !== "string" || !validRecipient(chain, b.refundTo) || amount <= 0n) {
    return NextResponse.json({ error: "Check the chain, coin and amount." }, { status: 400 });
  }
  const recipient = getAddress(b.recipient);
  const lands = arrivesAs(chain, asset);
  const key = process.env.RELAY_API_KEY?.trim();
  if (chain.vm === "svm" && !key) return NextResponse.json({ error: `Arriving from ${chain.name} isn't open on this server.` }, { status: 503 });

  const r = await fetch("https://api.relay.link/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "x-api-key": key } : {}) },
    cache: "no-store",
    body: JSON.stringify({
      user: b.refundTo,
      recipient,
      refundTo: b.refundTo,

      recoveryAddress: b.refundTo,
      originChainId: chain.id,
      destinationChainId: ONRAMP_TO.chainId,
      originCurrency: originCurrency(chain, asset),
      destinationCurrency: lands === "usdg" ? ONRAMP_TO.usdg : ONRAMP_TO.eth,
      amount: amount.toString(),
      tradeType: "EXACT_INPUT",
      useDepositAddress: true,
      ...(lands === "usdg" ? { topupGas: true, topupGasAmount: GAS_TOPUP_USD } : {}),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ error: j.message ?? "Relay couldn't quote that." }, { status: 502 });

  const problem = quoteProblem(j, chain, asset, amount, recipient);
  if (problem) {
    console.warn("[onramp] refused a Relay quote:", problem);
    return NextResponse.json({ error: "Relay returned an unexpected route." }, { status: 502 });
  }
  const usd = usdIn(j);
  if (usd === null || usd < ONRAMP_MIN_USD * ONRAMP_MIN_SLACK || usd > ONRAMP_MAX_USD) {
    const worth = usd === null ? "" : ` That is about $${usd.toFixed(2)}.`;
    return NextResponse.json({ error: `Between $${ONRAMP_MIN_USD} and $${ONRAMP_MAX_USD.toLocaleString("en-US")} per arrival for now.${worth}` }, { status: 400 });
  }
  const d = j.details;
  const deposit = String(j.steps[0].depositAddress);

  return NextResponse.json({
    requestId: j.requestId,

    depositAddress: chain.vm === "svm" ? deposit : getAddress(deposit),
    amountIn: amount.toString(),
    usdIn: usd,
    amountOut: String(d.currencyOut.amount),
    symbolOut: lands === "usdg" ? "USDG" : "ETH",
    gasTopup: lands === "usdg" ? String(d.currencyGasTopup.amount) : null,
    timeEstimate: d.timeEstimate ?? null,
    feeUsd: j.fees?.relayer?.amountUsd ?? null,
  });
}
