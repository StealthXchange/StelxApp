"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { poolAddress, poolDeployBlock, POOL_CHAIN_ID, POOL_CONFIGURED, POOL_RPC, POOL_TOKEN } from "./config.ts";
import { poolClient } from "./client.ts";

export type PoolHealth =
  | { status: "checking" }
  | { status: "ok" }

  | { status: "unconfigured" }
  | { status: "unreachable"; reason: string };

const CHECKING: PoolHealth = { status: "checking" };

let health: PoolHealth = POOL_CONFIGURED ? CHECKING : { status: "unconfigured" };
let running: Promise<PoolHealth> | null = null;
const listeners = new Set<() => void>();

function publish(h: PoolHealth) {
  health = h;
  for (const l of listeners) l();
}

function rpcHost(): string {
  try { return new URL(POOL_RPC).host; } catch { return POOL_RPC; }
}

async function ask(): Promise<PoolHealth> {
  if (!POOL_CONFIGURED) return { status: "unconfigured" };

  let pool: Address, deployBlock: bigint;
  try {
    pool = poolAddress();
    deployBlock = poolDeployBlock();
  } catch (e: any) {
    return { status: "unreachable", reason: String(e?.message ?? e) };
  }

  const client = poolClient();
  let chainId: number, poolCode: string | undefined, tokenCode: string | undefined, head: bigint;
  try {
    [chainId, poolCode, tokenCode, head] = await Promise.all([
      client.getChainId(),
      client.getCode({ address: pool }),
      client.getCode({ address: POOL_TOKEN }),
      client.getBlockNumber({ cacheTime: 0 }),
    ]);
  } catch (e: any) {
    return { status: "unreachable", reason: `No answer from ${rpcHost()}: ${String(e?.shortMessage ?? e?.message ?? e)}` };
  }

  const empty = (code?: string) => !code || code === "0x";
  if (chainId !== POOL_CHAIN_ID) {
    return { status: "unreachable", reason: `${rpcHost()} is chain ${chainId}, not chain ${POOL_CHAIN_ID}.` };
  }
  if (empty(poolCode)) return { status: "unreachable", reason: `No contract at the pool address ${pool}.` };
  if (empty(tokenCode)) return { status: "unreachable", reason: `No contract at the token address ${POOL_TOKEN}.` };
  if (deployBlock > head) {
    return { status: "unreachable", reason: `The pool's deploy block ${deployBlock} is ahead of the chain, which is at ${head}.` };
  }
  return { status: "ok" };
}

export function checkPool(): Promise<PoolHealth> {
  if (!running) {
    running = ask()
      .catch((e: any): PoolHealth => ({ status: "unreachable", reason: String(e?.message ?? e) }))
      .then((h) => { publish(h); return h; });
  }
  return running;
}

export function recheckPool(): Promise<PoolHealth> {
  running = null;
  if (POOL_CONFIGURED) publish(CHECKING);
  return checkPool();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const SERVER: PoolHealth = POOL_CONFIGURED ? CHECKING : { status: "unconfigured" };

export function usePoolHealth(): PoolHealth {
  const h = useSyncExternalStore(subscribe, () => health, () => SERVER);
  useEffect(() => { void checkPool(); }, []);
  return h;
}
