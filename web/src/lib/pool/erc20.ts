"use client";

import { createWalletClient, custom, encodeFunctionData, formatEther, parseAbi, parseEther, type Address, type Hex } from "viem";
import { CHAIN, poolAddress, POOL_CHAIN_ID, POOL_TOKEN, POOL_RPC } from "./config.ts";
import { poolClient } from "./walletStore.ts";

export const WETH_ABI = parseAbi([
  "function deposit() payable",
  "function withdraw(uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export interface BrowserWallet { id: string; name: string; icon: string; provider: any }

const found = new Map<string, BrowserWallet>();
const listeners = new Set<(w: BrowserWallet[]) => void>();
let chosen: any = null;

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: any) => {
    const { info, provider } = e.detail ?? {};
    if (!info?.uuid || !provider) return;
    const id = info.rdns || info.uuid;
    found.set(id, { id, name: String(info.name ?? "Wallet"), icon: String(info.icon ?? ""), provider });
    for (const l of listeners) l([...found.values()]);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function watchWallets(cb: (w: BrowserWallet[]) => void): () => void {
  listeners.add(cb);
  cb([...found.values()]);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => { listeners.delete(cb); };
}

function injected(): any {
  const eth = chosen ?? (found.size === 1 ? [...found.values()][0].provider : (globalThis as any).ethereum);
  if (!eth) throw new Error("No wallet extension found in this browser.");
  return eth;
}

export function hasWallet(): boolean {
  return typeof globalThis !== "undefined" && (found.size > 0 || Boolean((globalThis as any).ethereum));
}

export function connectedWalletProvider() { return injected(); }

export async function connect(id?: string): Promise<Address> {
  const picked = id ? found.get(id)?.provider : null;
  if (id && !picked) throw new Error("That wallet is no longer available. Reload the page and try again.");
  const eth = picked ?? injected();
  const [account] = await eth.request({ method: "eth_requestAccounts" });
  chosen = eth;
  return account as Address;
}

export async function currentChainId(): Promise<number> {
  const eth = injected();
  return Number(await eth.request({ method: "eth_chainId" }));
}

export async function ensureChain(): Promise<void> {
  const eth = injected();
  const hex = `0x${POOL_CHAIN_ID.toString(16)}`;
  const reason = (e: any) => String(e?.message ?? e?.data?.originalError?.message ?? e);
  const declined = (e: any) => e?.code === 4001 || e?.data?.originalError?.code === 4001;

  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e: any) {
    if (declined(e)) throw new Error("You declined the network switch in your wallet.");
    try {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hex,
          chainName: CHAIN.name,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: [POOL_RPC],
          blockExplorerUrls: [CHAIN.blockExplorers.default.url],
        }],
      });
    } catch (e2: any) {
      if (declined(e2)) throw new Error("You declined adding the network in your wallet.");
      throw new Error(`Your wallet would not switch to ${CHAIN.name} or add it: ${reason(e2)}. Add it by hand: chain ID ${POOL_CHAIN_ID}, RPC ${POOL_RPC}.`);
    }

    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }).catch(() => {});
  }

  const now = await currentChainId();
  if (now !== POOL_CHAIN_ID) {
    throw new Error(`Your wallet is still on chain ${now}. Switch it to ${CHAIN.name} (chain ID ${POOL_CHAIN_ID}) and try again.`);
  }
}

async function signer(account: Address) {
  return createWalletClient({ account, chain: CHAIN as any, transport: custom(injected()) });
}

export const GAS_RESERVE = parseEther("0.0005");

function explainEstimate(e: any): string {
  const msg = String(e?.shortMessage ?? e?.details ?? e?.message ?? e);
  if (/insufficient funds/i.test(msg)) return "Not enough ETH to cover this and its gas. Try a smaller amount.";
  if (/revert/i.test(msg)) return `The chain would reject this transaction: ${msg}`;
  return msg;
}

async function sendAndWait(account: Address, to: Address, data: Hex, value = 0n): Promise<Hex> {
  const client = poolClient();

  let gas: bigint;
  try {
    gas = await client.estimateGas({ account, to, data, value });
  } catch (e) {
    throw new Error(explainEstimate(e));
  }
  gas = (gas * 12n) / 10n;

  let fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | { gasPrice: bigint };
  let perGas: bigint;
  try {
    const f = await client.estimateFeesPerGas();
    fees = { maxFeePerGas: f.maxFeePerGas!, maxPriorityFeePerGas: f.maxPriorityFeePerGas! };
    perGas = f.maxFeePerGas!;
  } catch {
    const gasPrice = await client.getGasPrice();
    fees = { gasPrice };
    perGas = gasPrice;
  }

  const balance = await client.getBalance({ address: account });
  const cost = value + gas * perGas;
  if (balance < cost) {
    throw new Error(`Not enough ETH: this needs ${formatEther(cost)} including gas, and the wallet holds ${formatEther(balance)}.`);
  }

  const wallet = await signer(account);
  let hash: Hex;
  try {
    hash = await wallet.sendTransaction({ to, data, value, account, chain: CHAIN as any, gas, ...fees } as any);
  } catch (e: any) {

    const msg = String(e?.shortMessage ?? e?.details ?? e?.message ?? e);
    if (/status code 404|\b404\b/.test(msg)) {
      throw new Error(
        "Your wallet returned an HTTP 404 before sending, so nothing moved. " +
        "Try another wallet, such as MetaMask or Rabby.",
      );
    }
    throw e;
  }
  const receipt = await poolClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted on chain.");
  return hash;
}

export interface DepositReadiness {
  eth: bigint;

  balance: bigint;
  allowance: bigint;
}

export async function readReadiness(account: Address, token: Address): Promise<DepositReadiness> {
  const client = poolClient();
  const [eth, balance, allowance] = await Promise.all([
    client.getBalance({ address: account }),
    client.readContract({ address: token, abi: WETH_ABI, functionName: "balanceOf", args: [account] }),
    client.readContract({ address: token, abi: WETH_ABI, functionName: "allowance", args: [account, poolAddress()] }),
  ]);
  return { eth, balance, allowance };
}

export async function wrap(account: Address, amount: bigint): Promise<Hex> {
  return sendAndWait(account, POOL_TOKEN, encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" }), amount);
}

export async function approve(account: Address, token: Address, amount: bigint): Promise<Hex> {
  return sendAndWait(
    account, token,
    encodeFunctionData({ abi: WETH_ABI, functionName: "approve", args: [poolAddress(), amount] }),
  );
}

export async function submitSelf(account: Address, tx: { to: string; data: string }): Promise<Hex> {
  return sendAndWait(account, tx.to as Address, tx.data as Hex);
}

export interface Call { to: Address; data: Hex; value?: bigint }

export const wrapCall = (amount: bigint): Call =>
  ({ to: POOL_TOKEN, data: encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" }), value: amount });

export const approveCall = (token: Address, amount: bigint): Call =>
  ({ to: token, data: encodeFunctionData({ abi: WETH_ABI, functionName: "approve", args: [poolAddress(), amount] }) });

const refused = (e: any) => e?.code === 4001 || e?.data?.originalError?.code === 4001;

async function canBatch(account: Address): Promise<boolean> {
  const hex = `0x${POOL_CHAIN_ID.toString(16)}`;
  try {
    const caps = await injected().request({ method: "wallet_getCapabilities", params: [account, [hex]] });
    const c = caps?.[hex] ?? caps?.[POOL_CHAIN_ID];
    const s = c?.atomic?.status ?? (c?.atomicBatch?.supported ? "supported" : undefined);
    return s === "supported" || s === "ready";
  } catch {
    return false;
  }
}

async function sendBatch(account: Address, calls: Call[]): Promise<Hex> {
  const eth = injected();
  const res = await eth.request({
    method: "wallet_sendCalls",
    params: [{
      version: "2.0.0",
      chainId: `0x${POOL_CHAIN_ID.toString(16)}`,
      from: account,
      atomicRequired: true,
      calls: calls.map((c) => ({ to: c.to, data: c.data, value: `0x${(c.value ?? 0n).toString(16)}` })),
    }],
  });
  const id = typeof res === "string" ? res : res?.id;
  for (let i = 0; i < 180; i++) {
    const s = await eth.request({ method: "wallet_getCallsStatus", params: [id] });
    const status = s?.status;
    if (status === 200 || status === "CONFIRMED") {
      const hash = s.receipts?.at(-1)?.transactionHash as Hex | undefined;
      if (!hash) throw new Error("Your wallet says it's done but gave no transaction. Check your wallet's activity.");
      const receipt = await poolClient().waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Transaction reverted on chain.");
      return hash;
    }
    if (typeof status === "number" && status >= 400) throw new Error("The deposit didn't go through. Nothing was taken beyond gas.");
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Still waiting on your wallet. Check its activity before trying again.");
}

export async function sendAll(account: Address, calls: Call[], onStep?: (i: number | "batch") => void): Promise<Hex> {
  if (calls.length > 1 && await canBatch(account)) {
    onStep?.("batch");
    try {
      return await sendBatch(account, calls);
    } catch (e: any) {
      if (refused(e)) throw new Error("You declined in your wallet.");

      if (e?.code !== -32601 && e?.code !== 5700 && e?.code !== 5710 && e?.code !== -32602) throw e;
    }
  }
  let hash: Hex = "0x";
  for (const [i, c] of calls.entries()) {
    onStep?.(i);
    try {
      hash = await sendAndWait(account, c.to, c.data, c.value ?? 0n);
    } catch (e: any) {
      if (refused(e)) throw new Error("You declined in your wallet.");
      throw e;
    }
  }
  return hash;
}
