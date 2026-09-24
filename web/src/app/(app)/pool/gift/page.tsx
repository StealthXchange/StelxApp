"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BROADCASTERS } from "@/lib/pool/config";
import { refresh, revealSeed } from "@/lib/pool/walletStore";
import { usePool } from "@/lib/pool/usePool";
import { useAssetChoice } from "@/lib/pool/useAssetChoice";
import { assetOf, formatAmount, parseAmount, WETH, type Asset } from "@/lib/pool/assets";
import { AssetPicker } from "@/components/pool/AssetPicker";
import { useProver, stageLabel } from "@/lib/pool/useProver";
import { type BroadcasterInfo } from "@/lib/pool/vendor/broadcast";
import { pickRelay } from "@/lib/pool/relay";
import { usePoolHealth } from "@/lib/pool/health";
import { submitAndSettle, type Outcome } from "@/lib/pool/outcome";
import { giftLink, giftSeed } from "@/lib/pool/giftKeys";
import {
  allocateGift, dropGift, findGifts, inspectGift, loadGifts, saveGift,
  type GiftContents, type GiftHolding, type GiftRecord,
} from "@/lib/pool/gift";
import { ProvingPanel } from "@/components/pool/ProvingPanel";
import { AmountField } from "@/components/pool/AmountField";
import { AlertTriangle, CheckCircle } from "@/components/icons";

export default function SendGiftPage() {
  const pool = usePool();
  const seed = revealSeed();
  const [amount, setAmount] = useState("");
  const [broadcaster, setBroadcaster] = useState<BroadcasterInfo | null>(null);
  const [bcError, setBcError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const [allocating, setAllocating] = useState(false);
  const [pending, setPending] = useState<{ index: number; giftPhrase: string; total: bigint; asset: Asset } | null>(null);
  const [made, setMade] = useState<{ link: string; confirmed: boolean } | null>(null);
  const [listVersion, setListVersion] = useState(0);
  const { state, build, reset, setSubmitting } = useProver(seed);
  const { options, current, choose } = useAssetChoice(pool.holdings);
  const { asset, multiplier, balance } = current;
  const health = usePoolHealth();

  useEffect(() => {
    if (BROADCASTERS.length === 0) { setBcError("none"); return; }
    pickRelay(BROADCASTERS).then(setBroadcaster).catch((e) => setBcError(String(e.message)));
  }, []);

  const parsed = useMemo(() => (amount ? parseAmount(amount, asset, multiplier) : null), [amount, asset, multiplier]);
  const fee = broadcaster?.fee ?? 0n;

  const fees = fee * 2n;
  const feeAssetOk = fee === 0n || asset === WETH;
  const enough = parsed !== null && parsed + fees <= balance;
  const canCreate = Boolean(seed && parsed && parsed > 0n && enough && broadcaster && feeAssetOk && health.status === "ok" && state.stage === "idle" && !allocating);

  async function create() {
    if (!seed || !pool.address || !broadcaster || !parsed) return;
    setAllocating(true); setBcError(null);
    try {
      const g = await allocateGift(seed, pool.address);
      const total = parsed + fee;
      setPending({ index: g.index, giftPhrase: g.giftPhrase, total, asset });
      build("transfer", asset.address, g.giftAddress, total, broadcaster.address, broadcaster.shieldedAddress, fee);
    } catch (e: any) {
      setBcError(String(e?.shortMessage ?? e?.message ?? e));
    } finally {
      setAllocating(false);
    }
  }

  async function submit() {
    if (!state.tx || !broadcaster || !pending || !pool.address) return;

    saveGift(pool.address, { index: pending.index, asset: pending.asset.address, amount: pending.total.toString(), at: Date.now() });
    setSubmitting();
    const r = await submitAndSettle(broadcaster, state.tx, { hash: setHash, checking: () => setResult("checking") });
    setResult(r.outcome);
    if (r.error) setBcError(r.error);

    if (r.outcome === "refused" || r.outcome === "reverted") dropGift(pool.address, pending.index);
    if (r.outcome === "success" || r.outcome === "unknown") {
      setMade({ link: giftLink(window.location.origin, pending.giftPhrase), confirmed: r.outcome === "success" });
    }
    if (r.outcome === "success") void refresh();
    setListVersion((v) => v + 1);
  }

  function startOver() {
    reset(); setHash(null); setResult(null); setPending(null); setMade(null); setAmount(""); setBcError(null);
  }

  if (!pool.address || !seed) {
    return (
      <div className="wallet-empty">
        <h1 className="wallet-empty-title">No wallet here yet</h1>
        <Link href="/pool/setup" className="btn">Create a wallet</Link>
      </div>
    );
  }

  return (
    <div className="pane">
      <h1 className="pane-title">Gift</h1>
      <p className="hint">Send by link, to anyone. They claim it into their own wallet, even one they make after opening it.</p>

      {bcError === "none" && <p className="hint warn">No broadcaster available.</p>}
      {bcError && bcError !== "none" && <p className="hint warn">{bcError}</p>}

      {made ? (
        <GiftReady link={made.link} confirmed={made.confirmed} onAnother={startOver} />
      ) : (
        <>
          <div className="card pane-card">
            {options.length > 1 && (
              <AssetPicker
                assets={options.map((h) => h.asset)}
                value={asset}
                onChange={(a) => { choose(a.address); setAmount(""); }}
                detail={(a) => { const h = options.find((o) => o.asset === a)!; return formatAmount(h.balance, a, h.multiplier); }}
              />
            )}

            <AmountField value={amount} onChange={setAmount} balance={balance} fee={fees} label="Gift" asset={asset} multiplier={multiplier} />

            {!feeAssetOk && <span className="hint warn">The relay takes its fee in WETH only, so {asset.symbol} can&apos;t go through it yet.</span>}
            {parsed !== null && parsed > 0n && !enough && <span className="hint warn">Balance too low</span>}

            {broadcaster && fee > 0n && (
              <>
                <div className="fee-row mono">
                  <span>Fee</span>
                  <span>{formatAmount(fee, asset, multiplier)} {asset.symbol}</span>
                </div>
                <div className="fee-row mono">
                  <span>Claim fee, paid now</span>
                  <span>{formatAmount(fee, asset, multiplier)} {asset.symbol}</span>
                </div>
              </>
            )}

            {state.stage === "idle" && (
              <button className="btn" disabled={!canCreate} onClick={() => void create()}>
                {allocating ? "Preparing…" : "Create gift link"}
              </button>
            )}
          </div>

          {state.stage !== "idle" && (
            <ProvingPanel
              state={state}
              label={stageLabel(state)}
              onCancel={startOver}
              onConfirm={submit}
              confirmLabel="Send gift"
              hash={hash}
              result={result}
            />
          )}
        </>
      )}

      <GiftList seed={seed} address={pool.address} broadcaster={broadcaster} version={listVersion} onChange={() => setListVersion((v) => v + 1)} />
    </div>
  );
}

function GiftReady({ link, confirmed, onAnother }: { link: string; confirmed: boolean; onAnother: () => void }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <section className="card addr-card" style={{ borderColor: confirmed ? "var(--accent-border)" : "var(--amber-border)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {confirmed ? <CheckCircle color="var(--accent)" /> : <AlertTriangle color="var(--amber)" />}
        <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-mid)" }}>
          <strong style={{ color: "var(--text-hi)", fontWeight: 600 }}>{confirmed ? "Gift ready." : "Not confirmed yet."}</strong>{" "}
          {confirmed
            ? "Anyone with this link can claim it, so send it only to them, in a private message."
            : "Check it shows as not claimed under Your gifts before you share this link."}
        </div>
      </div>
      <code className="mono addr-full">{link}</code>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn"
          onClick={() => {
            navigator.clipboard?.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        {canShare && <button className="btn btn-ghost" onClick={() => void navigator.share({ url: link }).catch(() => {})}>Share</button>}
        <button className="btn btn-ghost" onClick={onAnother}>Another gift</button>
      </div>
    </section>
  );
}

type Status = GiftContents | "checking" | "error";

function GiftList({ seed, address, broadcaster, version, onChange }: {
  seed: string;
  address: string;
  broadcaster: BroadcasterInfo | null;
  version: number;
  onChange: () => void;
}) {

  const records = useMemo(() => loadGifts(address).sort((a, b) => b.index - a.index), [address, version]);
  const [status, setStatus] = useState<Record<number, Status>>({});
  const [active, setActive] = useState<{ record: GiftRecord; holding: GiftHolding } | null>(null);
  const [finding, setFinding] = useState<number | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      for (const r of records) {
        if (!live) return;
        setStatus((s) => ({ ...s, [r.index]: "checking" }));
        try {
          const c = await inspectGift(giftSeed(seed, r.index));
          if (live) setStatus((s) => ({ ...s, [r.index]: c }));
        } catch {
          if (live) setStatus((s) => ({ ...s, [r.index]: "error" }));
        }
      }
    })();
    return () => { live = false; };
  }, [records, seed]);

  async function find() {
    setFound(null);
    try {
      const n = await findGifts(seed, address, setFinding);
      setFound(n === 0 ? "No others found." : `Found ${n} more.`);
      onChange();
    } catch (e: any) {
      setFound(`Couldn't finish: ${String(e?.shortMessage ?? e?.message ?? e)}`);
    } finally {
      setFinding(null);
    }
  }

  const fee = broadcaster?.fee ?? 0n;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
      <div className="mono field-label">Your gifts</div>

      {records.length === 0 && <p className="hint" style={{ textAlign: "left" }}>None sent from this device yet.</p>}

      {records.length > 0 && (
        <div className="card rows">
          {records.map((r) => {
            const s = status[r.index];
            const asset = assetOf(r.asset);
            const c = typeof s === "object" ? s : null;
            const h = c?.holdings.find((x) => x.asset.address.toLowerCase() === r.asset.toLowerCase()) ?? c?.holdings[0];
            const unclaimed = h && h.balance > 0n;
            const label =
              s === "checking" || s === undefined ? "CHECKING"
              : s === "error" ? "COULDN'T CHECK"
              : !c?.funded ? "NOT ON CHAIN YET"
              : unclaimed ? "NOT CLAIMED"
              : r.takenBack ? "TAKEN BACK"

              : r.at ? "CLAIMED" : "CLAIMED OR TAKEN BACK";
            const canTakeBack = unclaimed && broadcaster && (fee === 0n || h.asset === WETH) && h.balance > fee && !active;
            return (
              <div key={r.index} className="row" style={{ flexWrap: "wrap" }}>
                <div className="row-main" style={{ flexDirection: "column", gap: 4 }}>
                  <span className="mono row-kind">{label}</span>
                  <span className="mono row-note">{r.at ? new Date(r.at).toLocaleDateString() : "Sent from another device"}</span>
                </div>
                <div className="row-val">
                  <span className="row-amt">
                    {h ? formatAmount(unclaimed ? h.balance : h.received, h.asset, h.multiplier) : "…"} {asset?.symbol ?? ""}
                  </span>
                  {unclaimed && (
                    <span style={{ display: "flex", gap: 12 }}>
                      <button
                        className="wallet-retry mono"
                        style={{ fontSize: 11 }}
                        onClick={() => {
                          navigator.clipboard?.writeText(giftLink(window.location.origin, giftSeed(seed, r.index)));
                          setCopied(r.index);
                          setTimeout(() => setCopied(null), 1400);
                        }}
                      >
                        {copied === r.index ? "COPIED" : "COPY LINK"}
                      </button>
                      {canTakeBack && (
                        <button className="wallet-retry mono" style={{ fontSize: 11 }} onClick={() => setActive({ record: r, holding: h })}>
                          TAKE BACK
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {active && broadcaster && (
        <TakeBack
          key={active.record.index}
          giftPhrase={giftSeed(seed, active.record.index)}
          holding={active.holding}
          to={address}
          broadcaster={broadcaster}
          onDone={(ok) => {
            if (ok) { saveGift(address, { ...active.record, takenBack: true }); void refresh(); }
            setActive(null);
            onChange();
          }}
        />
      )}

      <button
        className="wallet-retry mono"
        style={{ alignSelf: "flex-start", fontSize: 11, letterSpacing: "0.1em" }}
        disabled={finding !== null}
        onClick={() => void find()}
      >
        {finding !== null ? `CHECKING GIFT ${finding + 1}…` : "FIND GIFTS SENT FROM THIS PHRASE ELSEWHERE"}
      </button>
      {found && <p className="hint" style={{ textAlign: "left" }}>{found}</p>}
    </section>
  );
}

function TakeBack({ giftPhrase, holding, to, broadcaster, onDone }: {
  giftPhrase: string;
  holding: GiftHolding;
  to: string;
  broadcaster: BroadcasterInfo;
  onDone: (ok: boolean) => void;
}) {
  const { state, build, reset, setSubmitting } = useProver(giftPhrase);
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);

  useEffect(() => {
    build("transfer", holding.asset.address, to, holding.balance - broadcaster.fee, broadcaster.address, broadcaster.shieldedAddress, broadcaster.fee);

  }, []);

  async function submit() {
    if (!state.tx) return;
    setSubmitting();
    const r = await submitAndSettle(broadcaster, state.tx, { hash: setHash, checking: () => setResult("checking") });
    setResult(r.outcome);
  }

  const finished = result === "success" || result === "unknown";
  return (
    <>
      <ProvingPanel
        state={state}
        label={stageLabel(state)}
        onCancel={() => { reset(); onDone(false); }}
        onConfirm={submit}
        confirmLabel="Take back"
        doneTitle="Taken back."
        hash={hash}
        result={result}
      />
      {finished && (
        <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={() => onDone(result === "success")}>Done</button>
      )}
    </>
  );
}
