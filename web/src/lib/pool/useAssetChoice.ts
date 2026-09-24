"use client";

import { useState } from "react";
import { WETH } from "./assets.ts";
import type { Holding } from "./walletStore.ts";

const EMPTY_WETH: Holding = { asset: WETH, balance: 0n, multiplier: null, history: [] };

export function useAssetChoice(holdings: Holding[]) {

  const [picked, setPicked] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("asset")?.toUpperCase() ?? null,
  );
  const withBalance = holdings.filter((h) => h.balance > 0n);
  const options = withBalance.length ? withBalance : [holdings[0] ?? EMPTY_WETH];
  const current =
    options.find((h) => h.asset.symbol === picked || h.asset.address === picked) ?? options[0];
  return { options, current, choose: (address: string) => setPicked(address) };
}
