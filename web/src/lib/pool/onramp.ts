"use client";

import { createWalletClient, encodeFunctionData, formatEther, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, POOL_TOKEN, poolAddress, poolTransport } from "./config.ts";
import { poolClient, refresh, storage, walletFor } from "./walletStore.ts";
import { findLandingIndices, landingKey, nextLandingIndex } from "./landingKeys.ts";
import { ONRAMP_TO, type OnrampAsset } from "./onrampRoutes.ts";

const USDG = ONRAMP_TO.usdg as Address;
const ERC20 = parseAbi([
  "function balanceOf(address a) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit() payable",
]);

const GAS_UNITS = 1_500_000n;

export const ETH_DUST = 10n ** 15n;

export const landingAddress = (phrase: string, index: number): Address => privateKeyToAccount(landingKey(phrase, index)).address;

export interface Landed { address: Address; eth: bigint; usdg: bigint; weth: bigint; nonce: number }

export async function readLanding(address: Address): Promise<Landed> {
  const c = poolClient();
  const [eth, usdg, weth, nonce] = await Promise.all([
    c.getBalance({ address }),
    c.readContract({ address: USDG, abi: ERC20, functionName: "balanceOf", args: [address] }),
    c.readContract({ address: POOL_TOKEN, abi: ERC20, functionName: "balanceOf", args: [address] }),
    c.getTransactionCount({ address }),
  ]);
  return { address, eth, usdg, weth, nonce };
}

export const hasArrival = (l: Landed) => l.usdg > 0n || l.weth > 0n || l.eth >= ETH_DUST;

export const hasLeftover = (l: Landed) => l.nonce > 0 && l.eth > 0n && !hasArrival(l);

const used = (l: Landed) => l.nonce > 0 || l.eth > 0n || l.usdg > 0n || l.weth > 0n;

export interface ArrivalRecord {
  index: number;
  chainId?: number;
  asset?: OnrampAsset;

  amountIn?: string;
  requestId?: string;
  depositAddress?: string;

  at: number;

  depositTx?: string;
}

const recordKey = (poolAddr: string) => `stelx.pool.v1.arrivals.${poolAddr.slice(6, 26)}`;

export function loadArrivals(poolAddr: string): ArrivalRecord[] {
  try {
    const raw = storage()?.getItem(recordKey(poolAddr));
    const list = raw ? (JSON.parse(raw) as ArrivalRecord[]) : [];
    return Array.isArray(list) ? list.filter((r) => Number.isInteger(r?.index)) : [];
  } catch {
    return [];
  }
}

export function saveArrival(poolAddr: string, r: ArrivalRecord): void {
  const list = [...loadArrivals(poolAddr).filter((x) => x.index !== r.index), r].sort((a, b) => a.index - b.index);
  try { storage()?.setItem(recordKey(poolAddr), JSON.stringify(list)); } catch {  }
}

export async function allocateLanding(phrase: string, poolAddr: string): Promise<{ index: number; address: Address }> {
  const recorded = new Set(loadArrivals(poolAddr).map((r) => r.index));
  const index = await nextLandingIndex(recorded, async (i) => used(await readLanding(landingAddress(phrase, i))));
  return { index, address: landingAddress(phrase, index) };
}

export async function findArrivals(phrase: string, poolAddr: string, progress?: (index: number) => void): Promise<{ index: number; landed: Landed }[]> {
  const known = new Map(loadArrivals(poolAddr).map((r) => [r.index, r]));
  const out: { index: number; landed: Landed }[] = [];
  const seen = new Set<number>();
  await findLandingIndices(async (i) => {
    progress?.(i);
    const landed = await readLanding(landingAddress(phrase, i));
    if (used(landed)) { out.push({ index: i, landed }); seen.add(i); }
    return used(landed) || known.has(i);
  });

  for (const i of known.keys()) {
    if (!seen.has(i)) out.push({ index: i, landed: await readLanding(landingAddress(phrase, i)) });
  }
  for (const { index } of out) {
    if (!known.has(index)) saveArrival(poolAddr, { index, at: 0 });
  }
  return out.sort((a, b) => a.index - b.index);
}

export type DepositStep = "wrap" | "approve" | "deposit" | "sweep";

async function landingSigner(phrase: string, index: number, onStep?: (s: DepositStep, symbol: string) => void) {
  const account = privateKeyToAccount(landingKey(phrase, index));
  const client = poolClient();
  const signer = createWalletClient({ account, chain: CHAIN, transport: poolTransport() });
  const pool = poolAddress();

  const perGas = await client.estimateFeesPerGas().then((f) => f.maxFeePerGas!, () => client.getGasPrice());
  const keep = perGas * GAS_UNITS;
  const hashes: Hex[] = [];

  const send = async (to: Address, data: Hex, value = 0n): Promise<Hex> => {
    let hash: Hex;
    try {
      const gas = ((await client.estimateGas({ account: account.address, to, data, value })) * 12n) / 10n;
      hash = await signer.sendTransaction({ to, data, value, gas });
    } catch (e) {
      const x = e as { shortMessage?: string; details?: string; message?: string };

      const msg = [x?.shortMessage, x?.details, x?.message].filter(Boolean).join(" ") || String(e);
      if (!/insufficient funds|exceeds (the )?balance/i.test(msg)) throw e;
      const eth = await client.getBalance({ address: account.address });
      throw new Error(
        `Not enough ETH for gas on the landing address ${account.address}: it holds ${formatEther(eth)}. ` +
        `Send it about ${formatEther(keep)} ETH on Robinhood Chain, then try again. Nothing was lost.`,
      );
    }
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("A transaction from the landing address reverted. Nothing more was sent.");
    return hash;
  };

  const shieldAll = async (token: Address, symbol: string) => {
    const bal = await client.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account.address] });
    if (bal === 0n) return;
    const allowance = await client.readContract({ address: token, abi: ERC20, functionName: "allowance", args: [account.address, pool] });
    if (allowance < bal) {
      onStep?.("approve", symbol);
      await send(token, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [pool, bal] }));
    }
    onStep?.("deposit", symbol);
    const built = await (await walletFor(token)).buildShield(token, bal);
    hashes.push(await send(built.to as Address, built.data as Hex));
  };

  const wrap = (value: bigint) => send(POOL_TOKEN, encodeFunctionData({ abi: ERC20, functionName: "deposit" }), value);

  return { address: account.address, client, keep, hashes, shieldAll, wrap };
}

export async function depositArrival(phrase: string, index: number, onStep?: (s: DepositStep, symbol: string) => void): Promise<Hex[]> {
  const { address, client, keep, hashes, shieldAll, wrap } = await landingSigner(phrase, index, onStep);

  await shieldAll(USDG, "USDG");

  const eth = await client.getBalance({ address });
  if (eth >= ETH_DUST && eth > keep) {
    onStep?.("wrap", "ETH");
    await wrap(eth - keep);
  }
  await shieldAll(POOL_TOKEN, "WETH");

  if (hashes.length) await refresh();
  return hashes;
}

export async function sweepLeftover(phrase: string, index: number, onStep?: (s: DepositStep, symbol: string) => void): Promise<bigint> {
  const { address, client, keep, shieldAll, wrap } = await landingSigner(phrase, index, onStep);
  const [l, gasPrice] = await Promise.all([readLanding(address), client.getGasPrice()]);
  const spare = l.eth - keep;
  if (!hasLeftover(l) || spare < 2n * GAS_UNITS * gasPrice) return 0n;

  onStep?.("sweep", "ETH");
  await wrap(spare);
  await shieldAll(POOL_TOKEN, "WETH");
  await refresh();
  return spare;
}
