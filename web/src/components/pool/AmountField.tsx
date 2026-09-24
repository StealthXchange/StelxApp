"use client";

import { amountText, formatAmount, parseAmount, WETH, type Asset } from "@/lib/pool/assets";

export function AmountField({
  value, onChange, balance, fee, label, asset = WETH, multiplier = null,
}: {
  value: string;
  onChange: (v: string) => void;
  balance: bigint;
  fee: bigint;
  label: string;
  asset?: Asset;
  multiplier?: bigint | null;
}) {
  const spendable = balance > fee ? balance - fee : 0n;
  const parsed = value ? parseAmount(value, asset, multiplier) : 0n;
  let pct = spendable > 0n && parsed !== null ? Number((parsed * 100n) / spendable) : 0;
  pct = Math.max(0, Math.min(100, pct));

  const setPct = (p: number) => {
    if (spendable === 0n) return;
    onChange(amountText((spendable * BigInt(Math.round(p))) / 100n, asset, multiplier));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <label className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-low)" }}>{label}</label>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-low)" }}>
          SPENDABLE {formatAmount(spendable, asset, multiplier)} {asset.symbol}
        </span>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <input
          className="mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.0"
          inputMode="decimal"
          style={{

            flex: 1, minWidth: 0, width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6,
            padding: "12px 14px", color: "var(--text-hi)", fontSize: 20,
          }}
        />
        <span style={{ fontSize: 15, color: "var(--text-mid)" }}>{asset.symbol}</span>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        style={{ width: "100%", marginTop: 14, accentColor: "var(--accent)" }}
        aria-label="Portion of your spendable balance"
      />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {[25, 50, 75, 100].map((p) => (
          <button
            key={p}
            className="btn btn-ghost"
            style={{ minHeight: 30, padding: "0 12px", fontSize: 12 }}
            onClick={() => setPct(p)}
          >
            {p === 100 ? "MAX" : `${p}%`}
          </button>
        ))}
      </div>
    </div>
  );
}
