"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { isAddress } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { refusedBeforeSending, waitForSpent, type Outcome } from "@/lib/pool/outcome";
import { BROADCASTERS } from "@/lib/pool/config";
import { refresh, revealSeed } from "@/lib/pool/walletStore";
import { usePool } from "@/lib/pool/usePool";
import { assetOf, formatAmount, parseAmount } from "@/lib/pool/assets";
import { useProver, stageLabel } from "@/lib/pool/useProver";
import { submitViaBroadcaster, waitForBroadcast, type BroadcasterInfo } from "@/lib/pool/vendor/broadcast";
import { pickRelay } from "@/lib/pool/relay";
import { usePoolHealth } from "@/lib/pool/health";
import { BPS, FEE_BPS } from "@/lib/pool/vendor/wallet";
import { ProvingPanel } from "@/components/pool/ProvingPanel";
import { AmountField } from "@/components/pool/AmountField";
import { PAY_CHAINS, PAY_FROM, PAY_MAX, payChain } from "@/lib/pool/payRoutes";

interface Quote {
  requestId: `0x${string}`;
  depositAddress: `0x${string}`;
  amountOutFormatted: string;
  symbolOut: string;
  timeEstimate: number | null;
  feeUsd: string | null;
  at: number;
}

const QUOTE_MS = 25_000;
const QUICK = ["10", "25", "50", "100"];

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
  return j;
}

export default function PayAnywherePage() {
  const pool = usePool();
  const usdg = assetOf(PAY_FROM.token);
  const holding = pool.holdings.find((h) => h.asset.address.toLowerCase() === PAY_FROM.token.toLowerCase());
  const balance = holding?.balance ?? 0n;

  const [chainId, setChainId] = useState(PAY_CHAINS[0].id);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [broadcaster, setBroadcaster] = useState<BroadcasterInfo | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const [delivery, setDelivery] = useState<{ status: string; tx?: string } | null>(null);
  const seed = revealSeed();
  const { state, build, reset, setSubmitting } = useProver(seed);
  const health = usePoolHealth();
  const chain = payChain(chainId)!;

  const noRelay = BROADCASTERS.length === 0;
  useEffect(() => {
    if (noRelay) return;
    pickRelay(BROADCASTERS).then(setBroadcaster).catch((e) => setErr(String(e.message)));
  }, [noRelay]);

  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setQuote(null); };

  const parsed = useMemo(() => (amount && usdg ? parseAmount(amount, usdg, null) : null), [amount, usdg]);
  const fee = broadcaster?.fee ?? 0n;

  const arriving = parsed !== null ? parsed - (parsed * FEE_BPS) / BPS : null;
  const enough = parsed !== null && parsed + fee <= balance;
  const validTo = to.trim() ? isAddress(to.trim()) : null;

  const feeOk = fee === 0n;
  const ready = Boolean(usdg && validTo && parsed && parsed > 0n && parsed <= PAY_MAX && enough && broadcaster && feeOk && health.status === "ok");

  const refundTo = useMemo(() => { try { return seed ? mnemonicToAccount(seed).address : null; } catch { return null; } }, [seed]);

  async function getQuote(): Promise<Quote | null> {
    if (!ready || arriving === null || !refundTo) return null;
    setQuoting(true); setErr(null);
    try {
      const q = await post("/api/pay/quote", { chainId, recipient: to.trim(), amount: arriving.toString(), refundTo });
      const fresh = { ...q, at: Date.now() } as Quote;
      setQuote(fresh);
      return fresh;
    } catch (e) { setErr(String((e as Error).message)); return null; }
    finally { setQuoting(false); }
  }

  async function pay() {

    const q = quote && Date.now() - quote.at < QUOTE_MS ? quote : await getQuote();
    if (!q || !usdg || !broadcaster || parsed === null) return;
    build("unshield", usdg.address, q.depositAddress, parsed, broadcaster.address, broadcaster.shieldedAddress, fee);
  }

  async function submit() {
    if (!state.tx || !broadcaster || !quote) return;
    setSubmitting();
    try {
      const h = await submitViaBroadcaster(broadcaster, state.tx as never);
      setHash(h);
      const r = await waitForBroadcast(broadcaster, h);
      setResult(r);
      if (r === "success") { void follow(quote.requestId); await refresh(); }
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      setErr(msg);
      if (refusedBeforeSending(msg)) { setResult("refused"); return; }
      setResult("checking");
      if (await waitForSpent((state.tx as { data: `0x${string}` }).data)) { setResult("success"); void follow(quote.requestId); await refresh(); }
      else setResult("unknown");
    }
  }

  async function follow(id: string) {
    setDelivery({ status: "waiting" });
    const until = Date.now() + 10 * 60_000;
    while (Date.now() < until) {
      try {
        const r = await fetch(`/api/pay/status?id=${id}`, { cache: "no-store" });
        const j = await r.json();
        setDelivery({ status: j.status, tx: j.txHashes?.[0] });
        if (["success", "failure", "refund", "refunded"].includes(j.status)) return;
      } catch {  }
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  if (!pool.address) {
    return (
      <div className="wallet-empty">
        <h1 className="wallet-empty-title">No wallet here yet</h1>
        <Link href="/pool/setup" className="btn">Create a wallet</Link>
      </div>
    );
  }

  const deliveredLabel =
    delivery?.status === "success" ? `Delivered on ${chain.name}`
    : delivery?.status === "failure" ? "Relay couldn't deliver it"
    : delivery?.status === "refund" || delivery?.status === "refunded" ? "Refunded to your refund address"
    : `On its way to ${chain.name}`;

  return (
    <div className="pane">
      <h1 className="pane-title">Pay anywhere</h1>
      <p className="hint">Pay someone on {PAY_CHAINS.map((c) => c.name).join(", ")} from your private balance. They get USDC.</p>

      {noRelay && <p className="hint warn">No broadcaster available.</p>}
      {err && <p className="hint warn">{err}</p>}
      {!feeOk && <p className="hint warn">The relay is charging a fee right now, so payments out are paused.</p>}

      <div className="card pane-card">
        <div className="field">
          <label className="mono field-label">Chain</label>
          <select className="mono input" value={chainId} onChange={(e) => edit(setChainId)(Number(e.target.value))}>
            {PAY_CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="field">
          <label className="mono field-label">To</label>
          <input className="mono input" value={to} onChange={(e) => edit(setTo)(e.target.value)} placeholder="0x…" spellCheck={false} data-invalid={validTo === false} />
          {validTo === false && <span className="hint warn">Invalid address</span>}
        </div>

        {usdg && <AmountField value={amount} onChange={edit(setAmount)} balance={balance} fee={fee} label="Amount" asset={usdg} multiplier={null} />}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {QUICK.map((v) => (
            <button key={v} className="btn btn-ghost" style={{ minHeight: 30, padding: "0 12px", fontSize: 12 }} onClick={() => edit(setAmount)(v)}>{v}</button>
          ))}
        </div>
        {parsed !== null && !enough && <span className="hint warn">Balance too low. Deposit USDG first.</span>}
        {parsed !== null && parsed > PAY_MAX && <span className="hint warn">Up to 10,000 USDG per payment for now.</span>}

        {quote && (
          <>
            <div className="fee-row mono"><span>They get</span><span>≈ {Number(quote.amountOutFormatted).toFixed(2)} {quote.symbolOut} on {chain.name}</span></div>
            <div className="fee-row mono"><span>Arrives in</span><span>~{quote.timeEstimate ?? "?"}s</span></div>
            {quote.feeUsd && <div className="fee-row mono"><span>Bridge fee</span><span>${Number(quote.feeUsd).toFixed(2)}</span></div>}
          </>
        )}
        {parsed !== null && parsed > 0n && usdg && (
          <div className="fee-row mono"><span>Pool fee {Number(FEE_BPS) / 100}%</span><span>{formatAmount((parsed * FEE_BPS) / BPS, usdg, null)} USDG</span></div>
        )}

        {state.stage === "idle" && (
          quote ? (
            <button className="btn" disabled={!ready || quoting} onClick={pay}>{quoting ? "Updating quote…" : "Pay"}</button>
          ) : (
            <button className="btn" disabled={!ready || quoting} onClick={() => void getQuote()}>{quoting ? "Getting a quote…" : "Review"}</button>
          )
        )}

        <p className="hint" style={{ marginTop: 12 }}>
          This leaves the pool like a withdrawal: the amount and where it goes are public, but not that it was you.
          Relay bridges it and holds it for a few seconds. If it can&apos;t deliver, it refunds to an address from your 12 words.
        </p>
      </div>

      {state.stage !== "idle" && (
        <ProvingPanel
          state={state}
          label={stageLabel(state)}
          onCancel={() => { reset(); setQuote(null); }}
          onConfirm={submit}
          confirmLabel="Pay"
          kind="unshield"
          hash={hash}
          result={result}
        />
      )}

      {delivery && (
        <div className="card pane-card" style={{ marginTop: 14 }}>
          <div className="fee-row mono">
            <span>{deliveredLabel}</span>
            <span>{delivery.status === "success" ? "✓" : "…"}</span>
          </div>
          {delivery.tx && delivery.status === "success" && (
            <a className="hint" href={`${chain.explorer}/tx/${delivery.tx}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
              View on {chain.name}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
