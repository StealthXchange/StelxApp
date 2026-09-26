import { isAddress, parseTransaction, type Hex } from "viem";
import { DARK_ROUTES, NATIVE } from "./darkRoutes.ts";

const READS = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getBalance", "eth_getTransactionCount",
  "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getTransactionReceipt", "eth_getTransactionByHash",
]);

const TARGETED = new Set(["eth_call", "eth_estimateGas"]);

export const DARK_CHAIN_IDS = [...new Set(DARK_ROUTES.map((r) => r.chainId))];

export function darkContracts(chainId: number): Set<string> {
  const out = new Set<string>();
  for (const r of DARK_ROUTES.filter((x) => x.chainId === chainId)) {
    for (const a of [r.railgunProxy, r.relayAdapt, r.noteToken, r.relayCurrency]) if (a !== NATIVE) out.add(a.toLowerCase());
  }
  return out;
}

export interface RpcCall { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown }

export function rpcCallProblem(chainId: number, call: RpcCall): string | null {
  if (!DARK_CHAIN_IDS.includes(chainId)) return "unknown chain";
  if (!call || typeof call !== "object" || Array.isArray(call)) return "one call at a time";
  const method = call.method;
  if (typeof method !== "string") return "no method";
  const params = Array.isArray(call.params) ? call.params : [];
  if (READS.has(method)) return null;
  const allowed = darkContracts(chainId);
  if (TARGETED.has(method)) {
    const to = (params[0] as { to?: unknown } | undefined)?.to;
    if (typeof to !== "string" || !isAddress(to) || !allowed.has(to.toLowerCase())) return "not a Dark Mode contract";

    if (params.length > 2) return "no overrides";
    return null;
  }
  if (method === "eth_sendRawTransaction") {
    if (params.length !== 1 || typeof params[0] !== "string" || !/^0x[0-9a-fA-F]+$/.test(params[0])) return "bad transaction";
    try {
      const tx = parseTransaction(params[0] as Hex);
      if (tx.chainId !== chainId) return "transaction for another chain";
      if (!tx.to || !allowed.has(tx.to.toLowerCase())) return "not a Dark Mode transaction";
    } catch { return "bad transaction"; }
    return null;
  }
  return "method not relayed";
}
