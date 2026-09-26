export const PAY_FROM = {
  chainId: 4663,
  token: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  symbol: "USDG",
  decimals: 6,
} as const;

import { isAddress, type Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";

export interface PayChain { id: number; name: string; vm: "evm" | "svm"; usdc: string; explorer: string }

export const PAY_CHAINS: PayChain[] = [
  { id: 8453, name: "Base", vm: "evm", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", explorer: "https://basescan.org" },
  { id: 42161, name: "Arbitrum", vm: "evm", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", explorer: "https://arbiscan.io" },
  { id: 10, name: "Optimism", vm: "evm", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", explorer: "https://optimistic.etherscan.io" },
  { id: 1, name: "Ethereum", vm: "evm", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", explorer: "https://etherscan.io" },
  { id: 792703809, name: "Solana", vm: "svm", usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", explorer: "https://solscan.io" },
  { id: 137, name: "Polygon", vm: "evm", usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", explorer: "https://polygonscan.com" },
  { id: 56, name: "BNB Chain", vm: "evm", usdc: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", explorer: "https://bscscan.com" },
  { id: 43114, name: "Avalanche", vm: "evm", usdc: "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", explorer: "https://snowtrace.io" },
  { id: 59144, name: "Linea", vm: "evm", usdc: "0x176211869ca2b568f2a7d4ee941e073a821ee1ff", explorer: "https://lineascan.build" },
  { id: 130, name: "Unichain", vm: "evm", usdc: "0x078d782b760474a361dda0af3839290b0ef57ad6", explorer: "https://uniscan.xyz" },
  { id: 480, name: "World Chain", vm: "evm", usdc: "0x79a02482a880bce3f13e09da970dc34db4cd24d1", explorer: "https://worldscan.org" },
  { id: 146, name: "Sonic", vm: "evm", usdc: "0x29219dd400f2bf60e5a23d13be72b486d4038894", explorer: "https://sonicscan.org" },
  { id: 999, name: "HyperEVM", vm: "evm", usdc: "0xb88339cb7199b77e23db6e890353e22632ba630f", explorer: "https://hyperevmscan.io" },
  { id: 5000, name: "Mantle", vm: "evm", usdc: "0x09bc4e0d864854c6afb6eb9a9cdf58ac190d0df9", explorer: "https://mantlescan.xyz" },
  { id: 100, name: "Gnosis", vm: "evm", usdc: "0x2a22f9c3b484c3629090feed35f17ff8f88f76f0", explorer: "https://gnosisscan.io" },
  { id: 42220, name: "Celo", vm: "evm", usdc: "0xceba9300f2b948710d2653dd7b07f33a8b32118c", explorer: "https://celoscan.io" },
  { id: 57073, name: "Ink", vm: "evm", usdc: "0x2d270e6886d130d724215a266106e6832161eaed", explorer: "https://explorer.inkonchain.com" },
  { id: 80094, name: "Berachain", vm: "evm", usdc: "0x549943e04f40284185054145c6e4e9568c1d3241", explorer: "https://beratrail.io" },
  { id: 143, name: "Monad", vm: "evm", usdc: "0x754704bc059f8c67012fed69bc8a327a5aafb603", explorer: "https://monadvision.com" },
  { id: 5042, name: "Arc", vm: "evm", usdc: "0x3600000000000000000000000000000000000000", explorer: "https://explorer.arc.io" },
];

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function isSolanaAddress(s: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  let n = 0n;
  for (const ch of s) n = n * 58n + BigInt(B58.indexOf(ch));
  const lead = s.length - s.replace(/^1+/, "").length;
  const hex = n === 0n ? "" : n.toString(16);
  return lead + Math.ceil(hex.length / 2) === 32;
}

export const validRecipient = (chain: PayChain, s: string) => (chain.vm === "svm" ? isSolanaAddress(s) : isAddress(s));

export const payChain = (id: number) => PAY_CHAINS.find((c) => c.id === id);

export const PAY_FEE = { bps: 25, recipient: "0xE0d43ceA8c9a069f41D4Ce39126167532Dac2CAC" } as const;

export const PAY_MAX = 10_000n * 10n ** 6n;

export interface RelayPayQuote {
  requestId?: string;
  steps?: { depositAddress?: string; items?: { data?: { to?: string; data?: string } }[] }[];
}

export function payQuoteProblem(j: RelayPayQuote): string | null {
  const step = j.steps?.[0];
  const tx = step?.items?.[0]?.data;
  if (!isAddress(step?.depositAddress ?? "")) return "no deposit address";
  if (!j.requestId) return "no request id";
  const plain = tx && String(tx.to).toLowerCase() === PAY_FROM.token.toLowerCase() && String(tx.data).startsWith("0xa9059cbb");
  return plain ? null : "deposit is not a USDG transfer";
}

export const FIRST_REFUND_INDEX = 1;

export const MAX_REFUND_INDEX = 0x7fffffff;

export const refundAddress = (phrase: string, index: number): Address => {
  if (!Number.isInteger(index) || index < FIRST_REFUND_INDEX || index > MAX_REFUND_INDEX) throw new RangeError("bad refund index");
  return mnemonicToAccount(phrase.trim().replace(/\s+/g, " "), { addressIndex: index }).address;
};

export async function nextRefundIndex(recorded: Set<number>, used: (index: number) => Promise<boolean>): Promise<number> {
  for (let i = FIRST_REFUND_INDEX; i <= MAX_REFUND_INDEX; i++) {
    if (recorded.has(i)) continue;
    if (!(await used(i))) return i;
  }
  throw new Error("no refund address left");
}
