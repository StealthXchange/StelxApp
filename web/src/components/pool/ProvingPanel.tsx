"use client";

import { CheckCircle, AlertTriangle } from "@/components/icons";
import { txUrl } from "@/lib/pool/config";
import type { ProverState } from "@/lib/pool/useProver";

export function ProvingPanel({
  state, label, onCancel, onConfirm, confirmLabel, hash, result, kind = "transfer", doneTitle,
}: {

  doneTitle?: string;
  state: ProverState;
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  hash: string | null;

  result: "success" | "reverted" | "refused" | "checking" | "unknown" | null;

  kind?: "transfer" | "unshield";
}) {
  const downloading = state.stage === "artifacts" && state.downloadTotal > 0 && state.downloaded < state.downloadTotal;
  const pct = downloading ? Math.min(100, (state.downloaded / state.downloadTotal) * 100) : 0;

  if (result === "success") {
    return (
      <section className="card" style={{ padding: "22px 26px", borderColor: "var(--accent-border)", display: "flex", gap: 14, alignItems: "flex-start" }}>
        <CheckCircle color="var(--accent)" />
        <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-mid)" }}>
          <strong style={{ color: "var(--text-hi)", fontWeight: 600 }}>{doneTitle ?? (kind === "unshield" ? "Withdrawn." : "Sent.")}</strong> Your balance has been updated.
          {hash && <> <a href={txUrl(hash)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>View on explorer</a>.</>}
          <div style={{ fontSize: 13, color: "var(--text-low)", marginTop: 8 }}>
            {kind === "unshield"
              ? "The destination and amount are public. Which deposit it came from isn't."
              : "On chain it's a transaction from the broadcaster. You, the recipient and the amount don't show."}
          </div>
        </div>
      </section>
    );
  }

  if (result === "checking" || result === "unknown") {
    const checking = result === "checking";
    return (
      <section className="card" style={{ padding: "22px 26px", borderColor: "var(--amber-border)", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <AlertTriangle color="var(--amber)" />
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-mid)" }}>
            <strong style={{ color: "var(--text-hi)", fontWeight: 600 }}>
              {checking ? "Checking whether it went through…" : "Not confirmed."}
            </strong>{" "}
            {checking
              ? "The broadcaster didn't confirm it, so we're checking the chain. Up to a minute. Don't send it again yet."
              : "We can't see it on chain. It may not have gone, or may still arrive. Check your balance in a minute before trying again."}
          </div>
        </div>
        {!checking && <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={onCancel}>Back</button>}
      </section>
    );
  }

  if (state.stage === "error" || result === "reverted" || result === "refused") {
    return (
      <section className="card" style={{ padding: "22px 26px", borderColor: "var(--amber-border)", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <AlertTriangle color="var(--amber)" />
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-mid)" }}>
            <strong style={{ color: "var(--text-hi)", fontWeight: 600 }}>That did not go through.</strong>{" "}
            {state.error ?? (result === "refused" ? "The broadcaster refused it before sending." : "The transaction was rejected on chain.")}
            <div style={{ fontSize: 13, color: "var(--text-low)", marginTop: 8 }}>
              Nothing was spent. Your balance is unchanged.
            </div>
          </div>
        </div>
        <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={onCancel}>Try again</button>
      </section>
    );
  }

  if (state.stage === "done") {
    return (
      <section className="card" style={{ padding: "22px 26px", borderColor: "var(--accent-border)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <CheckCircle color="var(--accent)" />
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-mid)" }}>
            <strong style={{ color: "var(--text-hi)", fontWeight: 600 }}>Proof ready.</strong> Nothing sent yet.
            Recipient, amount and fee are sealed in the proof, so the broadcaster can&apos;t change them.
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button className="btn" onClick={onConfirm}>{confirmLabel}</button>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </section>
    );
  }

  return (
    <section className="card" style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{label}</div>
        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-low)" }}>{state.elapsed}s</span>
      </div>

      <div style={{ height: 4, background: "var(--panel)", borderRadius: 2, overflow: "hidden" }}>
        <div
          style={{
            height: "100%", background: "var(--accent)", borderRadius: 2,
            width: downloading ? `${pct}%` : "100%",
            opacity: downloading ? 1 : 0.55,
            transition: downloading ? "width .3s linear" : undefined,
            animation: downloading ? undefined : "poolPulse 1.6s ease-in-out infinite",
          }}
        />
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-low)" }}>
        {state.stage === "artifacts"
          ? "The proving key downloads once, then stays on this device."
          : "Runs in your browser. Nothing sent or spent yet, so closing the tab is safe."}
      </div>

      <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={onCancel}>Cancel</button>
    </section>
  );
}
