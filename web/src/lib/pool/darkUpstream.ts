export const UPSTREAM: Record<number, string> = {
  1: process.env.DARK_RPC_1 ?? "https://ethereum-rpc.publicnode.com",
  42161: process.env.DARK_RPC_42161 ?? "https://arb1.arbitrum.io/rpc",
};

export async function upstream(chainId: number, method: string, params: unknown[]): Promise<unknown> {
  const url = UPSTREAM[chainId];
  if (!url) throw new Error("unknown chain");
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? "RPC error");
  return j.result;
}
