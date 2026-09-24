"use client";

import { formatEther } from "viem";
import { fetchBroadcasterInfo, type BroadcasterInfo } from "./vendor/broadcast.ts";
import { poolAddress, POOL_CHAIN_ID } from "./config.ts";

export const MAX_RELAY_FEE = 10n ** 15n;

export function relayProblem(info: BroadcasterInfo): string | null {
  if (info.chainId !== POOL_CHAIN_ID) {
    return `it is on chain ${info.chainId}, and this pool is on chain ${POOL_CHAIN_ID}`;
  }
  if (String(info.pool).toLowerCase() !== poolAddress().toLowerCase()) {
    return `it serves a different pool (${info.pool})`;
  }
  if (info.fee < 0n || info.fee > MAX_RELAY_FEE) {
    return `it asks a fee of ${formatEther(info.fee)} WETH, and this site allows at most ${formatEther(MAX_RELAY_FEE)}`;
  }
  return null;
}

const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export async function pickRelay(urls: string[]): Promise<BroadcasterInfo> {
  const why: string[] = [];
  for (const u of urls) {
    let info: BroadcasterInfo;
    try {
      info = await fetchBroadcasterInfo(u);
    } catch (e: any) {
      why.push(`${host(u)} did not answer (${String(e?.message ?? e)})`);
      continue;
    }
    const problem = relayProblem(info);
    if (!problem) return info;
    why.push(`${host(u)} can't be used: ${problem}`);
  }
  throw new Error(`No broadcaster can be used. ${why.join(". ")}.`);
}
