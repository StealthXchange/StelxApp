"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, CheckCircle, Refresh } from "@/components/icons";
import { refresh } from "@/lib/pool/walletStore";
import { shortAddr, usePool } from "@/lib/pool/usePool";
import { ASSETS, formatAmount, WETH } from "@/lib/pool/assets";
import { formatUsd, PRICE_NOTE, usdValue, usePrices } from "@/lib/pool/prices";
import { Holdings, PRICE_TITLE } from "@/components/pool/Holdings";

const STOCKS = ASSETS.filter((a) => a.kind === "stock");

const TILES = [
  { href: "/pool/shield", label: "Deposit", icon: DepositIcon },
  { href: "/pool/send", label: "Send", icon: SendIcon },
  { href: "/pool/unshield", label: "Withdraw", icon: WithdrawIcon },
  { href: "/pool/activity", label: "Activity", icon: ActivityIcon },
  { href: "/pool/receive", label: "Receive", icon: ReceiveIcon },
  { href: "/pool/gift", label: "Gift", icon: GiftIcon },
];

export default function PoolOverviewPage() {
  const pool = usePool();
  const [copied, setCopied] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const main = pool.holdings.find((h) => h.asset.address === picked) ?? pool.holdings[0];
  const asset = main?.asset ?? WETH;

  const unknown = pool.phase === "scanning" || pool.phase === "error";
  const prices = usePrices();
  const mainUsd = main ? usdValue(main.balance, asset, prices) : null;

  if (pool.phase === "empty" && !pool.address) {
    return (
      <div className="wallet-empty">
        <h1 className="wallet-empty-title">No wallet in this browser</h1>

        <p className="wallet-empty-note">
          Your wallet lives in the browser tab, not on a server. A new or closed tab clears it unless you
          chose to stay signed in. Your funds are untouched: your phrase brings them back.
        </p>
        <div className="wallet-empty-actions">
          <Link href="/pool/setup?step=recover" className="btn">I have a phrase</Link>
          <Link href="/pool/setup" className="btn btn-ghost">Create a wallet</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet">
      <div className="wallet-bar">
        <button
          className="wallet-addr"
          onClick={() => {
            navigator.clipboard?.writeText(pool.address ?? "");
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
          title="Copy your pool address"
        >
          <span className="mono">{copied ? "COPIED" : shortAddr(pool.address ?? "", 12, 6)}</span>
        </button>
        <button className="wallet-rescan" onClick={() => void refresh()} disabled={pool.phase === "scanning"}>
          <Refresh color="currentColor" />
        </button>
      </div>

      <div className="wallet-mode mono">PRIVATE MODE</div>

      <div className="wallet-balance">
        {unknown || !main ? <span className="wallet-dim">—</span> : formatAmount(main.balance, asset, main.multiplier)}
        <span className="wallet-unit">{asset.symbol}</span>
      </div>

      {!unknown && mainUsd !== null && main.balance > 0n && (
        <div className="wallet-usd mono" title={PRICE_TITLE}>
          ≈ {formatUsd(mainUsd)}{PRICE_NOTE && <span className="wallet-usd-note"> · {PRICE_NOTE}</span>}
        </div>
      )}

      <div className="wallet-grid">
        {TILES.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={asset !== WETH && (href === "/pool/send" || href === "/pool/unshield" || href === "/pool/gift") ? `${href}?asset=${asset.symbol}` : href}
            className="wallet-tile"
          >
            <Icon />
            <span className="mono">{label}</span>
          </Link>
        ))}
      </div>

      {!unknown && STOCKS.length > 0 && !pool.holdings.some((h) => h.asset.kind === "stock") && (
        <Link href="/pool/shield?asset=AAPL" className="wallet-status" style={{ textDecoration: "none" }}>
          <span className="mono">
            DEPOSIT STOCKS · AAPL, TSLA, NVDA AND {STOCKS.length - 3} MORE →
          </span>
        </Link>
      )}

      {!unknown && pool.holdings.length > 1 && (
        <Holdings holdings={pool.holdings} prices={prices} onPick={setPicked} />
      )}

      {pool.phase === "error" ? (
        <div className="wallet-status">
          <AlertTriangle color="var(--amber)" />
          <span className="mono">
            COULDN&apos;T SYNC.{" "}
            <button className="wallet-retry mono" onClick={() => void refresh()}>RETRY</button>
          </span>
        </div>
      ) : (
        <div className="wallet-status">
          <CheckCircle color="var(--accent)" />
          <span className="mono">
            {pool.phase === "scanning" ? "SYNCING" : `SYNCED · ${pool.leaves} NOTES IN POOL`}
          </span>
        </div>
      )}

      {pool.phase === "error" && <div className="wallet-error mono">{pool.error}</div>}
    </div>
  );
}

const S = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function DepositIcon() {
  return <svg {...S}><path d="M12 3v11m0 0 4-4m-4 4-4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>;
}
function SendIcon() {
  return <svg {...S}><path d="M12 21V10m0 0 4 4m-4-4-4 4" /><path d="M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" /></svg>;
}
function WithdrawIcon() {
  return <svg {...S}><path d="M4 12h13m0 0-4-4m4 4-4 4" /><path d="M20 4v16" /></svg>;
}
function ActivityIcon() {
  return <svg {...S}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
}
function ReceiveIcon() {
  return <svg {...S}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3m4 4v-7m-7 7h3" /></svg>;
}
function GiftIcon() {
  return <svg {...S}><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7M12 8v13" /><path d="M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5M12 8s1.5-5 4-5a2.5 2.5 0 0 1 0 5" /></svg>;
}
