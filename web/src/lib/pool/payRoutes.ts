export const PAY_FROM = {
  chainId: 4663,
  token: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  symbol: "USDG",
  decimals: 6,
} as const;

export interface PayChain { id: number; name: string; usdc: `0x${string}`; explorer: string }

export const PAY_CHAINS: PayChain[] = [
  { id: 8453, name: "Base", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", explorer: "https://basescan.org" },
  { id: 42161, name: "Arbitrum", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", explorer: "https://arbiscan.io" },
  { id: 10, name: "Optimism", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", explorer: "https://optimistic.etherscan.io" },
  { id: 1, name: "Ethereum", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", explorer: "https://etherscan.io" },
];

export const payChain = (id: number) => PAY_CHAINS.find((c) => c.id === id);

export const PAY_MAX = 10_000n * 10n ** 6n;
