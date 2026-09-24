import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ROBINHOOD = "https://api.robinhood.com/rhj/prices";
const CHAIN_ID = 4663;
const FRESH_MS = 30_000;
const STALE_MS = 10 * 60_000;

type Prices = { at: number; eth: number | null; tokens: Record<string, number> };

const good: { tokens?: { v: Record<string, number>; at: number }; eth?: { v: number; at: number } } = {};
let checked = 0;

const positive = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const get = async (url: string) => {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
};

async function stocks(): Promise<Record<string, number>> {
  const { quotes } = await get(ROBINHOOD);
  const out: Record<string, number> = {};
  for (const q of Array.isArray(quotes) ? quotes : []) {
    const bid = positive(q?.tokenBid), ask = positive(q?.tokenAsk);
    if (!bid || !ask || q?.currency !== "USD") continue;
    for (const d of Array.isArray(q.deployments) ? q.deployments : []) {
      if (d?.chainId === CHAIN_ID && /^0x[0-9a-fA-F]{40}$/.test(d.contractAddress ?? "")) {
        out[d.contractAddress.toLowerCase()] = (bid + ask) / 2;
      }
    }
  }
  if (!Object.keys(out).length) throw new Error("Robinhood returned no prices");
  return out;
}

async function eth(): Promise<number> {
  try {
    const p = positive((await get("https://api.coinbase.com/v2/prices/ETH-USD/spot"))?.data?.amount);
    if (p) return p;
  } catch {}
  const p = positive((await get("https://api.kraken.com/0/public/Ticker?pair=ETHUSD"))?.result?.XETHZUSD?.c?.[0]);
  if (!p) throw new Error("no ETH price");
  return p;
}

export async function GET() {
  const now = Date.now();
  if (now - checked > FRESH_MS) {
    checked = now;
    const [t, e] = await Promise.allSettled([stocks(), eth()]);
    if (t.status === "fulfilled") good.tokens = { v: t.value, at: now };
    if (e.status === "fulfilled") good.eth = { v: e.value, at: now };
  }

  const tokens = good.tokens && now - good.tokens.at < STALE_MS ? good.tokens : null;
  const ethp = good.eth && now - good.eth.at < STALE_MS ? good.eth : null;
  if (!tokens && !ethp) return NextResponse.json({ error: "prices unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  const body: Prices = {
    at: Math.min(tokens?.at ?? now, ethp?.at ?? now),
    eth: ethp?.v ?? null,
    tokens: tokens?.v ?? {},
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" } });
}
