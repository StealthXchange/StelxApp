"use client";

import type { Asset } from "@/lib/pool/assets";

export function AssetPicker({
  assets, value, onChange, detail,
}: {
  assets: Asset[];
  value: Asset;
  onChange: (a: Asset) => void;

  detail?: (a: Asset) => string;
}) {
  const crypto = assets.filter((a) => a.kind !== "stock");
  const stocks = assets.filter((a) => a.kind === "stock");
  const label = (a: Asset) => `${a.symbol} · ${a.name}${detail ? ` · ${detail(a)}` : ""}`;
  return (
    <div className="field">
      <label className="mono field-label">Asset</label>
      <select
        className="mono input"
        value={value.address}
        onChange={(e) => {
          const next = assets.find((a) => a.address === e.target.value);
          if (next) onChange(next);
        }}
      >
        {stocks.length === 0 ? (
          crypto.map((a) => <option key={a.address} value={a.address}>{label(a)}</option>)
        ) : (
          <>
            {crypto.length > 0 && (
              <optgroup label="Crypto">
                {crypto.map((a) => <option key={a.address} value={a.address}>{label(a)}</option>)}
              </optgroup>
            )}
            <optgroup label="Stocks">
              {stocks.map((a) => <option key={a.address} value={a.address}>{label(a)}</option>)}
            </optgroup>
          </>
        )}
      </select>
    </div>
  );
}
