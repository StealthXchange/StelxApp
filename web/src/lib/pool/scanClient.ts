"use client";

import type { PublicClient } from "viem";

const LOGS_MS = 60_000;
const BLOCK_MS = 2_000;

export function sharedScanClient(base: PublicClient): PublicClient {
  const cache = new Map<string, { at: number; value: Promise<unknown> }>();

  function memo<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.at > LOGS_MS) cache.delete(k);
    const hit = cache.get(key);
    if (hit && now - hit.at < ttl) return hit.value as Promise<T>;
    const value = load();
    cache.set(key, { at: now, value });

    value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
    return value;
  }

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "getBlockNumber") {
        return () => memo("head", BLOCK_MS, () => target.getBlockNumber({ cacheTime: 0 }));
      }
      if (prop === "getBlock") {
        return (args: any) => args?.blockNumber === undefined
          ? target.getBlock(args)
          : memo(`block:${args.blockNumber}`, BLOCK_MS, () => target.getBlock(args));
      }
      if (prop === "getLogs") {
        return (args: any) => memo(`logs:${args.address}:${args.fromBlock}:${args.toBlock}`, LOGS_MS, () => target.getLogs(args));
      }
      if (prop === "readContract") {
        return (args: any) => args?.blockNumber === undefined
          ? target.readContract(args)
          : memo(`read:${args.address}:${args.functionName}:${args.blockNumber}`, BLOCK_MS, () => target.readContract(args));
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
