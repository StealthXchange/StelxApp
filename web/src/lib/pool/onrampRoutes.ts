import { decodeFunctionData, isAddress, parseAbi } from "viem";
import { PAY_CHAINS, type PayChain } from "./payRoutes.ts";

export const ONRAMP_TO = {
  chainId: 4663,
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  eth: "0x0000000000000000000000000000000000000000",
} as const;

export const NATIVE = "0x0000000000000000000000000000000000000000";

export interface NativeRoute { symbol: string; arrivesAs: "eth" | "usdg" }

export interface OnrampChain extends PayChain {

  usdcDecimals: number;
  native: NativeRoute | null;
}

const ETH: NativeRoute = { symbol: "ETH", arrivesAs: "eth" };
const EXTRA: Record<number, Pick<OnrampChain, "usdcDecimals" | "native">> = {
  8453: { usdcDecimals: 6, native: ETH },
  42161: { usdcDecimals: 6, native: ETH },
  10: { usdcDecimals: 6, native: ETH },
  1: { usdcDecimals: 6, native: ETH },
  137: { usdcDecimals: 6, native: null },
  56: { usdcDecimals: 18, native: { symbol: "BNB", arrivesAs: "usdg" } },
  43114: { usdcDecimals: 6, native: null },
  59144: { usdcDecimals: 6, native: ETH },
  130: { usdcDecimals: 6, native: ETH },
  480: { usdcDecimals: 6, native: ETH },
  146: { usdcDecimals: 6, native: null },
  999: { usdcDecimals: 6, native: { symbol: "HYPE", arrivesAs: "usdg" } },
  5000: { usdcDecimals: 6, native: null },
  100: { usdcDecimals: 6, native: null },
  42220: { usdcDecimals: 6, native: null },
  57073: { usdcDecimals: 6, native: ETH },
  80094: { usdcDecimals: 6, native: null },
  143: { usdcDecimals: 6, native: { symbol: "MON", arrivesAs: "usdg" } },

  5042: { usdcDecimals: 6, native: null },
};

export const ONRAMP_HELD = new Set([5042]);

export const ONRAMP_KNOWN: OnrampChain[] = PAY_CHAINS.filter((c) => EXTRA[c.id]).map((c) => ({ ...c, ...EXTRA[c.id] }));
export const ONRAMP_CHAINS: OnrampChain[] = ONRAMP_KNOWN.filter((c) => !ONRAMP_HELD.has(c.id));

export const onrampChain = (id: number) => ONRAMP_CHAINS.find((c) => c.id === id);

export type OnrampAsset = "usdc" | "native";

export const assetSymbol = (c: OnrampChain, a: OnrampAsset) => (a === "usdc" ? "USDC" : c.native?.symbol ?? "");
export const assetDecimals = (c: OnrampChain, a: OnrampAsset) => (a === "usdc" ? c.usdcDecimals : 18);
export const originCurrency = (c: OnrampChain, a: OnrampAsset) => (a === "usdc" ? c.usdc : NATIVE);

export const arrivesAs = (c: OnrampChain, a: OnrampAsset): "usdg" | "eth" => (a === "usdc" ? "usdg" : c.native?.arrivesAs ?? "usdg");

export const ONRAMP_MIN_USD = 5;
export const ONRAMP_MAX_USD = 10_000;

export const ONRAMP_MIN_SLACK = 0.99;

export const GAS_TOPUP_USD = "600000";

const TRANSFER = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

export interface RelayQuote {
  requestId?: string;
  steps?: { depositAddress?: string; items?: { data?: { to?: string; data?: string; value?: string; chainId?: number } }[] }[];
  details?: {
    recipient?: string;
    currencyIn?: { amountUsd?: string };
    currencyOut?: { amount?: string; currency?: { chainId?: number; address?: string } };
    currencyGasTopup?: { amount?: string; currency?: { chainId?: number; address?: string } };
  };
}

export function quoteProblem(j: RelayQuote, chain: OnrampChain, asset: OnrampAsset, amount: bigint, recipient: string): string | null {
  try { return check(j, chain, asset, amount, recipient); } catch { return "malformed quote"; }
}

function check(j: RelayQuote, chain: OnrampChain, asset: OnrampAsset, amount: bigint, recipient: string): string | null {
  if (asset === "native" && !chain.native) return "no native route on this chain";
  const steps = j.steps ?? [];
  if (!j.requestId) return "no request id";
  if (steps.length !== 1) return "not a single deposit step";
  const deposit = steps[0].depositAddress;
  const tx = steps[0].items?.[0]?.data;
  if (!isAddress(deposit ?? "") || !tx) return "no deposit address";
  if (Number(tx.chainId) !== chain.id) return "deposit on the wrong chain";
  if (asset === "native") {
    if (!same(tx.to, deposit!) || (tx.data && tx.data !== "0x")) return "deposit is not a plain send";
    if (BigInt(tx.value ?? -1) !== amount) return "deposit amount differs";
  } else {
    if (!same(tx.to, chain.usdc) || BigInt(tx.value ?? 0) !== 0n) return "deposit is not a USDC transfer";
    try {
      const call = decodeFunctionData({ abi: TRANSFER, data: (tx.data ?? "0x") as `0x${string}` });
      if (!same(call.args[0], deposit!)) return "transfer goes elsewhere";
      if (call.args[1] !== amount) return "deposit amount differs";
    } catch { return "deposit is not a USDC transfer"; }
  }
  const d = j.details ?? {};
  const out = d.currencyOut;
  const lands = arrivesAs(chain, asset);
  const want = lands === "usdg" ? ONRAMP_TO.usdg : ONRAMP_TO.eth;
  if (!same(d.recipient, recipient)) return "delivers to someone else";
  if (Number(out?.currency?.chainId) !== ONRAMP_TO.chainId || !same(out?.currency?.address, want)) return "delivers the wrong asset";
  if (!(BigInt(out?.amount ?? 0) > 0n)) return "delivers nothing";
  if (lands === "usdg") {
    const g = d.currencyGasTopup;
    if (Number(g?.currency?.chainId) !== ONRAMP_TO.chainId || !same(g?.currency?.address, ONRAMP_TO.eth) || !(BigInt(g?.amount ?? 0) > 0n)) return "no gas top-up";
  }
  return null;
}

export function usdIn(j: RelayQuote): number | null {
  const v = Number(j.details?.currencyIn?.amountUsd);
  return Number.isFinite(v) && v > 0 ? v : null;
}
