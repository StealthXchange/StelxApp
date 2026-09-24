"use client";

import { formatAmount } from "@/lib/pool/assets";
import { formatUsd, PRICE_NOTE, usdValue, type Prices } from "@/lib/pool/prices";
import type { Holding } from "@/lib/pool/walletStore";

export const PRICE_TITLE =
  "Mid price from Robinhood's quotes. stelx.app fetches every price at once, for everyone; your wallet never says what it holds.";

export function Holdings({ holdings, prices, onPick }: { holdings: Holding[]; prices: Prices | null; onPick: (address: string) => void }) {
  const valued = holdings
    .map((h) => ({ h, usd: usdValue(h.balance, h.asset, prices) }))
    .sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  const total = valued.reduce((s, v) => s + (v.usd ?? 0), 0);
  const unpriced = valued.filter((v) => v.usd === null && v.h.balance > 0n).length;

  return (
    <div className="card rows">
      {prices && (
        <div className="row" title={PRICE_TITLE}>
          <div className="row-main">
            <span className="mono row-kind">TOTAL</span>
            {(unpriced > 0 || PRICE_NOTE) && (
              <span className="mono row-note">{unpriced > 0 ? `${unpriced} WITHOUT A PRICE` : PRICE_NOTE}</span>
            )}
          </div>
          <span className="row-amt row-total">{formatUsd(total)}</span>
        </div>
      )}
      {valued.map(({ h, usd }) => (
        <button
          key={h.asset.address}
          className="row"
          onClick={() => onPick(h.asset.address)}
          style={{ width: "100%", background: "none", border: 0, cursor: "pointer", textAlign: "left", color: "inherit", font: "inherit" }}
        >
          <div className="row-main">
            <span className="mono row-kind">{h.asset.symbol}</span>
            <span className="mono row-note">{h.asset.name}</span>
          </div>
          <span className="row-val">
            <span className="row-amt">{formatAmount(h.balance, h.asset, h.multiplier)}</span>
            {usd !== null && <span className="mono row-usd">{formatUsd(usd)}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}
