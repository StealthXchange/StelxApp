"use client";

import Link from "next/link";
import { usePool } from "@/lib/pool/usePool";
import { formatAmount, type Asset } from "@/lib/pool/assets";
import type { Holding } from "@/lib/pool/walletStore";

type Line = { block: bigint; kind: "in" | "out" | "moved"; amount: bigint; holding: Holding };

function fold(holding: Holding): Line[] {
  const byBlock = new Map<bigint, { in: bigint; out: bigint }>();
  for (const h of holding.history) {
    const b = byBlock.get(h.blockNumber) ?? { in: 0n, out: 0n };
    if (h.kind === "received") b.in += h.value;
    else b.out += h.value;
    byBlock.set(h.blockNumber, b);
  }
  return [...byBlock.entries()].map(([block, { in: i, out: o }]) => {
    const net = i - o;
    return { block, kind: net > 0n ? "in" : net < 0n ? "out" : "moved", amount: net < 0n ? -net : net, holding };
  });
}

const amount = (r: Line, a: Asset) => `${formatAmount(r.amount, a, r.holding.multiplier)} ${a.symbol}`;

export default function ActivityPage() {
  const pool = usePool();

  if (!pool.address) {
    return (
      <div className="wallet-empty">
        <h1 className="wallet-empty-title">No wallet here yet</h1>
        <Link href="/pool/setup" className="btn">Create a wallet</Link>
      </div>
    );
  }

  const rows = pool.holdings.flatMap(fold).sort((a, b) => (a.block < b.block ? 1 : a.block > b.block ? -1 : 0));

  return (
    <div className="wallet">
      <h1 className="pane-title">Activity</h1>

      {rows.length === 0 ? (
        <p className="hint">Nothing yet.</p>
      ) : (
        <div className="card rows">
          {rows.map((r) => (
            <div key={`${r.block}-${r.holding.asset.address}`} className="row">
              <div className="row-main">
                <span className="mono row-kind">{r.kind === "in" ? "RECEIVED" : r.kind === "out" ? "SENT" : "MOVED"}</span>
                <span className="mono row-note">block {String(r.block)}</span>
              </div>
              <span className={r.kind === "in" ? "row-amt in" : "row-amt out"}>
                {r.kind === "in" ? "+" : r.kind === "out" ? "−" : ""}{amount(r, r.holding.asset)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
