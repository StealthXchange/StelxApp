"use client";

import { decodeFunctionData, type Hex } from "viem";
import { POOL_ABI, type BuiltTx } from "./vendor/wallet.ts";
import { submitViaBroadcaster, waitForBroadcast, type BroadcasterInfo } from "./vendor/broadcast.ts";
import { poolAddress } from "./config.ts";
import { poolClient } from "./walletStore.ts";

export type Outcome = "success" | "reverted" | "refused" | "checking" | "unknown";

const REFUSED_BEFORE_SENDING =
  /simulation reverted|nothing was sent|fee note|fee below|proof is bound|only transact|expected \{|rate limited|too large/i;

export function refusedBeforeSending(message: string): boolean {
  return REFUSED_BEFORE_SENDING.test(message);
}

export async function spentOnChain(data: Hex): Promise<boolean> {
  const { args } = decodeFunctionData({ abi: POOL_ABI, data });
  const nullifiers = ((args as any)[1].nullifiers ?? []) as readonly bigint[];
  const client = poolClient();
  const spent = await Promise.all(
    nullifiers.map((n) => client.readContract({ address: poolAddress(), abi: POOL_ABI, functionName: "isNullifierSpent", args: [n] })),
  );
  return spent.some(Boolean);
}

export async function submitAndSettle(
  info: BroadcasterInfo,
  tx: { to: string; data: string },
  on: { hash?: (h: Hex) => void; checking?: () => void } = {},
): Promise<{ outcome: Outcome; error: string | null }> {
  try {
    const h = await submitViaBroadcaster(info, tx as BuiltTx);
    on.hash?.(h);
    return { outcome: await waitForBroadcast(info, h), error: null };
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (refusedBeforeSending(msg)) return { outcome: "refused", error: msg };
    on.checking?.();
    return { outcome: (await waitForSpent(tx.data as Hex)) ? "success" : "unknown", error: msg };
  }
}

export async function waitForSpent(data: Hex, ms = 90_000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await spentOnChain(data)) return true; } catch {  }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}
