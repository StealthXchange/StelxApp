"use client";

import Link from "next/link";
import { refusedBeforeSending, waitForSpent, type Outcome } from "@/lib/pool/outcome";
import { useEffect, useMemo, useState } from "react";
import { BROADCASTERS } from "@/lib/pool/config";
import { refresh, revealSeed } from "@/lib/pool/walletStore";
import { usePool } from "@/lib/pool/usePool";
import { useAssetChoice } from "@/lib/pool/useAssetChoice";
import { formatAmount, parseAmount, WETH } from "@/lib/pool/assets";
import { AssetPicker } from "@/components/pool/AssetPicker";
import { useProver, stageLabel } from "@/lib/pool/useProver";
import { submitViaBroadcaster, waitForBroadcast, type BroadcasterInfo } from "@/lib/pool/vendor/broadcast";
import { pickRelay } from "@/lib/pool/relay";
import { usePoolHealth } from "@/lib/pool/health";
import { decodeAddress } from "@/lib/pool/vendor/keys";
import { ProvingPanel } from "@/components/pool/ProvingPanel";
import { AmountField } from "@/components/pool/AmountField";

export default function SendPage() {
  const pool = usePool();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [broadcaster, setBroadcaster] = useState<BroadcasterInfo | null>(null);
  const [bcError, setBcError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const { state, build, reset, setSubmitting } = useProver(revealSeed());
  const { options, current, choose } = useAssetChoice(pool.holdings);
  const { asset, multiplier, balance } = current;

  const health = usePoolHealth();

  useEffect(() => {
    if (BROADCASTERS.length === 0) { setBcError("none"); return; }
    pickRelay(BROADCASTERS).then(setBroadcaster).catch((e) => setBcError(String(e.message)));
  }, []);

  const parsed = useMemo(() => (amount ? parseAmount(amount, asset, multiplier) : null), [amount, asset, multiplier]);
  const fee = broadcaster?.fee ?? 0n;

  const feeAssetOk = fee === 0n || asset === WETH;
  const total = parsed !== null ? parsed + fee : null;
  const enough = total !== null && total <= balance;
  const valid = useMemo(() => {
    if (!to.trim()) return null;
    try { decodeAddress(to.trim()); return true; } catch { return false; }
  }, [to]);
  const canSend = Boolean(valid && parsed && parsed > 0n && enough && broadcaster && feeAssetOk && health.status === "ok" && state.stage === "idle");

  async function submit() {
    if (!state.tx || !broadcaster) return;
    setSubmitting();
    try {
      const h = await submitViaBroadcaster(broadcaster, state.tx as any);
      setHash(h);
      const r = await waitForBroadcast(broadcaster, h);
      setResult(r);
      if (r === "success") await refresh();
    } catch (e: any) {

      const msg = String(e?.message ?? e);
      setBcError(msg);
      if (refusedBeforeSending(msg)) { setResult("refused"); return; }
      setResult("checking");
      if (await waitForSpent((state.tx as any).data)) { setResult("success"); await refresh(); }
      else setResult("unknown");
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

  return (
    <div className="pane">
      <h1 className="pane-title">Send</h1>

      {bcError === "none" && <p className="hint warn">No broadcaster available.</p>}
      {bcError && bcError !== "none" && <p className="hint warn">{bcError}</p>}

      <div className="card pane-card">
        <div className="field">
          <label className="mono field-label">To</label>
          <input
            className="mono input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="stelx1…"
            spellCheck={false}
            data-invalid={valid === false}
          />
          {valid === false && <span className="hint warn">Invalid address</span>}
        </div>

        {options.length > 1 && (
          <AssetPicker
            assets={options.map((h) => h.asset)}
            value={asset}
            onChange={(a) => { choose(a.address); setAmount(""); }}
            detail={(a) => { const h = options.find((o) => o.asset === a)!; return formatAmount(h.balance, a, h.multiplier); }}
          />
        )}

        <AmountField value={amount} onChange={setAmount} balance={balance} fee={fee} label="Amount" asset={asset} multiplier={multiplier} />

        {!feeAssetOk && <span className="hint warn">The relay takes its fee in WETH only, so {asset.symbol} can&apos;t go through it yet.</span>}

        {parsed !== null && !enough && <span className="hint warn">Balance too low</span>}

        {broadcaster && (
          <div className="fee-row mono">
            <span>Fee</span>
            <span>{formatAmount(fee, asset, multiplier)} {asset.symbol}</span>
          </div>
        )}

        {state.stage === "idle" && (
          <button className="btn" disabled={!canSend} onClick={() => build("transfer", asset.address, to.trim(), parsed!, broadcaster!.address, broadcaster!.shieldedAddress, fee)}>
            Send
          </button>
        )}
      </div>

      {state.stage !== "idle" && (
        <ProvingPanel
          state={state}
          label={stageLabel(state)}
          onCancel={reset}
          onConfirm={submit}
          confirmLabel="Confirm"
          hash={hash}
          result={result}
        />
      )}
    </div>
  );
}
