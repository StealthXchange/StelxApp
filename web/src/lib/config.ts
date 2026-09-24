import type { Address } from "viem";

export const EXECUTOR_ADDRESS = (process.env.NEXT_PUBLIC_STELX_EXECUTOR ??
  null) as Address | null;

export const CHAIN_ID = process.env.NEXT_PUBLIC_STELX_CHAIN_ID
  ? Number(process.env.NEXT_PUBLIC_STELX_CHAIN_ID)
  : null;

export const signingEnabled = EXECUTOR_ADDRESS !== null && CHAIN_ID !== null;
