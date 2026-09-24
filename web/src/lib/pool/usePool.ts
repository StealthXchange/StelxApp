"use client";

import { useEffect, useSyncExternalStore } from "react";
import { formatEther } from "viem";
import { getServerSnapshot, getSnapshot, restore, subscribe, type PoolState } from "./walletStore.ts";

export function usePool(): PoolState {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (state.phase === "empty" && state.address === null) void restore();

  }, [state.phase, state.address]);
  return state;
}

export function weth(v: bigint, dp = 6): string {
  const s = formatEther(v);
  if (!s.includes(".")) return s;
  const [i, f] = s.split(".");
  const cut = f.slice(0, dp).replace(/0+$/, "");
  return cut ? `${i}.${cut}` : i;
}

export function shortAddr(a: string, head = 10, tail = 6): string {
  return a.length <= head + tail + 2 ? a : `${a.slice(0, head)}····${a.slice(-tail)}`;
}
