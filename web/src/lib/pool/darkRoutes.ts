import { decodeFunctionData, isAddress, parseAbi, type Address } from "viem";
import { PAY_FROM } from "./payRoutes.ts";

export const DARK_FROM = PAY_FROM;

export const NATIVE: Address = "0x0000000000000000000000000000000000000000";

export const RAILGUN_PROXY: Address = "0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9";

export type DarkRouteId = "eth" | "arb-usdc";

export interface DarkRoute {
  id: DarkRouteId;
  chainId: number;
  chainName: string;

  symbol: "ETH" | "USDC";
  decimals: number;

  relayCurrency: Address;

  noteToken: Address;
  railgunProxy: Address;

  relayAdapt: Address;
  explorer: string;

  amounts: string[];

  splitAt: string;

  minTarget: string;
  maxTarget: string;

  gasTopupUsd: string | null;

  gasUnits: bigint;

  shieldsByHour: number[];

  crowd: string;
}

export const DARK_ROUTES: DarkRoute[] = [
  {
    id: "eth",
    chainId: 1,
    chainName: "Ethereum",
    symbol: "ETH",
    decimals: 18,
    relayCurrency: NATIVE,
    noteToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    railgunProxy: RAILGUN_PROXY,
    relayAdapt: "0xAc9f360Ae85469B27aEDdEaFC579Ef2d052aD405",
    explorer: "https://etherscan.io",
    amounts: ["0.1", "0.25", "0.5", "1"],
    splitAt: "1",
    minTarget: "0.005",
    maxTarget: "4",
    gasTopupUsd: null,

    gasUnits: 950_000n,
    shieldsByHour: [56, 55, 54, 69, 91, 38, 33, 58, 61, 89, 68, 61, 60, 63, 71, 51, 67, 57, 73, 75, 73, 56, 74, 51],
    crowd: "About 20 shields a day on Ethereum come from a brand-new address, as this one will.",
  },
  {
    id: "arb-usdc",
    chainId: 42161,
    chainName: "Arbitrum",
    symbol: "USDC",
    decimals: 6,
    relayCurrency: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    noteToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    railgunProxy: RAILGUN_PROXY,
    relayAdapt: "0xB4F2d77bD12c6b548Ae398244d7FAD4ABCE4D89b",
    explorer: "https://arbiscan.io",
    amounts: ["100", "250", "500", "1000"],
    splitAt: "1000",
    minTarget: "20",
    maxTarget: "10000",

    gasTopupUsd: "100000",
    gasUnits: 57_000n + 762_000n,
    shieldsByHour: [11, 15, 11, 17, 16, 10, 18, 25, 31, 21, 18, 35, 33, 31, 43, 21, 27, 22, 15, 20, 21, 18, 8, 5],
    crowd: "About one shield a day on Arbitrum comes from a brand-new address. Cheaper, thinner cover.",
  },
];

export const darkRoute = (id: string) => DARK_ROUTES.find((r) => r.id === id);
export const DEFAULT_ROUTE: DarkRouteId = "eth";

export const DARK_MIN_USD = 20;
export const DARK_MAX_USD = 10_000;

export const TOPUP_CAP_USD = 0.25;

export const MIN_OUT_PCT = 97n;

export const RAILGUN_SHIELD_BPS = 25n;

export const POOL_FEE_BPS = 10n;
const BPS = 10_000n;
export const poolPayout = (withdrawn: bigint) => withdrawn - (withdrawn * POOL_FEE_BPS) / BPS;

export function withdrawalFor(amountIn: bigint): bigint {
  if (amountIn <= 0n) throw new RangeError("nothing to withdraw");
  let w = (amountIn * BPS + (BPS - POOL_FEE_BPS) - 1n) / (BPS - POOL_FEE_BPS);
  while (w > 1n && poolPayout(w - 1n) >= amountIn) w--;
  while (poolPayout(w) < amountIn) w++;
  if (poolPayout(w) !== amountIn) throw new Error("no withdrawal pays out exactly that");
  return w;
}

export const maxFeeFor = (baseFee: bigint, tip: bigint) => (baseFee * 5n) / 4n + tip;

export const tipFor = (suggested: bigint) => (suggested < 20_000_000n ? 20_000_000n : suggested > 2_000_000_000n ? 2_000_000_000n : suggested);

export const gasReserve = (route: DarkRoute, baseFee: bigint, tip: bigint) => route.gasUnits * maxFeeFor(baseFee, tip);

export const expectedOut = (route: DarkRoute, target: bigint, baseFee: bigint, tip: bigint) =>
  route.relayCurrency === NATIVE ? target + gasReserve(route, baseFee, tip) : target;

export function isBusyHour(route: DarkRoute, hour: number): boolean {
  const sorted = [...route.shieldsByHour].sort((a, b) => a - b);
  const median = (sorted[11] + sorted[12]) / 2;
  return route.shieldsByHour[((hour % 24) + 24) % 24] >= median;
}

export function nextBusyHour(route: DarkRoute, hour: number): number {
  const sorted = [...route.shieldsByHour].sort((a, b) => a - b);
  const q3 = sorted[18];
  for (let i = 0; i < 24; i++) {
    const h = (hour + i) % 24;
    if (route.shieldsByHour[h] >= q3) return h;
  }
  return hour;
}

export function splitParts(route: DarkRoute, target: bigint, unit: bigint, min: bigint): bigint[] {
  if (target <= unit) return [target];
  const parts: bigint[] = [];
  let left = target;
  while (left >= unit) { parts.push(unit); left -= unit; }
  if (left >= min) parts.push(left);
  else if (left > 0n) parts[parts.length - 1] += left;
  return parts;
}

export function relayQuoteBody(route: DarkRoute, asked: bigint, recipient: string, refundTo: string) {
  return {
    user: refundTo,
    recipient,
    refundTo,
    originChainId: DARK_FROM.chainId,
    originCurrency: DARK_FROM.token,
    destinationChainId: route.chainId,
    destinationCurrency: route.relayCurrency,
    amount: asked.toString(),
    tradeType: "EXPECTED_OUTPUT",
    useDepositAddress: true,
    ...(route.gasTopupUsd ? { topupGas: true, topupGasAmount: route.gasTopupUsd } : {}),
  };
}

const TRANSFER = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

interface Money { amount?: string; amountUsd?: string; minimumAmount?: string; currency?: { chainId?: number; address?: string } }

export interface DarkRelayQuote {
  requestId?: string;
  steps?: { depositAddress?: string; items?: { data?: { to?: string; data?: string; value?: string; chainId?: number } }[] }[];
  fees?: { app?: Money; relayer?: Money };
  details?: {
    recipient?: string;
    currencyIn?: Money;
    currencyOut?: Money;
    currencyGasTopup?: Money;
    timeEstimate?: number;
  };
}

export function darkQuoteProblem(j: DarkRelayQuote, route: DarkRoute, asked: bigint, recipient: string): string | null {
  try { return check(j, route, asked, recipient); } catch { return "malformed quote"; }
}

function check(j: DarkRelayQuote, route: DarkRoute, asked: bigint, recipient: string): string | null {
  if (!j.requestId) return "no request id";
  const steps = j.steps ?? [];
  if (steps.length !== 1) return "not a single deposit step";
  const items = steps[0].items ?? [];
  if (items.length !== 1) return "not a single deposit transaction";
  const deposit = steps[0].depositAddress;
  const tx = items[0].data;
  if (!isAddress(deposit ?? "") || !tx) return "no deposit address";
  if (Number(tx.chainId) !== DARK_FROM.chainId) return "deposit on the wrong chain";
  if (!same(tx.to, DARK_FROM.token) || BigInt(tx.value ?? 0) !== 0n) return "deposit is not a USDG transfer";
  let args: readonly unknown[];
  try { args = decodeFunctionData({ abi: TRANSFER, data: (tx.data ?? "0x") as `0x${string}` }).args; }
  catch { return "deposit is not a USDG transfer"; }
  if (!same(args[0], deposit!)) return "transfer goes elsewhere";

  const d = j.details ?? {};
  const cin = d.currencyIn;
  if (Number(cin?.currency?.chainId) !== DARK_FROM.chainId || !same(cin?.currency?.address, DARK_FROM.token)) return "paid in the wrong currency";
  const amountIn = BigInt(cin?.amount ?? 0);
  if (!(amountIn > 0n) || args[1] !== amountIn) return "deposit amount differs";

  if (!same(d.recipient, recipient)) return "delivers to someone else";
  const out = d.currencyOut;
  if (Number(out?.currency?.chainId) !== route.chainId || !same(out?.currency?.address, route.relayCurrency)) return "delivers the wrong asset";
  if (BigInt(out?.amount ?? -1) !== asked) return "delivers a different amount";
  if (BigInt(out?.minimumAmount ?? 0) * 100n < asked * MIN_OUT_PCT) return "promises too little";

  const g = d.currencyGasTopup;
  if (route.gasTopupUsd) {
    if (Number(g?.currency?.chainId) !== route.chainId || !same(g?.currency?.address, NATIVE) || !(BigInt(g?.amount ?? 0) > 0n)) return "no gas top-up";
    if (!(Number(g?.amountUsd) <= TOPUP_CAP_USD)) return "gas top-up too large";
  } else if (g && BigInt(g.amount ?? 0) !== 0n) {
    return "unexpected gas top-up";
  }
  if (BigInt(j.fees?.app?.amount ?? 0) !== 0n) return "carries an app fee";
  return null;
}

export function usdIn(j: DarkRelayQuote): number | null {
  const v = Number(j.details?.currencyIn?.amountUsd);
  return Number.isFinite(v) && v > 0 ? v : null;
}
