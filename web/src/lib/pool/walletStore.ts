"use client";

import type { Address, PublicClient } from "viem";
import { Wallet, type WalletConfig, type OwnedNote, type HistoryEntry } from "./vendor/wallet.ts";
import { keysFromMnemonic, newMnemonic, type WalletKeys } from "./vendor/keys.ts";
import { poolAddress, poolDeployBlock, POOL_CHAIN_ID, ARTIFACTS, SCAN_CHUNK } from "./config.ts";
import { poolClient as sharedClient } from "./client.ts";
import { sharedScanClient } from "./scanClient.ts";
import { Discovery } from "./discover.ts";
import { assetOf, readMultiplier, WETH, type Asset } from "./assets.ts";

const SEED_KEY = "stelx.pool.v1.seed";
const PERSIST_KEY = "stelx.pool.v1.persist";

export type Phase = "empty" | "locked" | "scanning" | "ready" | "error";

export interface Holding {
  asset: Asset;
  balance: bigint;
  multiplier: bigint | null;
  history: HistoryEntry[];
}

export interface PoolState {
  phase: Phase;
  address: string | null;

  holdings: Holding[];

  balance: bigint;
  notes: OwnedNote[];
  history: HistoryEntry[];
  leaves: number;
  scannedAt: number | null;
  error: string | null;

  pendingSeed: string | null;
}

const EMPTY: PoolState = {
  phase: "empty", address: null, holdings: [], balance: 0n, notes: [], history: [],
  leaves: 0, scannedAt: null, error: null, pendingSeed: null,
};

let state: PoolState = EMPTY;

let wallets = new Map<string, Wallet>();
let seed: string | null = null;
let discovery: Discovery | null = null;
let scanClient: PublicClient | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<PoolState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getSnapshot(): PoolState {
  return state;
}

export function getServerSnapshot(): PoolState {
  return EMPTY;
}

function reads(): PublicClient {
  return (scanClient ??= sharedScanClient(sharedClient()));
}

function walletConfig(token: Address): WalletConfig {
  return {
    client: reads() as any,
    pool: poolAddress(),
    token,
    chainId: BigInt(POOL_CHAIN_ID),
    deployBlock: poolDeployBlock(),
    logChunk: SCAN_CHUNK,

    broadcaster: "0x0000000000000000000000000000000000000000",
    broadcasterAddress: "",
    fee: 0n,
    artifacts: { wasm: ARTIFACTS.wasm, zkey: ARTIFACTS.zkey, verificationKey: {} },
  };
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PERSIST_KEY) === "1" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function isPersistent(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(PERSIST_KEY) === "1";
  } catch {
    return false;
  }
}

export function setPersistent(on: boolean): void {
  try {
    const seed = storedSeed();
    if (on) window.localStorage.setItem(PERSIST_KEY, "1");
    else window.localStorage.removeItem(PERSIST_KEY);
    if (seed) {
      window.sessionStorage.removeItem(SEED_KEY);
      window.localStorage.removeItem(SEED_KEY);
      storage()?.setItem(SEED_KEY, seed);
    }
  } catch {  }
}

function storedSeed(): string | null {
  try {
    return window.sessionStorage.getItem(SEED_KEY) ?? window.localStorage.getItem(SEED_KEY);
  } catch {
    return null;
  }
}

export function createSeed(): string {
  const m = newMnemonic(128);
  set({ pendingSeed: m });
  return m;
}

export function discardPendingSeed(): void {
  set({ pendingSeed: null });
}

export async function adopt(mnemonic: string): Promise<void> {
  const trimmed = mnemonic.trim().replace(/\s+/g, " ");
  const keys = await keysFromMnemonic(trimmed);
  try { storage()?.setItem(SEED_KEY, trimmed); } catch {  }
  await load(trimmed, keys);
  set({ phase: "scanning", address: keys.address, pendingSeed: null, error: null });
  await refresh();
}

async function load(mnemonic: string, k: WalletKeys): Promise<void> {
  seed = mnemonic; wallets = new Map();
  discovery = new Discovery(reads(), k, poolAddress(), poolDeployBlock(), SCAN_CHUNK);
  await walletFor(WETH.address);
}

export async function walletFor(token: Address): Promise<Wallet> {
  const key = token.toLowerCase();
  const have = wallets.get(key);
  if (have) return have;
  if (!seed) throw new Error("Pool wallet not loaded.");
  const w = await Wallet.create(seed, walletConfig(token));
  wallets.set(key, w);
  return w;
}

export async function restore(): Promise<boolean> {
  const seed = storedSeed();
  if (!seed) { set({ ...EMPTY }); return false; }
  try {
    const k = await keysFromMnemonic(seed);
    await load(seed, k);
    set({ phase: "scanning", address: k.address, error: null });
    await refresh();
    return true;
  } catch (e: any) {
    set({ phase: "error", error: String(e?.message ?? e) });
    return false;
  }
}

let refreshing: Promise<void> | null = null;

export function refresh(): Promise<void> {
  return (refreshing ??= scanAll().finally(() => { refreshing = null; }));
}

async function scanAll(): Promise<void> {
  if (!discovery || !wallets.size) return;
  set({ phase: "scanning", error: null });
  try {
    for (const token of await discovery.run()) await walletFor(token);
    const holdings: Holding[] = [];
    let leaves = 0;
    let weth: Wallet | null = null;
    for (const [key, w] of [...wallets]) {
      const asset = assetOf(key);
      if (!asset) continue;
      const r = await w.scan();
      const balance = await w.getBalance(asset.address);
      const history = w.getHistory();
      if (asset === WETH) { leaves = r.leaves; weth = w; }
      if (asset === WETH || balance > 0n || history.length > 0) {
        holdings.push({ asset, balance, multiplier: await readMultiplier(asset), history });
      }
    }
    holdings.sort((a, b) => (a.asset === WETH ? -1 : b.asset === WETH ? 1 : a.asset.symbol.localeCompare(b.asset.symbol)));
    const main = holdings.find((h) => h.asset === WETH);
    set({
      phase: "ready",
      holdings,
      balance: main?.balance ?? 0n,
      notes: weth ? await weth.getNotes() : [],
      history: main?.history ?? [],
      leaves,
      scannedAt: Date.now(),
    });
  } catch (e: any) {
    set({ phase: "error", error: String(e?.shortMessage ?? e?.message ?? e) });
  }
}

export function forget(): void {
  try {
    window.sessionStorage.removeItem(SEED_KEY);
    window.localStorage.removeItem(SEED_KEY);
  } catch {  }
  wallets = new Map(); seed = null; discovery = null;
  set({ ...EMPTY });
}

export function revealSeed(): string | null {
  return storedSeed();
}

export function currentWallet(): Wallet | null {
  return wallets.get(WETH.address.toLowerCase()) ?? null;
}

export function poolClient(): PublicClient {
  return sharedClient();
}
