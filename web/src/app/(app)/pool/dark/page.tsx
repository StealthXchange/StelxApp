"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseUnits, type Address } from "viem";
import { BROADCASTERS, IS_MAINNET } from "@/lib/pool/config";
import { refresh, revealSeed } from "@/lib/pool/walletStore";
import { usePool } from "@/lib/pool/usePool";
import { usePoolHealth } from "@/lib/pool/health";
import { assetOf, formatAmount } from "@/lib/pool/assets";
import { useProver, stageLabel } from "@/lib/pool/useProver";
import { submitViaBroadcaster, waitForBroadcast, type BroadcasterInfo } from "@/lib/pool/vendor/broadcast";
import { refusedBeforeSending, waitForSpent, type Outcome } from "@/lib/pool/outcome";
import { pickRelay } from "@/lib/pool/relay";
import { ProvingPanel } from "@/components/pool/ProvingPanel";
import { ChainLogo } from "@/components/pool/ChainPicker";
import { payChain, refundAddress } from "@/lib/pool/payRoutes";
import { allocateRefund, saveRefund } from "@/lib/pool/payRefunds";
import {
  DARK_FROM, DARK_MAX_USD, DARK_MIN_USD, DARK_ROUTES, DEFAULT_ROUTE, RAILGUN_SHIELD_BPS, darkRoute, isBusyHour, nextBusyHour, splitParts,
  type DarkRoute, type DarkRouteId,
} from "@/lib/pool/darkRoutes";
import { railgunWallet } from "@/lib/pool/railgunKeys";
import { hasDelivery, landingAddressOf, readLandingState, shieldLanding, ShieldWait, type LandingState, type ShieldStep } from "@/lib/pool/darkLanding";
import { darkLandingKey } from "@/lib/pool/darkKeys";
import { allocateDark, destChain, findDarkTransfers, loadDark, routeOf, saveDark, type DarkRecord } from "@/lib/pool/dark";

interface Quote {
  requestId: `0x${string}`;
  depositAddress: Address;
  route: DarkRouteId;
  target: string;
  reserve: string;
  asked: string;
  minOut: string;
  amountIn: string;
  withdraw: string;
  usdIn: number;
  gasTopup: string | null;
  gasTopupUsd: number | null;
  timeEstimate: number | null;
  relayFeeUsd: string | null;
  impactPct: string | null;
  at: number;
}

type Phase = "review" | "bridging" | "landed" | "shielding" | "waiting" | "done" | "refunded" | "failed";

const QUOTE_MS = 25_000;
const POLL_MS = 4000;

const WAIT_MS = 20_000;

const GAS_SHARE = 0.05;
const ROW = { gap: 12 };

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
  return j;
}

const trim = (s: string, dp: number) => (s.includes(".") ? s.replace(new RegExp(`(\\.\\d{0,${dp}})\\d*$`), "$1").replace(/\.?0+$/, "") : s);
const show = (raw: bigint | string, route: DarkRoute) => `${trim(formatUnits(BigInt(raw), route.decimals), route.symbol === "ETH" ? 5 : 2)} ${route.symbol}`;
const eth = (wei: bigint) => trim(formatUnits(wei, 18), 6);
const shortZk = (a: string) => `${a.slice(0, 12)}…${a.slice(-6)}`;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

const now = () => Date.now();

export default function DarkModePage() {
  const pool = usePool();
  const health = usePoolHealth();
  const seed = revealSeed();
  const usdg = assetOf(DARK_FROM.token);
  const balance = pool.holdings.find((h) => h.asset.address.toLowerCase() === DARK_FROM.token.toLowerCase())?.balance ?? 0n;

  const [routeId, setRouteId] = useState<DarkRouteId>(DEFAULT_ROUTE);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [zk, setZk] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [broadcaster, setBroadcaster] = useState<BroadcasterInfo | null>(null);
  const { state, build, reset, setSubmitting } = useProver(seed);
  const [hash, setHash] = useState<string | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);

  const [current, setCurrent] = useState<DarkRecord | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [phase, setPhase] = useState<Phase>("review");
  const [landed, setLanded] = useState<LandingState | null>(null);
  const [step, setStep] = useState<ShieldStep | null>(null);
  const [waitMsg, setWaitMsg] = useState<string | null>(null);
  const [gasOk, setGasOk] = useState(false);
  const [relay, setRelay] = useState<{ status: string; inTx: string | null; outTx: string | null } | null>(null);
  const [shielded, setShielded] = useState<{ hash: string; noteValue: bigint } | null>(null);
  const running = useRef(false);
  const autoOff = useRef(false);
  const waitUntil = useRef(0);

  const [holdForPerson, setHoldForPerson] = useState(false);

  const [list, setList] = useState<{ record: DarkRecord; landed: LandingState | null }[]>([]);
  const [scanning, setScanning] = useState<number | null>(null);
  const [shownKey, setShownKey] = useState<number | null>(null);

  const route = darkRoute(routeId)!;
  const curRoute = (current && routeOf(current)) || route;
  const noRelay = BROADCASTERS.length === 0;

  useEffect(() => {
    if (noRelay) return;
    pickRelay(BROADCASTERS).then(setBroadcaster).catch((e) => setErr(String(e.message)));
  }, [noRelay]);

  useEffect(() => {
    let live = true;
    if (seed) railgunWallet(seed).then((w) => { if (live) setZk(w.address); }, () => {});
    return () => { live = false; };
  }, [seed]);

  let target: bigint | null = null;
  try { target = amount.trim() ? parseUnits(amount.trim(), route.decimals) : null; } catch { target = null; }
  const min = parseUnits(route.minTarget, route.decimals);
  const max = parseUnits(route.maxTarget, route.decimals);
  const unit = parseUnits(route.splitAt, route.decimals);
  const parts = target && target > unit ? splitParts(route, target, unit, min) : null;
  const fee = broadcaster?.fee ?? 0n;
  const ready = Boolean(seed && pool.address && usdg && target !== null && target >= min && target <= max && broadcaster && fee === 0n && health.status === "ok" && !busy);

  const hour = new Date().getUTCHours();
  const busyNow = isBusyHour(route, hour);

  const readList = useCallback(async () => {
    if (!seed || !pool.address) return [];
    return Promise.all(loadDark(pool.address).map(async (record) => {
      const r = routeOf(record);
      return { record, landed: r ? await readLandingState(destChain(r), landingAddressOf(seed, record.index)).catch(() => null) : null };
    }));
  }, [seed, pool.address]);
  const reloadList = useCallback(async () => setList(await readList()), [readList]);

  async function getQuote(keep?: DarkRecord): Promise<Quote | null> {
    if (!seed || !pool.address || (target === null && !keep)) return null;
    setBusy(true); setErr(null);
    try {
      const r = keep ? darkRoute(keep.route!)! : route;
      const t = keep ? BigInt(keep.target!) : target!;

      const landing = keep ? { index: keep.index, address: landingAddressOf(seed, keep.index) } : await allocateDark(seed, pool.address);
      const refund = keep?.refundIndex != null ? { index: keep.refundIndex, address: refundAddress(seed, keep.refundIndex) } : await allocateRefund(seed, pool.address);
      const q = await post("/api/dark/quote", { route: r.id, target: t.toString(), recipient: landing.address, refundTo: refund.address });

      saveRefund(pool.address, { index: refund.index, requestId: q.requestId, chainId: r.chainId, at: now() });
      const record: DarkRecord = {
        index: landing.index, route: r.id, target: q.target, asked: q.asked, amountIn: q.amountIn, withdraw: q.withdraw,
        requestId: q.requestId, depositAddress: q.depositAddress, refundIndex: refund.index, at: now(),
      };
      saveDark(pool.address, record);
      const fresh = { ...q, at: now() } as Quote;
      setCurrent(record); setQuote(fresh); setPhase("review"); setLanded(null); setRelay(null); setShielded(null);
      setWaitMsg(null); setGasOk(false); autoOff.current = false;
      void reloadList();
      return fresh;
    } catch (e) { setErr(String((e as Error).message ?? e)); return null; }
    finally { setBusy(false); }
  }

  async function send() {
    if (!current || !usdg || !broadcaster) return;

    const q = quote && now() - quote.at < QUOTE_MS ? quote : await getQuote(current);
    if (!q) return;
    if (BigInt(q.withdraw) > balance) { setErr("Balance too low for this transfer. Deposit USDG first."); return; }
    build("unshield", usdg.address, q.depositAddress, BigInt(q.withdraw), broadcaster.address, broadcaster.shieldedAddress, fee);
  }

  async function submit() {
    if (!state.tx || !broadcaster || !current || !pool.address) return;
    setSubmitting();
    const paid = { ...current, paidAt: now() };
    saveDark(pool.address, paid); setCurrent(paid);
    const settled = async () => { setPhase("bridging"); void refresh(); void reloadList(); };
    try {
      const h = await submitViaBroadcaster(broadcaster, state.tx as never);
      setHash(h);
      saveDark(pool.address, { ...paid, withdrawTx: h });
      const r = await waitForBroadcast(broadcaster, h);
      setResult(r);
      if (r === "success") await settled();
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      setErr(msg);
      if (refusedBeforeSending(msg)) {

        setResult("refused");
        const unpaid: DarkRecord = { ...paid };
        delete unpaid.paidAt;
        saveDark(pool.address, unpaid); setCurrent(unpaid);
        return;
      }
      setResult("checking");
      if (await waitForSpent((state.tx as { data: `0x${string}` }).data)) { setResult("success"); await settled(); }
      else setResult("unknown");
    }
  }

  const shield = useCallback(async (rec: DarkRecord, force = false) => {
    const r = routeOf(rec);
    if (!seed || !pool.address || !r || running.current) return;
    running.current = true; setErr(null); setWaitMsg(null);
    if (current?.index === rec.index) setPhase("shielding");
    try {
      const out = await shieldLanding(seed, rec.index, destChain(r), { onStep: setStep, maxGasShare: force ? 1 : r.symbol === "ETH" ? GAS_SHARE : 1 });
      if (!out) { if (current?.index === rec.index) setPhase("bridging"); return; }
      if (!out.recognised) throw new Error(`The shield ${out.hash} went through, but the note didn't check out as yours. Don't send more; check it in Railway.`);
      saveDark(pool.address, { ...rec, shieldTx: out.hash, noteValue: out.noteValue.toString() });
      if (current?.index === rec.index) { setShielded({ hash: out.hash, noteValue: out.noteValue }); setPhase("done"); }
    } catch (e) {
      if (e instanceof ShieldWait) {
        waitUntil.current = now() + WAIT_MS;
        setHoldForPerson(r.symbol === "ETH" && e.have >= e.need);
        if (current?.index === rec.index) { setWaitMsg(e.message); setPhase("waiting"); }
        else setErr(e.message);
      } else {
        setErr(String((e as Error).message ?? e));
        autoOff.current = true;
        if (current?.index === rec.index) setPhase("landed");
      }
    } finally {
      running.current = false; setStep(null);
      void reloadList();
    }
  }, [seed, pool.address, current, reloadList]);

  useEffect(() => {
    if (!current || !seed || !["bridging", "landed", "waiting"].includes(phase)) return;
    const r = routeOf(current);
    if (!r) return;
    let live = true;
    const landing = landingAddressOf(seed, current.index);
    const tick = async () => {
      if (current.requestId && current.depositAddress) {
        try {
          const s = await fetch(`/api/dark/status?id=${current.requestId}&deposit=${current.depositAddress}`, { cache: "no-store" }).then((x) => x.json());
          const req = s.requests?.[0];
          const status = String(req?.status ?? s.status ?? "unknown");
          if (live) setRelay({ status, inTx: req?.inTx ?? null, outTx: req?.outTx ?? s.txHashes?.[0] ?? null });
          if (live && (status === "refund" || status === "refunded")) { setPhase("refunded"); return; }
          if (live && status === "failure") setPhase("failed");
        } catch {  }
      }
      try {
        const l = await readLandingState(destChain(r), landing);
        if (!live) return;
        setLanded(l);
        if (hasDelivery(r, l)) {
          if (phase === "bridging") setPhase("landed");
          if (!autoOff.current && now() >= waitUntil.current && (!holdForPerson || gasOk)) void shield(current, gasOk);
        } else if (l.nonce > 0) {

          setPhase("done");
        }
      } catch {  }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [current, phase, seed, shield, gasOk, holdForPerson]);

  async function scan() {
    if (!seed || !pool.address) return;
    setErr(null); setScanning(0);
    try { await findDarkTransfers(seed, pool.address, setScanning); await reloadList(); }
    catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setScanning(null); }
  }

  const follow = useCallback((rec: DarkRecord) => {
    setCurrent(rec); setQuote(null); setShielded(rec.shieldTx ? { hash: rec.shieldTx, noteValue: BigInt(rec.noteValue ?? 0) } : null);
    setPhase(rec.shieldTx ? "done" : "bridging"); autoOff.current = false; setHoldForPerson(false); setErr(null);
  }, []);

  const resumed = useRef(false);
  useEffect(() => {
    let live = true;
    readList().then((l) => {
      if (!live) return;
      setList(l);
      if (resumed.current) return;
      resumed.current = true;
      const open = l.filter(({ record, landed: x }) => record.paidAt && !record.shieldTx && !(x && x.nonce > 0 && !hasDelivery(routeOf(record)!, x)));
      if (open.length) follow(open[open.length - 1].record);
    }, () => {});
    return () => { live = false; };
  }, [readList, follow]);
  const back = () => { setCurrent(null); setQuote(null); setAmount(""); setErr(null); reset(); setHash(null); setResult(null); setPhase("review"); };

  const copyZk = () => { if (zk) { navigator.clipboard?.writeText(zk); setCopied(true); setTimeout(() => setCopied(false), 1400); } };

  const noteOf = (raw: bigint) => raw - (raw * RAILGUN_SHIELD_BPS) / 10_000n;
  const refundAddr = useMemo(() => {
    if (!seed || current?.refundIndex == null) return null;
    try { return refundAddress(seed, current.refundIndex); } catch { return null; }
  }, [seed, current]);

  if (!pool.address || !seed) {
    return (
      <div className="wallet-empty">
        <h1 className="wallet-empty-title">No wallet here yet</h1>
        <Link href="/pool/setup" className="btn">Create a wallet</Link>
      </div>
    );
  }
  if (!IS_MAINNET) {
    return (
      <div className="pane">
        <h1 className="pane-title">Dark Mode</h1>
        <p className="hint">Only on mainnet: the bridge and RAILGUN don&apos;t serve the testnet.</p>
      </div>
    );
  }

  const paid = Boolean(current?.paidAt);
  const phaseLabel: Record<Phase, string> = {
    review: "Ready to send",
    bridging: `On its way to ${curRoute.chainName}`,
    landed: `Landed on ${curRoute.chainName}`,
    shielding: step === "approve" ? "Approving USDC" : step === "check" ? "Checking the note is yours" : "Shielding into RAILGUN",
    waiting: "Waiting for gas",
    done: "In your RAILGUN balance",
    refunded: "Refunded on Robinhood Chain",
    failed: "Relay couldn't deliver it",
  };

  return (
    <div className="pane">
      <h1 className="pane-title">Dark Mode</h1>
      <p className="hint">
        Private pool to private pool, across chains. Your private USDG leaves the STELX pool and lands in your own RAILGUN private
        balance on Ethereum or Arbitrum. Neither end is a public wallet of yours.
      </p>
      {noRelay && <p className="hint warn">No broadcaster available.</p>}
      {broadcaster && fee !== 0n && <p className="hint warn">The relay is charging a fee right now, so transfers out are paused.</p>}
      {err && <p className="hint warn">{err}</p>}

      {!current && (
        <div className="card pane-card">
          <div className="field">
            <label className="mono field-label">Land in RAILGUN on</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {DARK_ROUTES.map((r) => (
                <button key={r.id} type="button" className={r.id === routeId ? "btn" : "btn btn-ghost"} style={{ minHeight: 40, padding: "0 14px", display: "flex", alignItems: "center", gap: 8 }}
                  onClick={() => { setRouteId(r.id); setAmount(""); }}>
                  <ChainLogo chain={payChain(r.chainId)!} size={20} />
                  <span>{r.symbol} on {r.chainName}{r.id === DEFAULT_ROUTE ? " · default" : ""}</span>
                </button>
              ))}
            </div>
            <span className="hint" style={{ textAlign: "left" }}>{route.crowd}</span>
          </div>

          <div className="field">
            <label className="mono field-label">Amount to land</label>
            <input className="mono input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={`${route.symbol} on ${route.chainName}`} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {route.amounts.map((v) => (
                <button key={v} className="btn btn-ghost" style={{ minHeight: 30, padding: "0 12px", fontSize: 12 }} onClick={() => setAmount(v)}>{v} {route.symbol}</button>
              ))}
            </div>
            {amount.trim() && target === null && <span className="hint warn">That is not a number.</span>}
            {target !== null && (target < min || target > max) && <span className="hint warn">Between {route.minTarget} and {route.maxTarget} {route.symbol} per transfer for now.</span>}
            <span className="hint" style={{ textAlign: "left" }}>
              Common sizes blend in: most shields of these sizes come from many different wallets. ${DARK_MIN_USD} to ${DARK_MAX_USD.toLocaleString("en-US")} per transfer for now.
            </span>
            {parts && parts.length > 1 && (
              <span className="hint" style={{ textAlign: "left" }}>
                Split big transfers: send this as {parts.length} parts ({parts.map((p) => show(p, route)).join(" + ")}), a few hours apart, each its own transfer.{" "}
                <button className="mono" style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer" }} onClick={() => setAmount(route.splitAt)}>Start with {route.splitAt} {route.symbol}</button>
              </span>
            )}
          </div>

          <div className="fee-row mono" style={ROW}>
            <span>Now {hh(hour)} UTC</span>
            <span>{busyNow ? `a busy hour for ${route.symbol} shields` : `quiet; busier from ${hh(nextBusyHour(route, hour))} UTC`}</span>
          </div>
          {zk && (
            <div className="fee-row mono" style={ROW}>
              <span>Your RAILGUN wallet</span>
              <button className="mono" onClick={copyZk} style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer" }}>{copied ? "copied" : shortZk(zk)}</button>
            </div>
          )}

          {health.status !== "ok" && health.status !== "checking" && <p className="hint warn">The pool isn&apos;t reachable right now.</p>}
          <button className="btn" disabled={!ready} onClick={() => void getQuote()}>{busy ? "Getting a quote…" : "Review"}</button>

          <p className="hint" style={{ marginTop: 4 }}>
            Your RAILGUN wallet comes from your same 12 words: import them into Railway, or any RAILGUN wallet, to see and spend what lands.
            It is not your STELX address and not a public wallet.
          </p>
        </div>
      )}

      {current && (
        <div className="card pane-card">
          <div className="fee-row mono" style={ROW}><span>Status</span><span>{phaseLabel[phase]}{phase === "done" ? " ✓" : ["refunded", "failed"].includes(phase) ? "" : paid ? "…" : ""}</span></div>
          {quote && phase === "review" && (
            <>
              <div className="fee-row mono" style={ROW}><span>Out of your pool</span><span>{usdg ? formatAmount(BigInt(quote.withdraw), usdg, null) : quote.withdraw} USDG</span></div>
              <div className="fee-row mono" style={ROW}><span>Lands on {curRoute.chainName}</span><span>≈ {show(quote.target, curRoute)}{curRoute.symbol === "ETH" ? " + gas" : ""}</span></div>
              <div className="fee-row mono" style={ROW}><span>In RAILGUN, after its {Number(RAILGUN_SHIELD_BPS) / 100}%</span><span>≈ {show(noteOf(BigInt(quote.target)), curRoute)}</span></div>
              <div className="fee-row mono" style={ROW}><span>Pool fee 0.1%</span><span>{usdg ? formatAmount(BigInt(quote.withdraw) - BigInt(quote.amountIn), usdg, null) : ""} USDG</span></div>
              <div className="fee-row mono" style={ROW}>
                <span>Relay, bridge{curRoute.symbol === "ETH" ? " and swap" : ""}</span>
                <span>
                  {quote.impactPct
                    ? `${Math.abs(Number(quote.impactPct)).toFixed(2)}% ≈ $${((quote.usdIn * Math.abs(Number(quote.impactPct))) / 100).toFixed(2)}`
                    : quote.relayFeeUsd ? `$${Number(quote.relayFeeUsd).toFixed(2)}` : ""}
                </span>
              </div>
              {curRoute.symbol === "ETH"
                ? <div className="fee-row mono" style={ROW}><span>Shield gas, held from the ETH</span><span>≤ {eth(BigInt(quote.reserve))} ETH</span></div>
                : <div className="fee-row mono" style={ROW}><span>Gas top-up from Relay</span><span>${(quote.gasTopupUsd ?? 0).toFixed(2)}, about half left over</span></div>}
              <div className="fee-row mono" style={ROW}><span>Arrives in</span><span>~{quote.timeEstimate ?? "?"}s, then one shield</span></div>
              {BigInt(quote.withdraw) > balance && <p className="hint warn">Balance too low for this transfer. Deposit USDG first.</p>}
              {state.stage === "idle" && (
                <button className="btn" disabled={busy || !broadcaster || BigInt(quote.withdraw) > balance} onClick={() => void send()}>{busy ? "Updating quote…" : "Send to RAILGUN"}</button>
              )}
            </>
          )}

          {paid && (
            <>
              <div className="fee-row mono" style={ROW}><span>Landing address</span><span>{landingAddressOf(seed, current.index).slice(0, 10)}…</span></div>
              {landed && <div className="fee-row mono" style={ROW}><span>On it now</span><span>{curRoute.symbol === "ETH" ? `${eth(landed.eth)} ETH` : `${show(landed.token, curRoute)} + ${eth(landed.eth)} ETH gas`}</span></div>}
              {relay?.outTx && <a className="hint" style={{ color: "var(--accent)" }} href={`${curRoute.explorer}/tx/${relay.outTx}`} target="_blank" rel="noopener noreferrer">Relay&apos;s delivery on {curRoute.chainName}</a>}
            </>
          )}
          {phase === "waiting" && waitMsg && (
            <>
              <p className="hint warn">{waitMsg}</p>
              {holdForPerson && !gasOk && <button className="btn btn-ghost" onClick={() => { setGasOk(true); waitUntil.current = 0; }}>Shield anyway at this gas</button>}
            </>
          )}
          {phase === "landed" && err && (
            <button className="btn" onClick={() => { autoOff.current = false; void shield(current); }}>Try the shield again</button>
          )}
          {phase === "done" && (
            <>
              {shielded && <div className="fee-row mono" style={ROW}><span>Note in RAILGUN</span><span>{show(shielded.noteValue, curRoute)}</span></div>}
              {shielded && <a className="hint" style={{ color: "var(--accent)" }} href={`${curRoute.explorer}/tx/${shielded.hash}`} target="_blank" rel="noopener noreferrer">The shield on {curRoute.chainName}</a>}
              <p className="hint">
                It is in your RAILGUN balance on {curRoute.chainName}: import your 12 words into Railway to see it
                {zk ? ` (${shortZk(zk)})` : ""}. RAILGUN checks new shields for about an hour (Private Proof of Innocence) before they
                can be spent; Railway shows it as pending until then. Leave it there a while, and don&apos;t take the same amount straight back out.
              </p>
              <p className="hint">
                Railway also shows a public 0x wallet for the same words. It is Account 1 of your phrase and not private: don&apos;t move this money through it.
              </p>
            </>
          )}
          {phase === "refunded" && (
            <p className="hint warn">
              Relay sent the USDG back on Robinhood Chain{refundAddr ? ` to ${refundAddr}` : ""}: Account {(current.refundIndex ?? 0) + 1} when your 12 words
              are imported into a wallet such as MetaMask or Rabby. It needs a little ETH on Robinhood Chain to move.
            </p>
          )}
          {phase === "failed" && <p className="hint warn">Relay reports it couldn&apos;t deliver. If it refunds, the USDG comes back on Robinhood Chain to Account {(current.refundIndex ?? 0) + 1} of your 12 words.</p>}
          {paid && phase !== "done" && <p className="hint">You can close this page. What lands waits on the landing address, and Earlier transfers finds it again.</p>}
          {state.stage !== "submitting" && <button className="btn btn-ghost" onClick={back}>{phase === "done" ? "Send another" : "Back"}</button>}
        </div>
      )}

      {state.stage !== "idle" && (
        <ProvingPanel
          state={state}
          label={stageLabel(state)}
          onCancel={() => { reset(); }}
          onConfirm={submit}
          confirmLabel="Send"
          kind="unshield"
          hash={hash}
          result={result}
          doneTitle="Out of the pool."
        />
      )}

      <div className="card pane-card" style={{ marginTop: 14 }}>
        <p className="hint" style={{ marginTop: 0 }}>
          What stays public: Relay lists this transfer, from a STELX pool withdrawal to a fresh address on {route.chainName}, and that
          address&apos;s shield into RAILGUN, a minute or two later. What it doesn&apos;t show: who in the STELX pool sent it, or what you
          do in RAILGUN afterwards. The amount of the shield is public too, which is why common sizes help.
        </p>
      </div>

      <div className="card pane-card" style={{ marginTop: 14 }}>
        <div className="fee-row mono" style={ROW}><span>Earlier transfers</span><span>{list.length || "none"}</span></div>
        {list.map(({ record, landed: l }) => {
          const r = routeOf(record);
          const waiting = r && l && hasDelivery(r, l);
          const addr = landingAddressOf(seed, record.index);
          return (
            <div key={record.index} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border-faint)", paddingTop: 10 }}>
              <div className="fee-row mono" style={ROW}>
                <span>#{record.index}{r && record.target ? ` · ${show(record.target, r)}` : ""}{r ? ` to ${r.chainName}` : ""}</span>
                <span>
                  {record.shieldTx && r ? <a href={`${r.explorer}/tx/${record.shieldTx}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>in RAILGUN</a>
                    : waiting ? "landed, not shielded"
                    : l && l.nonce > 0 ? "shielded"
                    : record.paidAt ? "on its way"
                    : "not sent"}
                </span>
              </div>
              {(waiting || (record.paidAt && !record.shieldTx && !(l && l.nonce > 0))) && current?.index !== record.index && (
                <button className="btn btn-ghost" style={{ minHeight: 34, fontSize: 13 }} onClick={() => follow(record)}>{waiting ? "Shield it now" : "Follow it"}</button>
              )}
              {shownKey === record.index ? (
                <div className="mono" style={{ fontSize: 11, lineHeight: 1.6, color: "var(--text-mid)", wordBreak: "break-all" }}>
                  Landing address {addr}<br />
                  Key {darkLandingKey(seed, record.index)}<br />
                  <span style={{ color: "var(--amber)" }}>Anyone with this key can take what&apos;s on this address, on every chain. Import it into a wallet only to move a leftover or a stuck delivery.</span>
                </div>
              ) : (
                <button className="mono" style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, fontSize: 10.5, letterSpacing: "0.12em", color: "var(--text-low)", cursor: "pointer" }} onClick={() => setShownKey(record.index)}>
                  SHOW LANDING KEY
                </button>
              )}
            </div>
          );
        })}
        <button className="btn btn-ghost" disabled={scanning !== null} onClick={() => void scan()}>
          {scanning !== null ? `Checking address ${scanning + 1}…` : "Find transfers from this phrase"}
        </button>
        <p className="hint">Finds transfers made while this page was closed, or on another device.</p>
      </div>
    </div>
  );
}
