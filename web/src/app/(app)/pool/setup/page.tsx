"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle, Eye } from "@/components/icons";

const HEAD_TAG = "KEYS STAY IN THIS BROWSER";
import { adopt, createSeed, discardPendingSeed, isPersistent, setPersistent } from "@/lib/pool/walletStore";
import { usePool } from "@/lib/pool/usePool";

type Step = "choose" | "reveal" | "confirm" | "recover";

function PoolSetupInner() {
  const router = useRouter();
  const pool = usePool();

  const params = useSearchParams();
  const [step, setStep] = useState<Step>(params.get("step") === "recover" ? "recover" : "choose");

  const asked = params.get("next");
  const next = asked && /^\/(gift|pool)(\/[\w/-]*)?$/.test(asked) ? asked : "/pool";
  const [seed, setSeed] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [persist, setPersist] = useState(false);
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [recoverInput, setRecoverInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = useMemo(() => (seed ? seed.split(" ") : []), [seed]);

  const checks = useMemo(() => {
    if (!words.length) return [];
    const idx = new Set<number>();
    while (idx.size < 3) idx.add(Math.floor(Math.random() * words.length));
    return [...idx].sort((a, b) => a - b);
  }, [words]);

  const confirmed = checks.length > 0 && checks.every((i) => (typed[i] ?? "").trim().toLowerCase() === words[i]);

  function KeepSignedIn() {
    return (
      <label
        className="card"
        style={{
          padding: "14px 16px", display: "flex", gap: 12, alignItems: "flex-start",
          cursor: "pointer", borderColor: persist ? "var(--accent)" : "var(--border)",
        }}
      >
        <input
          type="checkbox"
          checked={persist}
          onChange={(e) => setPersist(e.target.checked)}
          style={{ marginTop: 2, width: 16, height: 16, accentColor: "var(--accent)", flexShrink: 0 }}
        />
        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)" }}>
            Keep me signed in on this device
          </span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: "var(--text-mid)" }}>
            {persist
              ? "Stays in this browser until you sign out. Only use this on your own device."
              : "Closing the tab signs you out, and you'll need your phrase to get back in. Refreshing is fine."}
          </span>
        </span>
      </label>
    );
  }

  async function finish(mnemonic: string) {
    setBusy(true);
    setError(null);
    try {
      setPersistent(persist);
      await adopt(mnemonic);
      router.push(next);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <h1>Pool wallet</h1>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-low)" }}>
          {HEAD_TAG}
        </span>
      </header>

      <div className="page-body" style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 20 }}>
        {pool.address && step === "choose" && (
          <div className="card" style={{ padding: "18px 22px", display: "flex", gap: 12, alignItems: "flex-start" }}>
            <CheckCircle color="var(--accent)" />
            <div style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text-mid)" }}>
              A wallet is already loaded here.{" "}
              <a href="/pool" style={{ color: "var(--accent)" }}>Go to your pool</a>, or create a new one to replace
              it. The old phrase still controls its funds.
            </div>
          </div>
        )}

        {step === "choose" && (
          <div className="grid-2" style={{ gap: 18 }}>
            <section className="card" style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 650, margin: 0 }}>Create a wallet</h2>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-mid)", margin: 0 }}>
                Makes a twelve-word phrase in this browser. It&apos;s the only way back to your funds.
              </p>
              <button
                className="btn"
                onClick={() => { setSeed(createSeed()); setShown(false); setStep("reveal"); }}
              >
                Create wallet
              </button>
            </section>

            <section className="card" style={{ padding: "22px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 style={{ fontSize: 16, fontWeight: 650, margin: 0 }}>Recover a wallet</h2>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-mid)", margin: 0 }}>
                Enter your phrase. Your balance and history rebuild from the chain.
              </p>
              <button className="btn btn-ghost" onClick={() => setStep("recover")}>Recover from phrase</button>
            </section>
          </div>
        )}

        {step === "reveal" && seed && (
          <section className="card" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <AlertTriangle color="var(--amber)" />
              <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-mid)" }}>
                Anyone with these twelve words controls this wallet. Write them down offline. Never reuse a
                phrase from another wallet here: it&apos;s held in this browser, where any script on the page
                could read it.
              </div>
            </div>

            {!shown ? (
              <button className="btn btn-ghost" onClick={() => setShown(true)}>
                <Eye color="currentColor" /> Reveal phrase
              </button>
            ) : (
              <>
                <ol
                  className="mono"
                  style={{
                    display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: "10px 18px",
                    margin: 0, padding: 0, listStyle: "none", fontSize: 14,
                  }}
                >
                  {words.map((w, i) => (
                    <li key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <span style={{ color: "var(--text-low)", fontSize: 11, minWidth: 18 }}>{i + 1}</span>
                      <span style={{ color: "var(--text-hi)" }}>{w}</span>
                    </li>
                  ))}
                </ol>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(seed)}>Copy</button>
                  <button className="btn" onClick={() => setStep("confirm")}>I have written it down</button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => { discardPendingSeed(); setSeed(null); setStep("choose"); }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {step === "confirm" && seed && (
          <section className="card" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
            <h2 style={{ fontSize: 16, fontWeight: 650, margin: 0 }}>Confirm three words</h2>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-mid)", margin: 0 }}>
              To check you wrote it down.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16 }}>
              {checks.map((i) => (
                <label key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", color: "var(--text-low)" }}>
                    WORD {i + 1}
                  </span>
                  <input
                    className="mono"
                    autoComplete="off"
                    spellCheck={false}
                    value={typed[i] ?? ""}
                    onChange={(e) => setTyped({ ...typed, [i]: e.target.value })}
                    style={{
                      background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6,
                      padding: "10px 12px", color: "var(--text-hi)", fontSize: 14,
                    }}
                  />
                </label>
              ))}
            </div>

            <KeepSignedIn />

            {error && <div style={{ fontSize: 13.5, color: "var(--amber)" }}>{error}</div>}
            <div style={{ display: "flex", gap: 12 }}>
              <button className="btn" disabled={!confirmed || busy} onClick={() => finish(seed)}>
                {busy ? "Opening wallet…" : "Open my pool wallet"}
              </button>
              <button className="btn btn-ghost" onClick={() => setStep("reveal")}>Back to phrase</button>
            </div>
          </section>
        )}

        {step === "recover" && (
          <section className="card" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 650, margin: 0 }}>Recover from phrase</h2>
            <textarea
              className="mono"
              rows={3}
              placeholder="twelve words separated by spaces"
              value={recoverInput}
              onChange={(e) => setRecoverInput(e.target.value)}
              spellCheck={false}
              style={{
                background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6,
                padding: "12px 14px", color: "var(--text-hi)", fontSize: 14, resize: "vertical",
              }}
            />
            <KeepSignedIn />
            {error && <div style={{ fontSize: 13.5, color: "var(--amber)" }}>{error}</div>}
            <div style={{ display: "flex", gap: 12 }}>
              <button className="btn" disabled={busy || recoverInput.trim().split(/\s+/).length < 12} onClick={() => finish(recoverInput)}>
                {busy ? "Recovering…" : "Recover wallet"}
              </button>
              <button className="btn btn-ghost" onClick={() => setStep("choose")}>Back</button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

export default function PoolSetupPage() {
  return (
    <Suspense
      fallback={
        <header className="page-head">
          <h1>Pool wallet</h1>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-low)" }}>
            {HEAD_TAG}
          </span>
        </header>
      }
    >
      <PoolSetupInner />
    </Suspense>
  );
}
