"use client";

import { createPublicClient, type PublicClient } from "viem";
import { CHAIN, poolTransport } from "./config.ts";

let client: PublicClient | null = null;

export function poolClient(): PublicClient {
  if (!client) client = createPublicClient({ chain: CHAIN as any, transport: poolTransport() }) as PublicClient;
  return client;
}
