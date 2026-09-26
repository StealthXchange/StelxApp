"use client";

import { createPublicClient, http, type Chain, type PublicClient } from "viem";
import { arbitrum, mainnet } from "viem/chains";
import { storage } from "./walletStore.ts";
import { findLandingIndices, nextLandingIndex } from "./landingKeys.ts";
import { DARK_ROUTES, darkRoute, type DarkRoute, type DarkRouteId } from "./darkRoutes.ts";
import { landingAddressOf, readLandingState, usedLanding, type DestChain, type LandingState } from "./darkLanding.ts";

const CHAINS: Record<number, Chain> = { 1: mainnet, 42161: arbitrum };
const dests = new Map<string, DestChain>();

export function destChain(route: DarkRoute): DestChain {
  const have = dests.get(route.id);
  if (have) return have;
  const chain = CHAINS[route.chainId];
  const transport = http(`/api/dark/rpc?chain=${route.chainId}`, { retryCount: 3, retryDelay: 500 });
  const d: DestChain = { route, chain, transport, client: createPublicClient({ chain, transport, pollingInterval: 3000 }) as PublicClient };
  dests.set(route.id, d);
  return d;
}

export interface DarkRecord {

  index: number;

  route?: DarkRouteId;

  target?: string;
  asked?: string;

  amountIn?: string;
  withdraw?: string;
  requestId?: string;
  depositAddress?: string;

  refundIndex?: number;

  at: number;

  paidAt?: number;
  withdrawTx?: string;

  shieldTx?: string;
  noteValue?: string;
}

const recordKey = (poolAddr: string) => `stelx.pool.v1.dark.${poolAddr.slice(6, 26)}`;

export function loadDark(poolAddr: string): DarkRecord[] {
  try {
    const raw = storage()?.getItem(recordKey(poolAddr));
    const list = raw ? (JSON.parse(raw) as DarkRecord[]) : [];
    return Array.isArray(list) ? list.filter((r) => Number.isInteger(r?.index)) : [];
  } catch {
    return [];
  }
}

export function saveDark(poolAddr: string, r: DarkRecord): void {
  const list = [...loadDark(poolAddr).filter((x) => x.index !== r.index), r].sort((a, b) => a.index - b.index);
  try { storage()?.setItem(recordKey(poolAddr), JSON.stringify(list)); } catch {  }
}

export async function readBoth(phrase: string, index: number): Promise<Record<DarkRouteId, LandingState>> {
  const address = landingAddressOf(phrase, index);
  const [eth, arb] = await Promise.all(DARK_ROUTES.map((r) => readLandingState(destChain(r), address)));
  return { eth, "arb-usdc": arb };
}

const usedAnywhere = (s: Record<DarkRouteId, LandingState>) => usedLanding(s.eth) || usedLanding(s["arb-usdc"]);

export async function allocateDark(phrase: string, poolAddr: string): Promise<{ index: number; address: `0x${string}` }> {
  const recorded = new Set(loadDark(poolAddr).map((r) => r.index));
  const index = await nextLandingIndex(recorded, async (i) => usedAnywhere(await readBoth(phrase, i)));
  return { index, address: landingAddressOf(phrase, index) };
}

export async function findDarkTransfers(phrase: string, poolAddr: string, progress?: (index: number) => void): Promise<DarkRecord[]> {
  const known = new Map(loadDark(poolAddr).map((r) => [r.index, r]));
  await findLandingIndices(async (i) => {
    progress?.(i);
    const s = await readBoth(phrase, i);
    const used = usedAnywhere(s);
    if (used && !known.has(i)) {
      const route: DarkRouteId = usedLanding(s["arb-usdc"]) && !usedLanding(s.eth) ? "arb-usdc" : "eth";
      const r: DarkRecord = { index: i, route, at: 0 };
      saveDark(poolAddr, r);
      known.set(i, r);
    }
    return used || known.has(i);
  });
  return loadDark(poolAddr);
}

export const routeOf = (r: DarkRecord) => (r.route ? darkRoute(r.route) : undefined);
