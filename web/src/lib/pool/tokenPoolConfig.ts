import { isAddress, zeroAddress, type Address } from "viem";

export const STELX_MAINNET = {
  chainId: 4663,
  token: "0x7a8cda6a1cab3e5146cd13cb623a3bb284fb4ad1" as Address,
  decimals: 18,
  runtimeCodeHash: "0xb502d20e4bf1ef304bac19710e74d782403148e0017e26ee87f7528bfcc18ae5",
} as const;

export function checkStelxIdentity(chainId: number, token: string, decimals: number, runtimeCodeHash?: string): void {
  if (chainId !== STELX_MAINNET.chainId) return;
  if (token.toLowerCase() !== STELX_MAINNET.token || decimals !== STELX_MAINNET.decimals) {
    throw new Error("STELX mainnet settings must use the verified STELX token and decimals");
  }
  if (runtimeCodeHash !== undefined && runtimeCodeHash !== STELX_MAINNET.runtimeCodeHash) {
    throw new Error("STELX token code differs from the verified mainnet contract");
  }
}

export interface TokenPoolConfig {
  pool: Address;
  token: Address;
  decimals: number;
  chainId: number;
  chainName: string;
  rpc: string;
  explorer: string;
  deployBlock: bigint;
  relays: string[];
  maxFee: bigint;
}

export interface TokenPoolSettings {
  pool?: string; token?: string; decimals?: string; chainId?: string; chainName?: string;
  rpc?: string; explorer?: string; deployBlock?: string; relays?: string; maxFee?: string;
}

function address(value: string | undefined, name: string): Address {
  if (!value || !isAddress(value) || value.toLowerCase() === zeroAddress) throw new Error(`Invalid STELX ${name}`);
  return value as Address;
}

function url(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing STELX ${name}`);
  const u = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.username || u.password || (u.protocol !== "https:" && !(local && u.protocol === "http:"))) {
    throw new Error(`STELX ${name} must use HTTPS or local HTTP`);
  }
  return u.href.replace(/\/$/, "");
}

export function parseTokenPoolSettings(s: TokenPoolSettings): TokenPoolConfig | null {
  if (!Object.values(s).some(Boolean)) return null;
  const chainId = Number(s.chainId), decimals = Number(s.decimals);
  if (!s.chainId || !Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid STELX chain ID");
  if (s.decimals === undefined || s.decimals === "" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Invalid STELX decimals");
  const token = address(s.token, "token address");
  checkStelxIdentity(chainId, token, decimals);
  if (!s.deployBlock || !/^\d+$/.test(s.deployBlock)) throw new Error("Invalid STELX deploy block");
  if (!s.maxFee || !/^\d+$/.test(s.maxFee) || BigInt(s.maxFee) >= 1n << 120n) throw new Error("Invalid STELX relay fee cap");
  const relays = (s.relays ?? "").split(",").map((r) => r.trim()).filter(Boolean).map((r) => url(r, "relay"));
  if (!relays.length) throw new Error("Missing STELX relay");
  return {
    pool: address(s.pool, "pool address"), token, decimals, chainId,
    chainName: s.chainName?.trim() || `Chain ${chainId}`, rpc: url(s.rpc, "RPC"), explorer: url(s.explorer, "explorer"),
    deployBlock: BigInt(s.deployBlock), relays, maxFee: BigInt(s.maxFee),
  };
}

export function configuredTokenPool(): TokenPoolConfig | null {
  return parseTokenPoolSettings({
    pool: process.env.NEXT_PUBLIC_STELX_POOL_ADDRESS,
    token: process.env.NEXT_PUBLIC_STELX_TOKEN,
    decimals: process.env.NEXT_PUBLIC_STELX_TOKEN_DECIMALS,
    chainId: process.env.NEXT_PUBLIC_STELX_CHAIN_ID,
    chainName: process.env.NEXT_PUBLIC_STELX_CHAIN_NAME,
    rpc: process.env.NEXT_PUBLIC_STELX_RPC,
    explorer: process.env.NEXT_PUBLIC_STELX_EXPLORER,
    deployBlock: process.env.NEXT_PUBLIC_STELX_DEPLOY_BLOCK,
    relays: process.env.NEXT_PUBLIC_STELX_BROADCASTERS,
    maxFee: process.env.NEXT_PUBLIC_STELX_MAX_RELAY_FEE,
  });
}
