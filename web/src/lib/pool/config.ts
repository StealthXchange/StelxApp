import { http, type Address } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";

export const POOL_CHAIN_ID = +(process.env.NEXT_PUBLIC_POOL_CHAIN_ID ?? 46630);

export const POOL_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_POOL_ADDRESS);

const WITHDRAWN_POOL = "0xEC9ecEbddE288d9247143984ced724F57Ad67098";

function requirePool(): Address {
  const a = process.env.NEXT_PUBLIC_POOL_ADDRESS;
  if (!a) {
    throw new Error(
      "NEXT_PUBLIC_POOL_ADDRESS is not set. There is deliberately no default: " +
      "the old one was the withdrawn 2026-09-11 pool. Set it to the audited " +
      "deployment before building.",
    );
  }
  if (a.toLowerCase() === WITHDRAWN_POOL.toLowerCase()) {
    throw new Error(
      `NEXT_PUBLIC_POOL_ADDRESS is the WITHDRAWN pool ${WITHDRAWN_POOL}, which is ` +
      "vulnerable to BBA-01 and must never take a deposit. Point it at the audited deployment.",
    );
  }
  return a as Address;
}

let cachedPool: Address | null = null;
export function poolAddress(): Address {
  if (!cachedPool) cachedPool = requirePool();
  return cachedPool;
}

export const POOL_TOKEN = (process.env.NEXT_PUBLIC_POOL_TOKEN ??
  "0x33e4191705c386532ba27cBF171Db86919200B94") as Address;

export function poolDeployBlock(): bigint {
  const b = process.env.NEXT_PUBLIC_POOL_DEPLOY_BLOCK;
  if (!b) throw new Error("NEXT_PUBLIC_POOL_DEPLOY_BLOCK is not set; scanning from the wrong block misses notes");
  return BigInt(b);
}

export const POOL_RPC =
  process.env.NEXT_PUBLIC_POOL_RPC ?? "https://rpc.testnet.chain.robinhood.com";

export const IS_MAINNET = POOL_CHAIN_ID === 4663;

export const EXPLORER =
  process.env.NEXT_PUBLIC_POOL_EXPLORER ??
  (IS_MAINNET ? "https://robinhoodchain.blockscout.com" : "https://explorer.testnet.chain.robinhood.com");

export const BROADCASTERS: string[] = (process.env.NEXT_PUBLIC_POOL_BROADCASTERS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const VIEM_CHAIN = [robinhood, robinhoodTestnet].find((c) => c.id === POOL_CHAIN_ID);

export const CHAIN = {
  ...VIEM_CHAIN,
  id: POOL_CHAIN_ID,
  name: VIEM_CHAIN?.name ?? (IS_MAINNET ? "Robinhood Chain" : "Robinhood Chain Testnet"),
  nativeCurrency: VIEM_CHAIN?.nativeCurrency ?? { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [POOL_RPC] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
  blockTime: VIEM_CHAIN?.blockTime ?? 250,
  testnet: !IS_MAINNET,
};

export const poolTransport = (url: string = POOL_RPC) => http(url, { retryCount: 5, retryDelay: 300 });

export const SCAN_CHUNK = 500_000n;

export const FAUCETS = IS_MAINNET ? [] : [
  { name: "Robinhood faucet", url: "https://faucet.testnet.chain.robinhood.com/", note: "Wallet address only" },
  { name: "Chainstack", url: "https://faucet.chainstack.com/robinhood-chain-testnet-faucet", note: "Needs 0.08 ETH on mainnet" },
  { name: "Alchemy", url: "https://www.alchemy.com/faucets/robinhood-testnet", note: "Needs 0.001 ETH on mainnet" },
];

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;

export const ARTIFACTS = {
  wasm: "/pool/transaction.wasm",
  zkey: "/pool/transaction.zkey",
  verificationKey: "/pool/verification_key.json",

  totalBytes: 12_870_000,
};
