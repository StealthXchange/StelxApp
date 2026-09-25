"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset } from "@/lib/pool/assets";
import { LOGO_ON_DARK, NO_LOGO } from "@/lib/pool/assetLogos";

export function AssetLogo({ asset, size = 28 }: { asset: Asset; size?: number }) {
  const ring = { width: size, height: size, flex: "none" as const, borderRadius: "50%", boxSizing: "border-box" as const };
  if (NO_LOGO.has(asset.symbol)) {
    return (
      <span className="mono" style={{ ...ring, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--accent-dim)", color: "var(--accent)", fontSize: size * 0.3, fontWeight: 700 }}>
        {asset.symbol.slice(0, 4)}
      </span>
    );
  }
  const dark = LOGO_ON_DARK.has(asset.symbol);
  return (

    <img
      src={`/assets/${asset.symbol}.png`}
      alt=""
      width={size}
      height={size}
      style={{ ...ring, objectFit: "contain", padding: Math.round(size * 0.14), background: dark ? "#151613" : "#ffffff", boxShadow: dark ? "none" : "inset 0 0 0 1px var(--border)" }}
    />
  );
}

export function AssetPicker({
  assets, value, onChange, detail,
}: {
  assets: Asset[];
  value: Asset;
  onChange: (a: Asset) => void;

  detail?: (a: Asset) => string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    search.current?.focus();
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = overflow; };
  }, [open]);

  const term = q.trim().toLowerCase();
  const match = (a: Asset) => !term || a.symbol.toLowerCase().includes(term) || a.name.toLowerCase().includes(term);
  const crypto = assets.filter((a) => a.kind !== "stock" && match(a));
  const stocks = useMemo(() => assets.filter((a) => a.kind === "stock").sort((a, b) => a.symbol.localeCompare(b.symbol)), [assets]).filter(match);
  const pick = (a: Asset) => { onChange(a); setOpen(false); setQ(""); };

  const row = (a: Asset) => (
    <button key={a.address} type="button" className="chain-row" data-active={a.address === value.address} onClick={() => pick(a)}>
      <AssetLogo asset={a} />
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span className="mono">{a.symbol}</span>
        <span style={{ fontSize: 11.5, color: "var(--text-low)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
      </span>
      <span className="mono" style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-mid)", flex: "none" }}>
        {detail ? detail(a) : a.address === value.address ? "✓" : ""}
      </span>
    </button>
  );

  return (
    <div className="field">
      <label className="mono field-label">Asset</label>
      <button type="button" className="input chain-button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <AssetLogo asset={value} size={24} />
        <span className="mono">{value.symbol}</span>
        <span style={{ fontSize: 12.5, color: "var(--text-low)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value.name}</span>
        {detail && <span className="mono" style={{ fontSize: 12, color: "var(--text-mid)", flex: "none" }}>{detail(value)}</span>}
        <span className="chain-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="chain-backdrop" onClick={() => setOpen(false)}>
          <div className="chain-sheet" role="dialog" aria-modal="true" aria-label="Choose an asset" onClick={(e) => e.stopPropagation()}>
            <div className="chain-head">
              <span className="mono">Choose an asset</span>
              <button type="button" className="chain-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <input ref={search} className="input mono" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by ticker or name" spellCheck={false} />
            <div className="chain-list">
              {crypto.length > 0 && <span className="mono field-label" style={{ padding: "6px 8px 2px" }}>Crypto</span>}
              {crypto.map(row)}
              {stocks.length > 0 && <span className="mono field-label" style={{ padding: "10px 8px 2px" }}>Stocks · {stocks.length}</span>}
              {stocks.map(row)}
              {crypto.length + stocks.length === 0 && <p className="hint">Nothing matches that.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
