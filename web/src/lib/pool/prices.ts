"use client";

import { useEffect, useSyncExternalStore } from "react";
import { formatUnits } from "viem";
import type { Asset } from "./assets.ts";
import { IS_MAINNET } from "./config.ts";

export interface Prices { at: number; eth: number | null; tokens: Record<string, number> }

const EVERY_MS = 60_000;
let prices: Prices | null = null;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load(): Promise<void> {
  return (inflight ??= fetch("/api/prices")
    .then((r) => (r.ok ? r.json() : null))
    .then((p: Prices | null) => {
      if (p && typeof p.tokens === "object") prices = p;
      fetchedAt = Date.now();
      listeners.forEach((l) => l());
    })
    .catch(() => {})
    .finally(() => { inflight = null; }));
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function usePrices(): Prices | null {
  const p = useSyncExternalStore(subscribe, () => prices, () => null);
  useEffect(() => {
    if (Date.now() - fetchedAt > EVERY_MS) void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, EVERY_MS);
    return () => clearInterval(t);
  }, []);
  return p;
}

export function priceOf(asset: Asset, p: Prices | null): number | null {
  if (!p) return null;
  if (asset.kind === "eth") return p.eth;

  if (asset.kind === "cash") return 1;
  return p.tokens[asset.address.toLowerCase()] ?? null;
}

export function usdValue(raw: bigint, asset: Asset, p: Prices | null): number | null {
  const price = priceOf(asset, p);
  return price === null ? null : Number(formatUnits(raw, asset.decimals)) * price;
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatUsd(v: number): string {
  return v > 0 && v < 0.01 ? "< $0.01" : USD.format(v);
}

export const PRICE_NOTE = IS_MAINNET ? null : "TESTNET, NO REAL VALUE";
