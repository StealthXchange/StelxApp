"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type Address } from "viem";
import { AlertTriangle, CheckCircle } from "@/components/icons";
import { FAUCETS, IS_MAINNET, POOL_CHAIN_ID, txUrl } from "@/lib/pool/config";
import {
  approve, connect, currentChainId, ensureChain, GAS_RESERVE, hasWallet, readReadiness, submitSelf, watchWallets, wrap,
  type BrowserWallet, type DepositReadiness,
} from "@/lib/pool/erc20";
import { refresh, walletFor } from "@/lib/pool/walletStore";
import { usePoolHealth } from "@/lib/pool/health";
import { shortAddr, usePool, weth } from "@/lib/pool/usePool";
import { BPS, FEE_BPS } from "@/lib/pool/vendor/wallet";
import { amountText, ASSETS, formatAmount, parseAmount, readMultiplier, WETH, type Asset } from "@/lib/pool/assets";
import { AssetPicker } from "@/components/pool/AssetPicker";

const FEE_PCT = `${Number(FEE_BPS) / 100}%`;
const poolFee = (amount: bigint) => (amount * FEE_BPS) / BPS;

const DEFAULT_AMOUNT = IS_MAINNET ? "0.01" : "0.001";
const QUICK_PICKS = IS_MAINNET ? [0.01, 0.1, 1] : [0.001, 0.002, 0.005];

const WALLET_QUIET_MS = 20_000;

export default function ShieldPage() {
  const pool = usePool();

  const health = usePoolHealth();
  const poolOk = health.status === "ok";
  const [account, setAccount] = useState<Address | null>(null);
  const [chainOk, setChainOk] = useState<boolean | null>(null);

  const [asset, setAsset] = useState<Asset>(() => {
    const s = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("asset");
    return (s && ASSETS.find((a) => a.symbol === s.toUpperCase())) || WETH;
  });
  const [multiplier, setMultiplier] = useState<bigint | null>(null);
  const [ready, setReady] = useState<DepositReadiness | null>(null);
  const [amount, setAmount] = useState(() => (asset === WETH ? DEFAULT_AMOUNT : ""));
  const [busy, setBusy] = useState<string | null>(null);
  const [quiet, setQuiet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [wallets, setWallets] = useState<BrowserWallet[]>([]);

  useEffect(() => watchWallets(setWallets), []);

  const isWeth = asset === WETH;
  const parsed = parseAmount(amount, asset, multiplier);

  const reload = useCallback(async (a: Address, token: Address) => {
    try { setReady(await readReadiness(a, token)); } catch (e: any) { setError(String(e?.shortMessage ?? e?.message ?? e)); }
  }, []);

  useEffect(() => { if (account) void reload(account, asset.address); }, [account, asset, reload]);

  useEffect(() => {
    let live = true;
    readMultiplier(asset).then((m) => { if (live) setMultiplier(m); }, (e) => { if (live) setError(String(e?.shortMessage ?? e?.message ?? e)); });
    return () => { live = false; };
  }, [asset]);

  function pick(a: Asset) {
    setAsset(a); setMultiplier(null); setReady(null); setDone(null); setError(null);
    setAmount(a === WETH ? DEFAULT_AMOUNT : "");
  }

  async function doConnect(walletId?: string) {
    setError(null);
    try {
      const a = await connect(walletId);
      setAccount(a);
      const id = await currentChainId();
      setChainOk(id === POOL_CHAIN_ID);
    } catch (e: any) { setError(String(e?.message ?? e)); }
  }

  useEffect(() => {
    if (!busy) { setQuiet(false); return; }
    const t = setTimeout(() => setQuiet(true), WALLET_QUIET_MS);
    return () => clearTimeout(t);
  }, [busy]);

  async function step(label: string, fn: () => Promise<string>) {
    if (!poolOk) {
      setError("The pool isn't reachable right now, so nothing was sent to your wallet.");
      return;
    }
    setBusy(label); setError(null); setDone(null);
    try {
      const hash = await fn();
      setDone(hash);
      if (account) await reload(account, asset.address);
    } catch (e: any) {
      setError(String(e?.shortMessage ?? e?.details ?? e?.message ?? e));
    } finally { setBusy(null); }
  }

  const amountOk = Boolean(ready && parsed !== null && parsed > 0n);
  const short = Boolean(ready && parsed !== null && ready.balance < parsed);

  const needsWrap = isWeth && short;
  const tooMuch = !isWeth && short;

  const wrapAmount = ready && parsed !== null ? parsed - ready.balance : 0n;
  const maxWrap = ready && ready.eth > GAS_RESERVE ? ready.eth - GAS_RESERVE : 0n;
  const wrapTooBig = Boolean(needsWrap && ready && wrapAmount > maxWrap);
  const needsApprove = Boolean(ready && parsed !== null && ready.allowance < parsed);
  const priced = isWeth || asset.kind !== "stock" || multiplier !== null;
  const canShield = Boolean(pool.address && ready && priced && parsed && parsed > 0n && !short && !needsApprove);
  const fee = parsed !== null && parsed > 0n ? poolFee(parsed) : null;
  const depositLabel =
    health.status === "unconfigured" ? "Pool not live yet"
    : health.status === "unreachable" ? "Pool unreachable"
    : health.status === "checking" ? "Checking the pool…"
    : busy === "shield" ? "Depositing…" : "Deposit";

  if (!pool.address) {
    return (
      <>
        <header className="page-head"><h1>Deposit</h1></header>
        <div className="page-body" style={{ maxWidth: 620 }}>
          <section className="card" style={{ padding: "24px 26px" }}>
            <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--text-mid)", margin: "0 0 16px" }}>
              You need a pool wallet before you can deposit.
            </p>
            <Link href="/pool/setup" className="btn">Create or recover a wallet</Link>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="page-head">
        <h1>Deposit</h1>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-low)" }}>
          THIS TRANSACTION IS PUBLIC
        </span>
      </header>

      <div className="page-body" style={{ maxWidth: 860, display: "flex", flexDirection: "column", gap: 20 }}>
        <div className="card" style={{ padding: "18px 22px", borderColor: "var(--amber-border)", background: "var(--amber-dim)", display: "flex", gap: 12 }}>
          <AlertTriangle color="var(--amber)" />
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--text-mid)" }}>
            <strong style={{ color: "var(--text-hi)", fontWeight: 600 }}>A deposit is public.</strong> It shows your
            address, the exact amount and a key that links every deposit from this wallet. Privacy starts when you
            send.
          </div>
        </div>

        {ASSETS.length > 1 && (
          <section className="card" style={{ padding: "20px 26px", display: "flex", flexDirection: "column", gap: 10 }}>
            <AssetPicker assets={ASSETS} value={asset} onChange={pick} />
            {asset.kind === "stock" && (
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-low)" }}>
                Robinhood can freeze or burn stock tokens, including in the pool.
              </div>
            )}
          </section>
        )}

        {!account ? (
          <section className="card" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 16, fontWeight: 650, margin: 0 }}>
              Connect the wallet that holds your funds
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-mid)", margin: 0 }}>
              Your normal Ethereum wallet, not your pool wallet. It pays for the deposit and shows on chain.
            </p>
            {wallets.length > 1 ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {wallets.map((w) => (
                  <button key={w.id} className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 8 }} onClick={() => doConnect(w.id)}>
                    {w.icon && <img src={w.icon} alt="" width={18} height={18} style={{ borderRadius: 4 }} />}
                    {w.name}
                  </button>
                ))}
              </div>
            ) : (
              <button className="btn" style={{ alignSelf: "flex-start" }} disabled={!wallets.length && !hasWallet()} onClick={() => doConnect(wallets[0]?.id)}>
                {wallets.length || hasWallet() ? "Connect wallet" : "No wallet extension detected"}
              </button>
            )}
            {!IS_MAINNET && (
              <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-low)" }}>
                Need ETH? Get some from{" "}
                {FAUCETS.map((f, i) => (
                  <span key={f.url}>
                    {i > 0 && ", "}
                    <a href={f.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{f.name}</a>
                  </span>
                ))}.
              </div>
            )}
          </section>
        ) : (
          <>
            {chainOk === false && (
              <div className="card" style={{ padding: "18px 22px", borderColor: "var(--amber-border)", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <div style={{ fontSize: 14, color: "var(--text-mid)" }}>
                  Your wallet is on the wrong network.
                </div>
                <button
                  className="btn"
                  style={{ minHeight: 36, fontSize: 13 }}
                  onClick={async () => {

                    setError(null);
                    try { await ensureChain(); } catch (e: any) { setError(String(e?.message ?? e)); }
                    try { setChainOk((await currentChainId()) === POOL_CHAIN_ID); } catch {  }
                  }}
                >
                  Switch network
                </button>
              </div>
            )}

            <section className="card" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <h2 style={{ fontSize: 16, fontWeight: 650, margin: 0 }}>Amount</h2>
                <span className="chip mono" style={{ fontSize: 10.5 }}>{shortAddr(account, 8, 6)}</span>
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  className="mono"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  style={{
                    background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6,
                    padding: "12px 14px", color: "var(--text-hi)", fontSize: 18, width: 200,
                  }}
                />
                <span style={{ fontSize: 15, color: "var(--text-mid)" }}>{asset.symbol}</span>
                {isWeth && QUICK_PICKS.map((v) => (
                  <button key={v} className="btn btn-ghost" style={{ minHeight: 32, padding: "0 12px", fontSize: 12.5 }} onClick={() => setAmount(String(v))}>
                    {v}
                  </button>
                ))}
              </div>
              {parsed === null && <div style={{ fontSize: 13, color: "var(--amber)" }}>That is not a number.</div>}
              {fee !== null && parsed !== null && priced && (
                <div className="mono" style={{ fontSize: 12, lineHeight: 2, color: "var(--text-low)" }}>
                  <div>PROTOCOL FEE {FEE_PCT} &nbsp; {formatAmount(fee, asset, multiplier)} {asset.symbol}</div>
                  <div style={{ color: "var(--text-mid)" }}>YOUR NOTE WILL HOLD &nbsp; {formatAmount(parsed - fee, asset, multiplier)} {asset.symbol}</div>
                </div>
              )}
              {tooMuch && ready && (
                <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--amber)" }}>
                  This wallet holds{" "}
                  <button
                    className="mono"
                    style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}
                    onClick={() => setAmount(amountText(ready.balance, asset, multiplier))}
                  >
                    {formatAmount(ready.balance, asset, multiplier)}
                  </button>{" "}
                  {asset.symbol}.
                </div>
              )}
              {wrapTooBig && ready && (
                <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--amber)" }}>
                  Leave some ETH for gas. The most you can deposit from this wallet is{" "}
                  <button
                    className="mono"
                    style={{ background: "none", border: 0, padding: 0, color: "var(--accent)", cursor: "pointer", font: "inherit", textDecoration: "underline" }}
                    onClick={() => setAmount(amountText(maxWrap + ready.balance, WETH, null))}
                  >
                    {amountText(maxWrap + ready.balance, WETH, null)}
                  </button>.
                </div>
              )}

              {ready && (
                <div className="mono" style={{ fontSize: 12, lineHeight: 2, color: "var(--text-low)", borderTop: "1px solid var(--border-faint)", paddingTop: 12 }}>
                  <div>ETH FOR GAS &nbsp; {weth(ready.eth)}</div>
                  <div>{asset.symbol} BALANCE &nbsp; {formatAmount(ready.balance, asset, multiplier)}</div>
                  <div>POOL ALLOWANCE &nbsp; {formatAmount(ready.allowance, asset, multiplier)}</div>
                </div>
              )}
            </section>

            <section className="card" style={{ padding: "24px 26px", display: "flex", flexDirection: "column", gap: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 650, margin: 0 }}>{isWeth ? "Three steps" : "Two steps"}</h2>
              {health.status === "unreachable" && (
                <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--amber)" }}>
                  The pool isn&apos;t reachable right now. These steps are off and nothing will be sent to your
                  wallet.
                </div>
              )}

              {isWeth && (
                <Step
                  n={1}
                  title="Wrap ETH into WETH"
                  body="The pool holds WETH: ETH as a token, one for one."
                  done={amountOk && !needsWrap}
                  action={
                    <button className="btn" disabled={!poolOk || !parsed || busy !== null || !needsWrap || wrapTooBig}
                      onClick={() => step("wrap", () => wrap(account, parsed! - (ready?.balance ?? 0n)))}>
                      {busy === "wrap" ? "Wrapping…" : "Wrap"}
                    </button>
                  }
                />
              )}

              <Step
                n={isWeth ? 2 : 1}
                title="Approve the pool"
                body="Lets the pool take exactly this amount. Nothing moves yet."
                done={amountOk && !short && !needsApprove}
                action={
                  <button className="btn" disabled={!poolOk || !priced || !parsed || busy !== null || short || !needsApprove}
                    onClick={() => step("approve", () => approve(account, asset.address, parsed!))}>
                    {busy === "approve" ? "Approving…" : "Approve"}
                  </button>
                }
              />

              <Step
                n={isWeth ? 3 : 2}
                title="Deposit into the pool"
                body={`Your ${asset.symbol}, less the ${FEE_PCT} protocol fee, becomes a note only your phrase can spend.`}
                done={false}
                action={
                  <button className="btn" disabled={!poolOk || !canShield || busy !== null}
                    onClick={() => step("shield", async () => {
                      const w = await walletFor(asset.address);
                      const built = await w.buildShield(asset.address, parsed!);
                      const hash = await submitSelf(account, built);
                      await refresh();
                      return hash;
                    })}>
                    {depositLabel}
                  </button>
                }
              />
            </section>

            {busy && quiet && (
              <div className="card" style={{ padding: "16px 20px", borderColor: "var(--amber-border)", display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-mid)" }}>
                  Waiting for your wallet. No window? Check the wallet icon in your toolbar. If you closed it, start
                  again.
                </div>
                <button className="btn btn-ghost" style={{ minHeight: 34, fontSize: 13 }} onClick={() => setBusy(null)}>
                  Start again
                </button>
              </div>
            )}

            {error && (
              <div className="card" style={{ padding: "16px 20px", borderColor: "var(--amber-border)", display: "flex", gap: 12 }}>
                <AlertTriangle color="var(--amber)" />
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text-mid)" }}>{error}</div>
              </div>
            )}
            {done && (
              <div className="card" style={{ padding: "16px 20px", borderColor: "var(--accent-border)", display: "flex", gap: 12, alignItems: "center" }}>
                <CheckCircle color="var(--accent)" />
                <div style={{ fontSize: 13.5, color: "var(--text-mid)" }}>
                  Confirmed.{" "}
                  <a href={txUrl(done)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>View on explorer</a>
                  {" · "}
                  <Link href="/pool" style={{ color: "var(--accent)" }}>Back to your pool</Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Step({ n, title, body, done, action }: {
  n: number; title: string; body: string; done: boolean; action: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", gap: 16, alignItems: "flex-start", padding: "14px 0",
      borderTop: n === 1 ? "none" : "1px solid var(--border-faint)",
    }}>
      <span className="mono" style={{ fontSize: 11, color: done ? "var(--accent)" : "var(--text-low)", minWidth: 20, paddingTop: 3 }}>
        {done ? "OK" : n}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-mid)" }}>{body}</div>
      </div>
      <div>{action}</div>
    </div>
  );
}
