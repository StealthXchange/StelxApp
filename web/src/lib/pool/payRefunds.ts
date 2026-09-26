"use client";

import { parseAbi, type Address } from "viem";
import { poolClient, storage } from "./walletStore.ts";
import { nextRefundIndex, PAY_FROM, refundAddress } from "./payRoutes.ts";

export interface RefundRecord {
  index: number;

  requestId: string;
  chainId: number;
  at: number;
}

const recordKey = (poolAddr: string) => `stelx.pool.v1.payrefunds.${poolAddr.slice(6, 26)}`;

export function loadRefunds(poolAddr: string): RefundRecord[] {
  try {
    const raw = storage()?.getItem(recordKey(poolAddr));
    const list = raw ? (JSON.parse(raw) as RefundRecord[]) : [];
    return Array.isArray(list) ? list.filter((r) => Number.isInteger(r?.index)) : [];
  } catch {
    return [];
  }
}

export function saveRefund(poolAddr: string, r: RefundRecord): void {
  const list = [...loadRefunds(poolAddr).filter((x) => x.index !== r.index), r].sort((a, b) => a.index - b.index);
  try { storage()?.setItem(recordKey(poolAddr), JSON.stringify(list)); } catch {  }
}

const USDG_ABI = parseAbi(["function balanceOf(address a) view returns (uint256)"]);

async function used(address: Address): Promise<boolean> {
  const c = poolClient();
  const [nonce, eth, usdg] = await Promise.all([
    c.getTransactionCount({ address }),
    c.getBalance({ address }),
    c.readContract({ address: PAY_FROM.token, abi: USDG_ABI, functionName: "balanceOf", args: [address] }),
  ]);
  if (nonce > 0 || eth > 0n || usdg > 0n) return true;
  const r = await fetch(`/api/pay/used?user=${address}`, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));

  if (!r.ok || typeof j.used !== "boolean") throw new Error("Couldn't check a fresh refund address with Relay. Try again in a moment.");
  return j.used;
}

export async function allocateRefund(phrase: string, poolAddr: string): Promise<{ index: number; address: Address }> {
  const recorded = new Set(loadRefunds(poolAddr).map((r) => r.index));
  const index = await nextRefundIndex(recorded, (i) => used(refundAddress(phrase, i)));
  return { index, address: refundAddress(phrase, index) };
}
