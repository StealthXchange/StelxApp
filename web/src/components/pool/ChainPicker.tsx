"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PAY_CHAINS, type PayChain } from "@/lib/pool/payRoutes";

const POPULAR = [8453, 792703809, 1, 42161];

const BARE = new Set([792703809, 130, 999, 100, 57073, 143]);

export function ChainLogo({ chain, size = 28 }: { chain: PayChain; size?: number }) {
  const bare = BARE.has(chain.id);
  return (

    <img
      src={`/chains/${chain.id}.png`}
      alt=""
      width={size}
      height={size}
      style={{
        width: size, height: size, flex: "none", borderRadius: "50%",
        objectFit: bare ? "contain" : "cover", background: bare ? "#ffffff" : "transparent",
        boxShadow: bare ? "inset 0 0 0 1px var(--border)" : "none",
        padding: bare ? Math.round(size * 0.17) : 0, boxSizing: "border-box",
      }}
    />
  );
}

export function ChainPicker({ value, onChange }: { value: PayChain; onChange: (c: PayChain) => void }) {
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

  const all = useMemo(() => [...PAY_CHAINS].sort((a, b) => a.name.localeCompare(b.name)), []);
  const found = q.trim() ? all.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())) : all;
  const popular = POPULAR.map((id) => PAY_CHAINS.find((c) => c.id === id)!).filter(Boolean);

  const pick = (c: PayChain) => { onChange(c); setOpen(false); setQ(""); };

  return (
    <div className="field">
      <label className="mono field-label">Chain</label>
      <button type="button" className="input chain-button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <ChainLogo chain={value} size={24} />
        <span className="mono">{value.name}</span>
        <span className="chain-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <div className="chain-backdrop" onClick={() => setOpen(false)}>
          <div className="chain-sheet" role="dialog" aria-modal="true" aria-label="Choose a chain" onClick={(e) => e.stopPropagation()}>
            <div className="chain-head">
              <span className="mono">Choose a chain</span>
              <button type="button" className="chain-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>
            <input
              ref={search}
              className="input mono"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search chains"
              spellCheck={false}
            />

            {!q.trim() && (
              <>
                <span className="mono field-label">Popular</span>
                <div className="chain-popular">
                  {popular.map((c) => (
                    <button key={c.id} type="button" className="chain-chip" data-active={c.id === value.id} onClick={() => pick(c)}>
                      <ChainLogo chain={c} size={22} />
                      <span className="mono">{c.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <span className="mono field-label">{q.trim() ? `${found.length} found` : "All chains"}</span>
            <div className="chain-list">
              {found.map((c) => (
                <button key={c.id} type="button" className="chain-row" data-active={c.id === value.id} onClick={() => pick(c)}>
                  <ChainLogo chain={c} />
                  <span className="mono">{c.name}</span>
                  {c.id === value.id && <span className="chain-tick" aria-label="Selected">✓</span>}
                </button>
              ))}
              {found.length === 0 && <p className="hint">No chain called that yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
