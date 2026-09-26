"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther, formatUnits, parseUnits, type Address } from "viem";
import { IS_MAINNET, txUrl } from "@/lib/pool/config";
import { revealSeed } from "@/lib/pool/walletStore";
import { usePool } from "@/lib/pool/usePool";
import { usePoolHealth } from "@/lib/pool/health";
import { FEE_BPS } from "@/lib/pool/vendor/wallet";
import { landingKey, landingSolanaAddress, landingSolanaKey } from "@/lib/pool/landingKeys";
import {
  allocateLanding, depositArrival, findArrivals, hasArrival, hasLeftover, landingAddress, loadArrivals, readLanding, saveArrival,
  sweepLeftover, type ArrivalRecord, type DepositStep, type Landed,
} from "@/lib/pool/onramp";
import {
  arrivesAs, assetDecimals, assetSymbol, ONRAMP_CHAINS, ONRAMP_MAX_USD, ONRAMP_MIN_USD, ONRAMP_RECHECK, onrampChain,
  type OnrampAsset, type OnrampChain,
} from "@/lib/pool/onrampRoutes";
import { ChainPicker } from "@/components/pool/ChainPicker";

interface Quote {

  depositAddress: string;
  amountIn: string;
  amountOut: string;
  symbolOut: string;
  gasTopup: string | null;
  timeEstimate: number | null;
  feeUsd: string | null;
}

const QUICK: Record<string, string[]> = { USDC: ["25", "100", "500"], ETH: ["0.01", "0.05", "0.1"] };

const DEFAULT_CHAIN = 8453;

const ROW = { gap: 12 };
const POLL_MS = 4000;

const GAS_WAIT_MS = 90_000;

const RECHECK_AFTER_MS = 60_000;
const RECHECK_EVERY_MS = 60_000;

const RECHECK_WITHIN_MS = 7 * 24 * 3600_000;

async function post(path: string, body: unknown) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Failed (${r.status})`);
  return j;
}

const trim = (s: string, dp: number) => (s.includes(".") ? s.replace(new RegExp(`(\\.\\d{0,${dp}})\\d*$`), "$1").replace(/\.?0+$/, "") : s);
const usdg = (raw: bigint) => trim(formatUnits(raw, 6), 2);
const eth = (raw: bigint) => trim(formatEther(raw), 6);

const stamped = (r: Omit<ArrivalRecord, "at">): ArrivalRecord => ({ ...r, at: Date.now() });

const recheck = (chainId: number, depositAddress: string) =>
  post("/api/onramp/reindex", { chainId, depositAddress }).catch(() => null);

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Phase = "waiting" | "bridging" | "landed" | "depositing" | "done" | "refunded" | "failed";

export default function ArrivePage() {
  const pool = usePool();
  const health = usePoolHealth();
  const seed = revealSeed();

  const [chainId, setChainId] = useState(DEFAULT_CHAIN);
  const [asset, setAsset] = useState<OnrampAsset>("usdc");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [current, setCurrent] = useState<(ArrivalRecord & { landing: Address }) | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [step, setStep] = useState<string | null>(null);
  const [landed, setLanded] = useState<Landed | null>(null);
  const [copied, setCopied] = useState(false);
  const [relayTx, setRelayTx] = useState<{ inTx: string | null; outTx: string | null } | null>(null);
  const usdgSince = useRef<number | null>(null);
  const running = useRef(false);

  const autoOff = useRef(false);
  const [depositing, setDepositing] = useState(false);

  const [swept, setSwept] = useState(0n);

  const [list, setList] = useState<{ record: ArrivalRecord; landed: Landed | null }[]>([]);
  const [scanning, setScanning] = useState<number | null>(null);
  const [shownKey, setShownKey] = useState<string | null>(null);

  const chain = onrampChain(chainId)!;
  const symbol = assetSymbol(chain, asset);
  let parsed: bigint | null = null;
  try { parsed = amount.trim() ? parseUnits(amount.trim(), assetDecimals(chain, asset)) : null; } catch { parsed = null; }

  const ready = Boolean(seed && pool.address && parsed !== null && parsed > 0n && health.status === "ok" && !busy);
  const pickChain = (c: OnrampChain) => { setChainId(c.id); if (!c.native) setAsset("usdc"); setAmount(""); };

  const readList = useCallback(async () => {
    if (!seed || !pool.address) return [];
    return Promise.all(loadArrivals(pool.address).map(async (record) => ({
      record, landed: await readLanding(landingAddress(seed, record.index)).catch(() => null),
    })));
  }, [seed, pool.address]);
  const reloadList = useCallback(async () => setList(await readList()), [readList]);

  const sweepEarlier = useCallback(async (found: { index: number; landed: Landed | null }[]) => {
    if (!seed || running.current || !found.some(({ landed: l }) => l && hasLeftover(l))) return;
    running.current = true; setDepositing(true);
    try {
      for (const { index, landed: l } of found) {
        if (!l || !hasLeftover(l)) continue;
        const s = await sweepLeftover(seed, index).catch(() => 0n);
        if (s > 0n) setSwept((x) => x + s);
      }
    } finally {
      running.current = false; setDepositing(false);
      void reloadList();
    }
  }, [seed, reloadList]);

  useEffect(() => {
    let live = true;
    readList().then((l) => {
      if (!live) return;
      setList(l);
      void sweepEarlier(l.map(({ record, landed }) => ({ index: record.index, landed })));

      for (const { record: r, landed: x } of l) {
        if (r.chainId && ONRAMP_RECHECK.has(r.chainId) && r.depositAddress && x && x.nonce === 0 && !hasArrival(x) && Date.now() - r.at < RECHECK_WITHIN_MS) {
          void recheck(r.chainId, r.depositAddress);
        }
      }
    }, () => {});
    return () => { live = false; };
  }, [readList, sweepEarlier]);

  async function review() {
    if (!ready || !seed || !pool.address || parsed === null) return;
    setBusy(true); setErr(null);
    try {
      const { index, address } = await allocateLanding(seed, pool.address);

      const refundTo = chain.vm === "svm" ? landingSolanaAddress(seed, index) : address;
      const q = await post("/api/onramp/quote", { chainId, asset, amount: parsed.toString(), recipient: address, refundTo });
      const record = stamped({ index, chainId, asset, amountIn: parsed.toString(), requestId: q.requestId, depositAddress: q.depositAddress });

      saveArrival(pool.address, record);
      setQuote(q); setCurrent({ ...record, landing: address }); setPhase("waiting"); setLanded(null); setRelayTx(null);
      usdgSince.current = null; autoOff.current = false;
      void reloadList();
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setBusy(false); }
  }

  const deposit = useCallback(async (index: number, landing: Address) => {
    if (!seed || !pool.address || running.current) return;
    running.current = true; setDepositing(true); setErr(null);
    if (current?.index === index) setPhase("depositing");
    try {
      const labels: Record<DepositStep, string> = { wrap: "Wrapping ETH", approve: "Approving", deposit: "Depositing", sweep: "Sweeping leftover gas" };
      const onStep = (s: DepositStep, sym: string) => setStep(`${labels[s]} ${s === "wrap" || s === "sweep" ? "" : sym}`.trim());
      const hashes = await depositArrival(seed, index, onStep);
      const rec = loadArrivals(pool.address).find((r) => r.index === index);
      if (rec && hashes.length) saveArrival(pool.address, { ...rec, depositTx: hashes.at(-1) });

      const s = await sweepLeftover(seed, index, onStep).catch(() => 0n);
      if (s > 0n) setSwept((x) => x + s);
      if (current?.index === index) setPhase("done");
      setLanded(await readLanding(landing));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      autoOff.current = true;
      if (current?.index === index) setPhase("landed");
    } finally {
      running.current = false; setDepositing(false); setStep(null);
      void reloadList();
    }
  }, [seed, pool.address, current, reloadList]);

  const lastRecheck = useRef(0);
  useEffect(() => {
    if (!current || phase === "done" || phase === "depositing") return;
    let live = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/onramp/status?user=${current.landing}`, { cache: "no-store" }).then((x) => x.json());
        const q = r.requests?.[0];
        if (live && q) {
          setRelayTx({ inTx: q.inTx, outTx: q.outTx });
          if (q.status === "refund" || q.status === "refunded") setPhase("refunded");
          else if (q.status === "failure") setPhase("failed");
          else if (phase === "waiting") setPhase("bridging");
        } else if (live && phase === "waiting" && current.chainId && ONRAMP_RECHECK.has(current.chainId) && current.depositAddress) {

          const now = Date.now();
          if (now - current.at >= RECHECK_AFTER_MS && now - lastRecheck.current >= RECHECK_EVERY_MS) {
            lastRecheck.current = now;
            void recheck(current.chainId, current.depositAddress);
          }
        }
      } catch {  }
      try {
        const l = await readLanding(current.landing);
        if (!live) return;
        setLanded(l);
        if (!hasArrival(l)) return;
        if (phase === "waiting" || phase === "bridging") setPhase("landed");

        if (l.usdg > 0n && l.eth === 0n) {
          usdgSince.current ??= Date.now();
          if (Date.now() - usdgSince.current < GAS_WAIT_MS) return;
        }
        if (!autoOff.current) void deposit(current.index, current.landing);
      } catch {  }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [current, phase, deposit]);

  async function scan() {
    if (!seed || !pool.address) return;
    setErr(null); setScanning(0);
    try {
      const found = await findArrivals(seed, pool.address, setScanning);
      await reloadList();
      void sweepEarlier(found);
    }
    catch (e) { setErr(String((e as Error).message ?? e)); }
    finally { setScanning(null); }
  }

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
        <h1 className="pane-title">Arrive from another chain</h1>
        <p className="hint">Only on mainnet: the bridge doesn&apos;t serve the testnet.</p>
      </div>
    );
  }

  const arriving = quote ? BigInt(quote.amountOut) : null;
  const fromChain = (current?.chainId ? onrampChain(current.chainId) : null) ?? chain;
  const inAsset = current?.asset ?? asset;
  const inUnit = assetSymbol(fromChain, inAsset);
  const phaseLabel: Record<Phase, string> = {
    waiting: `Waiting for your ${inUnit}`,
    bridging: "Bridging",
    landed: "Landed",
    depositing: step ?? "Depositing",
    done: "In your pool",
    refunded: "Refunded",
    failed: "Not delivered",
  };

  return (
    <div className="pane">
      <h1 className="pane-title">Arrive from another chain</h1>
      <p className="hint">USDC from {ONRAMP_CHAINS.length} chains, Solana included, or ETH, into your pool in one transfer. From any wallet or exchange.</p>
      {err && <p className="hint warn">{err}</p>}
      {swept > 0n && <p className="hint">Swept {eth(swept)} ETH of leftover gas into your balance.</p>}

      {!current && (
        <div className="card pane-card">
          <ChainPicker value={chain} onChange={(c) => pickChain(onrampChain(c.id)!)} chains={ONRAMP_CHAINS} label="From" />

          <div className="field">
            <label className="mono field-label">Send</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(chain.native ? (["usdc", "native"] as const) : (["usdc"] as const)).map((a) => (
                <button key={a} className={a === asset ? "btn" : "btn btn-ghost"} style={{ minHeight: 36, padding: "0 14px" }} onClick={() => { setAsset(a); setAmount(""); }}>
                  {assetSymbol(chain, a)}
                </button>
              ))}
            </div>
            <span className="hint" style={{ textAlign: "left" }}>
              {asset === "usdc" ? "Arrives in the pool as USDG, one for one less fees."
                : arrivesAs(chain, asset) === "eth" ? "Arrives in the pool as WETH, less a little kept for gas."
                : `Swapped to USDG on the way, at Relay's rate.`}
            </span>
          </div>

          <div className="field">
            <label className="mono field-label">Amount</label>
            <input className="mono input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder={`${symbol} on ${chain.name}`} />
            {QUICK[symbol] && (
              <div style={{ display: "flex", gap: 8 }}>
                {QUICK[symbol].map((v) => (
                  <button key={v} className="btn btn-ghost" style={{ minHeight: 30, padding: "0 12px", fontSize: 12 }} onClick={() => setAmount(v)}>{v}</button>
                ))}
              </div>
            )}
            {amount.trim() && parsed === null && <span className="hint warn">That is not a number.</span>}
            <span className="hint" style={{ textAlign: "left" }}>
              ${ONRAMP_MIN_USD} to ${ONRAMP_MAX_USD.toLocaleString("en-US")} per arrival for now.
            </span>
          </div>

          {health.status !== "ok" && health.status !== "checking" && <p className="hint warn">The pool isn&apos;t reachable right now.</p>}
          <button className="btn" disabled={!ready} onClick={() => void review()}>{busy ? "Getting a quote…" : "Get deposit address"}</button>

          <p className="hint" style={{ marginTop: 4 }}>
            The deposit is public, like any deposit: the transfer you send can be followed into the pool. What you do
            after is private. Relay bridges it and holds it for a few seconds; STELX never holds it.
          </p>
        </div>
      )}

      {current && quote && (
        <div className="card pane-card">
          {phase === "waiting" && (
            <>
              <div className="field">
                <label className="mono field-label">Send exactly</label>
                <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--text-hi)" }}>
                  {formatUnits(BigInt(quote.amountIn), assetDecimals(fromChain, inAsset))} {inUnit} <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text-mid)" }}>on {fromChain?.name}</span>
                </div>
              </div>
              <div className="field">
                <label className="mono field-label">To this address</label>
                <button
                  className="mono"
                  onClick={() => { navigator.clipboard?.writeText(quote.depositAddress); setCopied(true); setTimeout(() => setCopied(false), 1400); }}
                  style={{ textAlign: "left", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, padding: "12px 14px", fontSize: 13, color: "var(--text-hi)", wordBreak: "break-all", cursor: "pointer" }}
                >
                  {quote.depositAddress}
                  <span style={{ display: "block", marginTop: 6, fontSize: 10.5, letterSpacing: "0.14em", color: "var(--accent)" }}>{copied ? "COPIED" : "TAP TO COPY"}</span>
                </button>
                {fromChain.vm === "svm" ? (
                  <>
                    <span className="hint warn" style={{ textAlign: "left" }}>
                      Only USDC on Solana, the token with mint {short(fromChain.usdc)}. Another token or network won&apos;t arrive.
                    </span>
                    <span className="hint" style={{ textAlign: "left" }}>
                      Send it from any Solana wallet, or withdraw it from an exchange on the Solana network. No memo needed.
                    </span>
                  </>
                ) : !ONRAMP_RECHECK.has(fromChain.id) && (
                  <span className="hint warn" style={{ textAlign: "left" }}>
                    Only {inUnit} on {fromChain?.name}. Another token or chain won&apos;t arrive.
                  </span>
                )}
                {ONRAMP_RECHECK.has(fromChain.id) && (
                  <>
                    <span className="hint warn" style={{ textAlign: "left" }}>
                      Only USDC on {fromChain.name}, sent as a token transfer: the USDC token at {short(fromChain.usdc)}, not {fromChain.name}&apos;s
                      gas coin. Wallets such as MetaMask show {fromChain.name}&apos;s USDC as the network&apos;s own coin as well: pick the token.
                    </span>
                    <span className="hint" style={{ textAlign: "left" }}>
                      Sent the gas coin anyway? This page asks Relay to look again after a minute. Anything Relay can&apos;t deliver is
                      refunded to your landing address on {fromChain.name}, or can be reclaimed at{" "}
                      <a href="https://relay.link/withdraw" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>relay.link/withdraw</a>{" "}
                      with its key, under Earlier arrivals.
                    </span>
                  </>
                )}
              </div>
            </>
          )}

          <div className="fee-row mono" style={ROW}><span>Status</span><span>{phaseLabel[phase]}{phase === "done" ? " ✓" : phase === "refunded" || phase === "failed" ? "" : "…"}</span></div>
          {arriving !== null && (
            <div className="fee-row mono" style={ROW}>
              <span>Arrives</span>
              <span>≈ {quote.symbolOut === "USDG" ? `${usdg(arriving)} USDG` : `${eth(arriving)} ETH`}{quote.gasTopup ? " + gas" : ""}</span>
            </div>
          )}
          {quote.feeUsd && <div className="fee-row mono" style={ROW}><span>Bridge fee</span><span>${Number(quote.feeUsd).toFixed(2)}</span></div>}
          <div className="fee-row mono" style={ROW}><span>Pool fee {Number(FEE_BPS) / 100}%</span><span>on deposit</span></div>
          {quote.timeEstimate !== null && phase === "waiting" && (
            <div className="fee-row mono" style={ROW}><span>Bridge time</span><span>~{quote.timeEstimate}s after your transfer confirms</span></div>
          )}
          {relayTx?.inTx && fromChain && (
            <a className="hint" style={{ color: "var(--accent)" }} href={`${fromChain.explorer}/tx/${relayTx.inTx}`} target="_blank" rel="noopener noreferrer">
              Your transfer on {fromChain.name}
            </a>
          )}
          {landed && landed.usdg > 0n && landed.eth === 0n && phase === "landed" && (
            <p className="hint">USDG is here; waiting a moment for the gas that comes with it.</p>
          )}
          {phase === "done" && (
            <p className="hint">
              Deposited as a note only your phrase can spend. <Link href="/pool" style={{ color: "var(--accent)" }}>See your balance</Link>
            </p>
          )}
          {phase === "landed" && !depositing && err && (
            <button className="btn" onClick={() => { autoOff.current = false; void deposit(current.index, current.landing); }}>Try the deposit again</button>
          )}
          {(phase === "refunded" || phase === "failed") && (
            <p className="hint warn">
              Relay sends refunds to your landing address on {fromChain?.name},{" "}
              {fromChain.vm === "svm" ? landingSolanaAddress(seed, current.index) : current.landing}, less its gas. That address
              belongs to your phrase; its key is under Earlier arrivals below.
            </p>
          )}
          <p className="hint">You can close this page. Your funds wait on your landing address, and Earlier arrivals finds them.</p>
          <button className="btn btn-ghost" onClick={() => { setCurrent(null); setQuote(null); setAmount(""); setErr(null); }}>
            {phase === "done" ? "Arrive again" : "Back"}
          </button>
        </div>
      )}

      <div className="card pane-card" style={{ marginTop: 14 }}>
        <div className="fee-row mono" style={ROW}><span>Earlier arrivals</span><span>{list.length || "none"}</span></div>
        {list.map(({ record, landed: l }) => {
          const addr = landingAddress(seed, record.index);
          const waiting = l && hasArrival(l);
          const c = record.chainId ? onrampChain(record.chainId) : null;
          return (
            <div key={record.index} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border-faint)", paddingTop: 10 }}>
              <div className="fee-row mono" style={ROW}>
                <span>
                  #{record.index}
                  {c && record.asset && record.amountIn ? ` · ${formatUnits(BigInt(record.amountIn), assetDecimals(c, record.asset))} ${assetSymbol(c, record.asset)}` : ""}
                  {c ? ` from ${c.name}` : ""}
                </span>
                <span>
                  {waiting ? "waiting to deposit"
                    : record.depositTx ? <a href={txUrl(record.depositTx)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>deposited</a>
                    : l && l.nonce > 0 ? "deposited"
                    : "nothing arrived"}
                </span>
              </div>
              {waiting && l && (
                <button className="btn btn-ghost" style={{ minHeight: 34, fontSize: 13 }} disabled={depositing} onClick={() => void deposit(record.index, addr)}>
                  Deposit {l.usdg > 0n ? `${usdg(l.usdg)} USDG` : l.weth > 0n ? `${eth(l.weth)} WETH` : `${eth(l.eth)} ETH`}
                </button>
              )}
              {shownKey === addr ? (
                <div className="mono" style={{ fontSize: 11, lineHeight: 1.6, color: "var(--text-mid)", wordBreak: "break-all" }}>
                  Landing address {addr}<br />
                  Key {landingKey(seed, record.index)}<br />
                  {c?.vm === "svm" && (
                    <>
                      Solana refund address {landingSolanaAddress(seed, record.index)}<br />
                      Solana key {landingSolanaKey(seed, record.index)}<br />
                    </>
                  )}
                  <span style={{ color: "var(--amber)" }}>
                    {c?.vm === "svm"
                      ? "Anyone with these keys can take what's on these addresses. Import one into a wallet (the Solana key into a Solana wallet such as Phantom) only to move a refund, or to reclaim a stuck deposit at relay.link/withdraw."
                      : c && ONRAMP_RECHECK.has(c.id)
                        ? "Anyone with this key can take what's on this address, on every chain. Import it into a wallet only to move a refund, or to reclaim a stuck deposit at relay.link/withdraw."
                        : "Anyone with this key can take what's on this address, on every chain. Import it into a wallet only to move a refund."}
                  </span>
                </div>
              ) : (
                <button className="mono" style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, fontSize: 10.5, letterSpacing: "0.12em", color: "var(--text-low)", cursor: "pointer" }} onClick={() => setShownKey(addr)}>
                  SHOW LANDING KEY (FOR REFUNDS)
                </button>
              )}
            </div>
          );
        })}
        <button className="btn btn-ghost" disabled={scanning !== null} onClick={() => void scan()}>
          {scanning !== null ? `Checking address ${scanning + 1}…` : "Find arrivals from this phrase"}
        </button>
        <p className="hint">Finds funds that landed while this page was closed, or on another device.</p>
      </div>
    </div>
  );
}
