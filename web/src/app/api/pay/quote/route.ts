import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { PAY_FEE, PAY_FROM, PAY_MAX, payChain, payQuoteProblem, validRecipient } from "@/lib/pool/payRoutes";
import { configured, limited, sameSiteJson, visitor } from "@/lib/roadmap/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (configured() && (await limited(`pay:rl:${visitor(req)}`, 40))) {
    return NextResponse.json({ error: "Too many quotes. Try again in a bit." }, { status: 429 });
  }
  const b = await req.json().catch(() => ({}));
  const chain = payChain(Number(b.chainId));
  let amount: bigint;
  try { amount = BigInt(b.amount); } catch { amount = 0n; }
  if (!chain || typeof b.recipient !== "string" || !validRecipient(chain, b.recipient) || !isAddress(b.refundTo) || amount <= 0n || amount > PAY_MAX) {
    return NextResponse.json({ error: "Check the chain, address and amount." }, { status: 400 });
  }

  const r = await fetch("https://api.relay.link/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      user: b.refundTo,
      recipient: b.recipient,
      originChainId: PAY_FROM.chainId,
      destinationChainId: chain.id,
      originCurrency: PAY_FROM.token,
      destinationCurrency: chain.usdc,
      amount: amount.toString(),
      tradeType: "EXACT_INPUT",
      useDepositAddress: true,
      refundTo: b.refundTo,
      appFees: [{ recipient: PAY_FEE.recipient, fee: String(PAY_FEE.bps) }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ error: j.message ?? "Relay couldn't quote that." }, { status: 502 });

  const problem = payQuoteProblem(j);
  if (problem) {
    console.warn("[pay] refused a Relay quote:", problem);
    return NextResponse.json({ error: "Relay returned an unexpected route." }, { status: 502 });
  }
  return NextResponse.json({
    requestId: j.requestId,
    depositAddress: j.steps[0].depositAddress,
    amountOut: j.details?.currencyOut?.amount,
    amountOutFormatted: j.details?.currencyOut?.amountFormatted,
    symbolOut: j.details?.currencyOut?.currency?.symbol ?? "USDC",
    timeEstimate: j.details?.timeEstimate ?? null,
    feeUsd: j.fees?.relayer?.amountUsd ?? null,
    appFeeUsd: j.fees?.app?.amountUsd ?? null,
  });
}
