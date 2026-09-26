import { decodeFunctionData, isAddress, parseAbi } from "viem";
import { sha256 } from "@noble/hashes/sha256";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
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

  792703809: { usdcDecimals: 6, native: null },
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

export const ONRAMP_RECHECK = new Set([5042]);

export const ONRAMP_HELD = new Set<number>();

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

interface SolanaInstruction { programId?: string; keys?: { pubkey?: string; isSigner?: boolean; isWritable?: boolean }[]; data?: string }

export interface RelayQuote {
  requestId?: string;
  steps?: { depositAddress?: string; items?: { data?: { to?: string; data?: string; value?: string; chainId?: number; instructions?: SolanaInstruction[] } }[] }[];
  details?: {
    recipient?: string;
    currencyIn?: { amount?: string; amountUsd?: string; currency?: { chainId?: number; address?: string } };
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
  if (chain.vm === "svm") {
    const problem = solanaDepositProblem(j, chain, amount);
    if (problem) return problem;
  } else {
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

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";

function solanaKey(s: unknown): Uint8Array | null {
  if (typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return null;
  try { const b = base58.decode(s); return b.length === 32 ? b : null; } catch { return null; }
}

function onCurve(b: Uint8Array): boolean {
  try { ed25519.ExtendedPoint.fromHex(b); return true; } catch { return false; }
}

export function associatedTokenAccount(owner: string, mint: string): string {
  const seeds = [solanaKey(owner), solanaKey(TOKEN_PROGRAM), solanaKey(mint)];
  if (seeds.some((s) => !s)) throw new Error("not a Solana address");
  const tail = [...solanaKey(ATA_PROGRAM)!, ...new TextEncoder().encode("ProgramDerivedAddress")];
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(new Uint8Array([...seeds.flatMap((s) => [...s!]), bump, ...tail]));
    if (!onCurve(h)) return base58.encode(h);
  }
  throw new Error("no program address");
}

const u64le = (hex: string) => BigInt(`0x${hex.match(/../g)!.reverse().join("")}`);

function solanaDepositProblem(j: RelayQuote, chain: OnrampChain, amount: bigint): string | null {
  const step = j.steps![0];
  const deposit = step.depositAddress;
  if (!solanaKey(deposit)) return "no deposit address";
  const items = step.items ?? [];
  const ixs = items[0]?.data?.instructions;
  if (items.length !== 1 || !Array.isArray(ixs)) return "no deposit address";
  const cin = j.details?.currencyIn;
  if (Number(cin?.currency?.chainId) !== chain.id) return "deposit on the wrong chain";
  if (cin?.currency?.address !== chain.usdc) return "deposit is not a USDC transfer";
  if (BigInt(cin?.amount ?? -1) !== amount) return "deposit amount differs";

  const into = associatedTokenAccount(deposit!, chain.usdc);
  const keys = (ix: SolanaInstruction) => (ix.keys ?? []).map((k) => k.pubkey);
  const transfers = ixs.filter((ix) => ix.programId === TOKEN_PROGRAM);
  if (transfers.length !== 1) return "deposit is not one USDC transfer";
  const t = transfers[0];
  const data = String(t.data ?? "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(data)) return "deposit is not one USDC transfer";
  let from: string | undefined, to: string | undefined, owner: string | undefined, sent: bigint;
  if (data.length === 18 && data.startsWith("03")) {

    [from, to, owner] = keys(t);
    sent = u64le(data.slice(2));
  } else if (data.length === 20 && data.startsWith("0c")) {

    let mint: string | undefined;
    [from, mint, to, owner] = keys(t);
    if (mint !== chain.usdc || parseInt(data.slice(18), 16) !== chain.usdcDecimals) return "deposit is not a USDC transfer";
    sent = u64le(data.slice(2, 18));
  } else return "deposit is not a USDC transfer";
  if (to !== into) return "transfer goes elsewhere";
  if (!solanaKey(owner) || from !== associatedTokenAccount(owner!, chain.usdc)) return "deposit is not a USDC transfer";
  if (sent !== amount) return "deposit amount differs";

  for (const ix of ixs) {
    if (ix === t) continue;
    if (ix.programId === COMPUTE_BUDGET && keys(ix).length === 0) continue;
    if (ix.programId !== ATA_PROGRAM) return "deposit does something else";

    const [, account, holder, mint, system, token, ...rest] = keys(ix);
    const d = String(ix.data ?? "");
    if ((d !== "" && d !== "01") || rest.length || system !== SYSTEM_PROGRAM || token !== TOKEN_PROGRAM || mint !== chain.usdc) return "deposit does something else";
    if ((holder !== deposit && holder !== owner) || account !== associatedTokenAccount(holder!, chain.usdc)) return "deposit does something else";
  }
  return null;
}

export function usdIn(j: RelayQuote): number | null {
  const v = Number(j.details?.currencyIn?.amountUsd);
  return Number.isFinite(v) && v > 0 ? v : null;
}
