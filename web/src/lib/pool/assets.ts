import { formatUnits, parseAbi, parseUnits, type Address } from "viem";
import LIST from "./assets.json";
import { IS_MAINNET, POOL_TOKEN } from "./config.ts";
import { poolClient } from "./client.ts";

export type AssetKind = "eth" | "cash" | "stock";

export interface Asset {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  kind: AssetKind;
}

const kindOf = (symbol: string): AssetKind => (symbol === "WETH" ? "eth" : symbol === "USDG" ? "cash" : "stock");

export const ASSETS: Asset[] = IS_MAINNET
  ? LIST.map((a) => ({ ...a, address: a.address as Address, kind: kindOf(a.symbol) }))
  : [{ symbol: "WETH", name: "Wrapped Ether", address: POOL_TOKEN, decimals: 18, kind: "eth" }];

const byAddress = new Map(ASSETS.map((a) => [a.address.toLowerCase(), a]));

export function assetOf(address: string): Asset | undefined {
  return byAddress.get(address.toLowerCase());
}

export const WETH: Asset = assetOf(POOL_TOKEN) ?? ASSETS[0];

const ONE = 10n ** 18n;

export function shown(raw: bigint, multiplier: bigint | null): bigint {
  return multiplier ? (raw * multiplier) / ONE : raw;
}

export function fromShown(value: bigint, multiplier: bigint | null): bigint {
  return multiplier ? (value * ONE + multiplier / 2n) / multiplier : value;
}

export function formatAmount(raw: bigint, asset: Asset, multiplier: bigint | null, dp = 6): string {
  const s = formatUnits(shown(raw, multiplier), asset.decimals);
  if (!s.includes(".")) return s;
  const [i, f] = s.split(".");
  const cut = f.slice(0, dp).replace(/0+$/, "");
  return cut ? `${i}.${cut}` : i;
}

export function amountText(raw: bigint, asset: Asset, multiplier: bigint | null): string {
  return formatUnits(shown(raw, multiplier), asset.decimals);
}

export function parseAmount(text: string, asset: Asset, multiplier: bigint | null): bigint | null {
  try {
    const v = parseUnits(text.trim() || "0", asset.decimals);
    return v < 0n ? null : fromShown(v, multiplier);
  } catch {
    return null;
  }
}

const UI = parseAbi(["function uiMultiplier() view returns (uint256)"]);
const multipliers = new Map<string, { value: bigint | null; at: number }>();

export async function readMultiplier(asset: Asset): Promise<bigint | null> {
  if (asset.kind !== "stock") return null;
  const key = asset.address.toLowerCase();
  const hit = multipliers.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const m = await poolClient().readContract({ address: asset.address, abi: UI, functionName: "uiMultiplier" });
  const value = m === 0n ? null : m;
  multipliers.set(key, { value, at: Date.now() });
  return value;
}
