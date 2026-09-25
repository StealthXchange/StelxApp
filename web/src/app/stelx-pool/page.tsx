"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, isAddress, parseUnits, type Address, type EIP1193Provider, type Hex } from "viem";
import { Mark } from "@/components/icons";
import { ProvingPanel } from "@/components/pool/ProvingPanel";
import { connect, connectedWalletProvider, hasWallet, watchWallets, type BrowserWallet } from "@/lib/pool/erc20";
import { revealSeed } from "@/lib/pool/walletStore";
import { stageLabel, useProver } from "@/lib/pool/useProver";
import { refusedBeforeSending, type Outcome } from "@/lib/pool/outcome";
import { configuredTokenPool } from "@/lib/pool/tokenPoolConfig";
import {
  checkTokenPool, pickTokenRelay, sendTokenTransaction, tokenApproval, tokenInputsSpent,
  tokenReadiness, tokenWallet, type TokenRelay,
} from "@/lib/pool/tokenPool";
import { decodeAddress } from "@/lib/pool/vendor/keys";
import { submitViaBroadcaster, waitForBroadcast } from "@/lib/pool/vendor/broadcast";
import type { Wallet } from "@/lib/pool/vendor/wallet";
import s from "./token-pool.module.css";

const config = (() => { try { return configuredTokenPool(); } catch { return null; } })();
const TABS = ["Deposit", "Send", "Withdraw", "Receive"] as const;
type Tab = typeof TABS[number];
const message = (e: unknown) => e instanceof Error ? e.message : "Something went wrong. Please try again.";

export default function StelxPoolPage() {
  return (
    <main className={s.page}>
      <header className={s.header}>
        <Link href="/" className={s.brand}><Mark size={28} /> STELX</Link>
        <Link href="/pool">Your wallet</Link>
      </header>
      <div className={s.content}>
        <p className={s.kicker}>STELX TOKEN POOL</p>
        <h1 className={s.title}>Your STELX.<br /><span>Held privately.</span></h1>
        {config ? <TokenWallet /> : (
          <section className={`card ${s.card}`}>
            <h2>Coming next.</h2>
            <p>The STELX token pool is not live yet. Follow its progress on the roadmap.</p>
            <Link className="btn" href="/roadmap">View roadmap</Link>
          </section>
        )}
      </div>
    </main>
  );
}

function TokenWallet() {
  const c = config!;
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [health, setHealth] = useState<"checking" | "ok" | "error">("checking");
  const [minimum, setMinimum] = useState(0n);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relayError, setRelayError] = useState<string | null>(null);
  const [relay, setRelay] = useState<TokenRelay | null>(null);
  const [tab, setTab] = useState<Tab>("Deposit");
  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [wallets, setWallets] = useState<BrowserWallet[]>([]);
  const [connection, setConnection] = useState<{ account: Address; provider: EIP1193Provider } | null>(null);
  const [readiness, setReadiness] = useState<{ balance: bigint; allowance: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<Hex | null>(null);
  const [deposited, setDeposited] = useState(false);
  const [result, setResult] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState(false);
  const wallet = useRef<Wallet | null>(null);
  const refreshing = useRef<Promise<void> | null>(null);
  const { state, build, reset, setSubmitting } = useProver(mnemonic, c);
  const locked = busy || state.stage !== "idle";
  const fmt = (n: bigint) => formatUnits(n, c.decimals);
  const transactionUrl = (h: string) => `${c.explorer}/tx/${h}`;

  useEffect(() => {
    const t = setTimeout(() => { setMnemonic(revealSeed()); setRestored(true); }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => watchWallets(setWallets), []);
  useEffect(() => {
    let active = true;
    void checkTokenPool(c).then((h) => {
      if (active) { setMinimum(h.minimum); setHealth("ok"); }
    }).catch((e) => { if (active) { setHealth("error"); setError(message(e)); } });
    void pickTokenRelay(c).then((r) => { if (active) setRelay(r); }).catch((e) => { if (active) setRelayError(message(e)); });
    return () => { active = false; };
  }, [c]);

  const refresh = useCallback(() => {
    if (!mnemonic) return Promise.resolve();
    if (refreshing.current) return refreshing.current;
    const run = async () => {
      setScanning(true); setScanError(null);
      try {
        const w = wallet.current ?? await tokenWallet(mnemonic, c);
        wallet.current = w;
        setAddress(w.keys.address);
        await w.scan();
        setBalance(await w.getBalance(c.token));
      } catch (e) { setScanError(message(e)); }
      finally { setScanning(false); refreshing.current = null; }
    };
    return (refreshing.current = run());
  }, [mnemonic, c]);

  useEffect(() => {
    if (health !== "ok" || locked) return;
    const first = setTimeout(() => void refresh(), 0);
    const every = setInterval(() => { if (document.visibilityState === "visible" && !locked) void refresh(); }, 20_000);
    return () => { clearTimeout(first); clearInterval(every); };
  }, [health, refresh, locked]);

  const parsed = useMemo(() => {
    const v = amount.trim();
    if (!/^(?:\d+\.?\d*|\.\d+)$/.test(v) || (v.split(".")[1]?.length ?? 0) > c.decimals) return null;
    try { const n = parseUnits(v, c.decimals); return n > 0n && n < 1n << 120n ? n : null; } catch { return null; }
  }, [amount, c.decimals]);
  const validRecipient = useMemo(() => {
    if (tab === "Withdraw") return isAddress(to.trim()) && !/^0x0{40}$/i.test(to.trim()) && to.trim().toLowerCase() !== c.pool.toLowerCase();
    if (tab !== "Send") return true;
    try { decodeAddress(to.trim()); return true; } catch { return false; }
  }, [tab, to, c.pool]);
  const fee = relay?.fee ?? 0n;
  const amountFits = parsed !== null && balance !== null && parsed + fee <= balance;
  const canSpend = health === "ok" && !!relay && !!parsed && amountFits && validRecipient && !scanError && !scanning && !locked;
  const canDeposit = health === "ok" && !!parsed && parsed >= minimum && !!readiness && parsed <= readiness.balance && !locked;

  async function connectWallet(id?: string) {
    setBusy(true); setError(null); setReadiness(null);
    try {
      const account = await connect(id);
      setConnection({ account, provider: connectedWalletProvider() as EIP1193Provider });
      setReadiness(await tokenReadiness(c, account));
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  async function deposit() {
    if (!canDeposit || !connection || !parsed || !wallet.current || !readiness) return;
    setBusy(true); setError(null); setHash(null); setDeposited(false);
    try {
      const { account, provider } = connection;

      const now = await tokenReadiness(c, account);
      if (now.allowance < parsed) {
        await sendTokenTransaction(c, provider, account, tokenApproval(c, parsed));
        setReadiness(await tokenReadiness(c, account));
        return;
      }
      const tx = await wallet.current.buildShield(c.token, parsed);
      setHash(await sendTokenTransaction(c, provider, account, tx));
      setDeposited(true);
      await refresh();
      setReadiness(await tokenReadiness(c, account));
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }

  function clear() {
    reset(); setResult(null); setHash(null); setError(null); setDeposited(false);
  }

  async function submit() {
    if (!state.tx || !relay || state.stage !== "done" || busy) return;
    setBusy(true); setSubmitting(); setError(null);
    try {
      const h = await submitViaBroadcaster(relay, state.tx as Parameters<typeof submitViaBroadcaster>[1]);
      setHash(h);
      const outcome = await waitForBroadcast(relay, h);
      setResult(outcome);
      if (outcome === "success") await refresh();
    } catch (e) {
      const text = message(e);
      setError(text);
      if (refusedBeforeSending(text)) setResult("refused");
      else {
        setResult("checking");
        if (await tokenInputsSpent(c, state.tx.data as Hex)) { setResult("success"); await refresh(); }
        else setResult("unknown");
      }
    } finally { setBusy(false); }
  }

  if (!restored) return <p className={s.note}>Opening your wallet…</p>;
  if (!mnemonic) return (
    <section className={`card ${s.card}`}>
      <h2>One wallet. A separate STELX balance.</h2>
      <p>Create or recover your STELX wallet to use the token pool.</p>
      <Link href="/pool/setup" className="btn">Create or recover wallet</Link>
    </section>
  );

  return (
    <>
      <section className={`card ${s.balance}`}>
        <div className={s.balanceHead}><span className="mono">PRIVATE BALANCE</span><span>{c.chainName}</span></div>
        <div className={s.amount}>{balance === null ? "—" : fmt(balance)} <span>STELX</span></div>
        <div className={s.balanceHead}>
          <span>{health === "checking" ? "Checking the pool…" : health === "error" ? "Pool unavailable" : scanning ? "Syncing…" : scanError ? "Could not update balance" : "Synced"}</span>
          <button className={s.textButton} disabled={locked || scanning || health !== "ok"} onClick={() => void refresh()}>Refresh</button>
        </div>
      </section>
      <div className={s.tabs} role="tablist" aria-label="STELX pool actions">
        {TABS.map((t) => <button key={t} id={`tab-${t}`} type="button" role="tab" aria-controls="token-action" aria-selected={tab === t} disabled={locked} onClick={() => { setTab(t); setAmount(""); setTo(""); clear(); }}>{t}</button>)}
      </div>
      <section id="token-action" role="tabpanel" aria-labelledby={`tab-${tab}`} className={`card ${s.card}`}>
        {tab === "Receive" ? (
          <>
            <h2>Receive STELX privately.</h2>
            <p>Share this address with someone sending from the STELX token pool.</p>
            <div className={s.address}>{address || "Loading your address…"}</div>
            <button className="btn" disabled={!address} onClick={async () => {
              try { await navigator.clipboard.writeText(address); setCopied(true); } catch { setError("Could not copy. Select the address above to copy it."); }
            }}>{copied ? "Copied" : "Copy address"}</button>
          </>
        ) : (
          <>
            <h2>{tab} STELX</h2>
            <p className={s.note}>{tab === "Deposit" ? "Deposits are public. You pay the deposit gas in ETH." : tab === "Withdraw" ? "The withdrawal amount and destination are public." : "Send to another wallet inside the STELX token pool."}</p>
            <fieldset className={s.fields} disabled={locked}>
              {tab === "Deposit" ? (
                <>
                  {!connection ? <div className={s.wallets}>
                    {wallets.length ? wallets.map((w) => <button key={w.id} className="btn btn-ghost" type="button" onClick={() => void connectWallet(w.id)}>Connect {w.name}</button>) : <button className="btn btn-ghost" disabled={!hasWallet()} onClick={() => void connectWallet()}>Connect wallet</button>}
                  </div> : <p className={s.connected}>{connection.account.slice(0, 8)}…{connection.account.slice(-6)} · {readiness ? `${fmt(readiness.balance)} STELX available` : "Loading balance…"} <button className={s.textButton} type="button" onClick={() => { setConnection(null); setReadiness(null); }}>Change</button></p>}
                </>
              ) : <label className={s.field}>To<input className="input mono" value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} placeholder={tab === "Send" ? "stelx1…" : "0x…"} />{to && !validRecipient && <span className={s.note}>Enter a valid {tab === "Send" ? "STELX" : "wallet"} address.</span>}</label>}
              <label className={s.field}>Amount<input className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0 STELX" /></label>
              {amount && !parsed && <p className={s.note}>Enter a positive amount with up to {c.decimals} decimal places.</p>}
              {tab !== "Deposit" && balance !== null && <button className={s.textButton} type="button" disabled={!relay || balance <= fee} onClick={() => setAmount(fmt(balance > fee ? balance - fee : 0n))}>Use available balance</button>}
            </fieldset>
            {tab === "Deposit" ? (
              <>
                {parsed && parsed < minimum && <p className={s.note}>Minimum deposit: {fmt(minimum)} STELX</p>}
                {parsed && readiness && parsed > readiness.balance && <p className={s.note}>Not enough STELX in your connected wallet.</p>}
                {parsed && <div className={s.fee}><span>Private balance added · 0.1% protocol fee</span><span>{fmt(parsed - parsed / 1000n)} STELX</span></div>}
                <button className="btn" disabled={!canDeposit || !address} onClick={() => void deposit()}>{busy ? "Waiting for your wallet…" : readiness && parsed && readiness.allowance < parsed ? "Approve STELX" : "Deposit STELX"}</button>
              </>
            ) : (
              <>
                <div className={s.fee}><span>Relay fee</span><span>{relay ? (fee === 0n ? "Free" : `${fmt(fee)} STELX`) : "Unavailable"}</span></div>
                {tab === "Withdraw" && parsed && <div className={s.fee}><span>Recipient gets · 0.1% protocol fee</span><span>{fmt(parsed - parsed / 1000n)} STELX</span></div>}
                {parsed && balance !== null && !amountFits && <p className={s.note}>Not enough private STELX to cover the amount{fee > 0n ? " and relay fee" : ""}.</p>}
                {state.stage === "idle" && <button className="btn" disabled={!canSpend} onClick={() => {
                  if (relay && parsed) build(tab === "Send" ? "transfer" : "unshield", c.token, to.trim(), parsed, relay.address, relay.shieldedAddress, fee);
                }}>{tab} STELX</button>}
              </>
            )}
          </>
        )}
      </section>
      {deposited && hash && <p role="status" className={s.notice}>Deposited. <a href={transactionUrl(hash)} target="_blank" rel="noreferrer">View transaction</a></p>}
      {state.stage === "submitting" && !result ? <p role="status" className={s.notice}>Sending to the relay. Waiting for confirmation…</p> : state.stage !== "idle" && <ProvingPanel state={state} label={stageLabel(state)} onCancel={clear} onConfirm={() => void submit()} confirmLabel={tab === "Withdraw" ? "Confirm withdrawal" : "Confirm send"} hash={hash} result={result} kind={tab === "Withdraw" ? "unshield" : "transfer"} transactionUrl={transactionUrl} balanceUpdated={!scanError} />}
      {result === "success" && <button className="btn btn-ghost" onClick={clear}>Done</button>}
      {(error || scanError) && <p role="alert" className={s.notice}>{error ?? scanError}</p>}
      {relayError && (tab === "Send" || tab === "Withdraw") && <p role="status" className={s.notice}>{relayError} <button className={s.textButton} onClick={() => void pickTokenRelay(c).then((r) => { setRelay(r); setRelayError(null); }).catch((e) => setRelayError(message(e)))}>Try again</button></p>}
      <p className={s.footer}>This pool holds STELX separately from your stocks and other assets.{fee > 0n && " Relay fees come from your private STELX balance."}</p>
    </>
  );
}
