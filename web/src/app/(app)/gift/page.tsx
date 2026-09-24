"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import { BROADCASTERS, txUrl } from "@/lib/pool/config";
import { refresh } from "@/lib/pool/walletStore";
import { shortAddr, usePool } from "@/lib/pool/usePool";
import { formatAmount, WETH } from "@/lib/pool/assets";
import { AssetPicker } from "@/components/pool/AssetPicker";
import { useProver, stageLabel } from "@/lib/pool/useProver";
import { type BroadcasterInfo } from "@/lib/pool/vendor/broadcast";
import { pickRelay } from "@/lib/pool/relay";
import { usePoolHealth } from "@/lib/pool/health";
import { submitAndSettle, type Outcome } from "@/lib/pool/outcome";
import { BPS, FEE_BPS } from "@/lib/pool/vendor/wallet";
import { phraseFromFragment } from "@/lib/pool/giftKeys";
import { inspectGift, type GiftContents } from "@/lib/pool/gift";
import { ProvingPanel } from "@/components/pool/ProvingPanel";
import { CheckCircle } from "@/components/icons";

const PENDING = "stelx.gift.pending";

type Read =
  | { phase: "reading" }
  | { phase: "bad" }
  | { phase: "error"; message: string }
  | { phase: "ready"; gift: GiftContents };

export default function GiftPage() {
  const pool = usePool();
  const health = usePoolHealth();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [read, setRead] = useState<Read>({ phase: "reading" });
  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<"wallet" | "public">("wallet");
  const [to, setTo] = useState("");
  const [broadcaster, setBroadcaster] = useState<BroadcasterInfo | null>(null);
  const [bcError, setBcError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const { state, build, reset, setSubmitting } = useProver(phrase);

  useEffect(() => {
    let p = phraseFromFragment(window.location.hash);
    try {
      if (p) window.sessionStorage.setItem(PENDING, window.location.hash);
      else if (!window.location.hash) p = phraseFromFragment(window.sessionStorage.getItem(PENDING) ?? "");
    } catch {  }

    if (p && window.location.hash) {
      try {
        if (window.sessionStorage.getItem(PENDING)) window.history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch {  }
    }
    if (p) setPhrase(p);
    else setRead({ phase: "bad" });
  }, []);

  const look = useCallback(async () => {
    if (!phrase) return;
    setRead({ phase: "reading" });
    try {
      const gift = await inspectGift(phrase);

      if (gift.funded && !gift.holdings.some((h) => h.balance > 0n)) {
        try { window.sessionStorage.removeItem(PENDING); } catch {  }
      }
      setRead({ phase: "ready", gift });
    } catch (e: any) {
      setRead({ phase: "error", message: String(e?.shortMessage ?? e?.message ?? e) });
    }
  }, [phrase]);
  useEffect(() => { void look(); }, [look]);

  useEffect(() => {
    if (BROADCASTERS.length === 0) { setBcError("none"); return; }
    pickRelay(BROADCASTERS).then(setBroadcaster).catch((e) => setBcError(String(e.message)));
  }, []);

  const full = read.phase === "ready" ? read.gift.holdings.filter((h) => h.balance > 0n) : [];
  const current = full.find((h) => h.asset.address === picked) ?? full[0];
  const fee = broadcaster?.fee ?? 0n;

  const feeAssetOk = !current || fee === 0n || current.asset === WETH;
  const amount = current && current.balance > fee ? current.balance - fee : 0n;
  const dest = mode === "wallet" ? pool.address : to.trim();
  const validDest = useMemo(() => (mode === "wallet" ? Boolean(pool.address) : isAddress(to.trim())), [mode, pool.address, to]);
  const canClaim = Boolean(current && amount > 0n && validDest && broadcaster && feeAssetOk && health.status === "ok" && state.stage === "idle");

  function claim() {
    if (!current || !broadcaster || !dest) return;
    build(mode === "wallet" ? "transfer" : "unshield", current.asset.address, dest, amount, broadcaster.address, broadcaster.shieldedAddress, fee);
  }

  async function submit() {
    if (!state.tx || !broadcaster) return;
    setSubmitting();
    const r = await submitAndSettle(broadcaster, state.tx, { hash: setHash, checking: () => setResult("checking") });
    setResult(r.outcome);
    if (r.error) setBcError(r.error);
    if (r.outcome === "success") {
      try { window.sessionStorage.removeItem(PENDING); } catch {  }
      if (mode === "wallet") void refresh();
    }
  }

  function startOver() {
    reset(); setHash(null); setResult(null); setBcError(null);
    void look();
  }

  if (read.phase === "bad") {
    return (
      <div className="wallet-empty">
        <h1 className="wallet-empty-title">That isn&apos;t a gift link</h1>
        <p className="wallet-empty-note">Check it was copied in full. A gift link ends in # and a code.</p>
      </div>
    );
  }

  if (result === "success" && current) {
    return (
      <div className="pane">
        <section className="card" style={{ padding: "22px 26px", borderColor: "var(--accent-border)", display: "flex", gap: 14, alignItems: "flex-start" }}>
          <CheckCircle color="var(--accent)" />
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-mid)" }}>
            <strong style={{ color: "var(--text-hi)", fontWeight: 600 }}>Claimed.</strong>{" "}
            {mode === "wallet"
              ? <>It&apos;s in your STELX wallet. <Link href="/pool" style={{ color: "var(--accent)" }}>Open your wallet</Link>.</>
              : <>Sent to {shortAddr(dest ?? "", 8, 6)}.{hash && <> <a href={txUrl(hash)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>View on explorer</a>.</>}</>}
            <div style={{ fontSize: 13, color: "var(--text-low)", marginTop: 8 }}>
              {mode === "wallet"
                ? "On chain it's a transaction from the broadcaster. You and the amount don't show."
                : "The destination and amount are public. Who sent the gift isn't."}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="pane">
      <h1 className="pane-title">A gift for you</h1>

      {read.phase === "reading" && <p className="hint">Opening the gift…</p>}

      {read.phase === "error" && (
        <>
          <p className="hint warn">Couldn&apos;t read the chain. {read.message}</p>
          <button className="btn btn-ghost" style={{ alignSelf: "center" }} onClick={() => void look()}>Try again</button>
        </>
      )}

      {read.phase === "ready" && !read.gift.funded && (
        <>
          <p className="hint">Nothing in this gift yet. If it was only just sent, give it a minute.</p>
          <button className="btn btn-ghost" style={{ alignSelf: "center" }} onClick={() => void look()}>Check again</button>
        </>
      )}

      {read.phase === "ready" && read.gift.funded && !current && (
        <p className="hint">This gift has already been claimed, or the sender took it back.</p>
      )}

      {current && (
        <>

          <div className="wallet-balance">
            {formatAmount(broadcaster && amount > 0n ? amount : current.balance, current.asset, current.multiplier)}
            <span className="wallet-unit">{current.asset.symbol}</span>
          </div>
          <p className="hint">{current.asset.name}. Whoever claims first gets it, so keep the link to yourself.</p>

          {bcError === "none" && <p className="hint warn">No broadcaster available.</p>}
          {bcError && bcError !== "none" && <p className="hint warn">{bcError}</p>}

          <div className="card pane-card">
            {full.length > 1 && (
              <AssetPicker
                assets={full.map((h) => h.asset)}
                value={current.asset}
                onChange={(a) => setPicked(a.address)}
                detail={(a) => { const h = full.find((o) => o.asset === a)!; return formatAmount(h.balance, a, h.multiplier); }}
              />
            )}

            {mode === "wallet" && pool.address && (
              <div className="field">
                <span className="mono field-label">Into your STELX wallet</span>
                <code className="mono addr-full">{shortAddr(pool.address, 14, 8)}</code>
              </div>
            )}

            {mode === "wallet" && !pool.address && (
              <div className="field">
                <span className="mono field-label">Claim into a STELX wallet</span>
                <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-mid)", margin: 0 }}>
                  Make one here in a minute, then come straight back to claim.
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Link href="/pool/setup?next=/gift" className="btn">Create a wallet</Link>
                  <Link href="/pool/setup?step=recover&next=/gift" className="btn btn-ghost">I have a phrase</Link>
                </div>
              </div>
            )}

            {mode === "public" && (
              <div className="field">
                <label className="mono field-label">To a public address</label>
                <input
                  className="mono input"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                  data-invalid={to.trim() !== "" && !isAddress(to.trim())}
                />
                <span className="hint warn" style={{ textAlign: "left" }}>The amount and this address are public.</span>
              </div>
            )}

            {!feeAssetOk && <span className="hint warn">The relay takes its fee in WETH only, so {current.asset.symbol} can&apos;t go through it yet.</span>}
            {feeAssetOk && broadcaster && current.balance <= fee && <span className="hint warn">This gift doesn&apos;t cover the relay fee.</span>}

            {broadcaster && fee > 0n && (
              <div className="fee-row mono">
                <span>Fee, covered by the gift</span>
                <span>{formatAmount(fee, current.asset, current.multiplier)} {current.asset.symbol}</span>
              </div>
            )}

            {mode === "public" && amount > 0n && (
              <div className="fee-row mono">
                <span>Arrives, less {Number(FEE_BPS) / 100}%</span>
                <span>{formatAmount(amount - (amount * FEE_BPS) / BPS, current.asset, current.multiplier)} {current.asset.symbol}</span>
              </div>
            )}

            {state.stage === "idle" && (mode === "public" || pool.address) && (
              <button className="btn" disabled={!canClaim} onClick={claim}>Claim</button>
            )}

            {state.stage === "idle" && (
              <button
                className="wallet-retry mono"
                style={{ alignSelf: "flex-start", fontSize: 11, letterSpacing: "0.1em" }}
                onClick={() => setMode(mode === "wallet" ? "public" : "wallet")}
              >
                {mode === "wallet" ? "NO STELX WALLET? CLAIM TO A PUBLIC ADDRESS" : "CLAIM INTO A STELX WALLET INSTEAD"}
              </button>
            )}
          </div>

          {state.stage === "error" && /insufficient balance/i.test(state.error ?? "") ? (
            <section className="card pane-card">
              <p className="hint">Someone claimed this gift a moment ago. Nothing was spent.</p>
              <button className="btn btn-ghost" style={{ alignSelf: "center" }} onClick={startOver}>Check the gift again</button>
            </section>
          ) : state.stage !== "idle" && (
            <ProvingPanel
              state={state}
              label={stageLabel(state)}
              onCancel={startOver}
              onConfirm={submit}
              confirmLabel="Claim"
              kind={mode === "wallet" ? "transfer" : "unshield"}
              hash={hash}
              result={result}
            />
          )}
        </>
      )}
    </div>
  );
}
