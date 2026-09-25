import {
  createPublicClient, createWalletClient, custom, decodeEventLog, decodeFunctionData, encodeFunctionData,
  http, isAddress, keccak256, parseAbi, zeroAddress, type Address, type EIP1193Provider, type Hex,
} from "viem";
import { Wallet, POOL_ABI, type WalletConfig } from "./vendor/wallet.ts";
import { decodeAddress } from "./vendor/keys.ts";
import type { BroadcasterInfo } from "./vendor/broadcast.ts";
import { checkStelxIdentity, type TokenPoolConfig } from "./tokenPoolConfig.ts";

const TOKEN_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
const CHECK_ABI = parseAbi([
  "function isSupported(address) view returns (bool)",
  "function FEE_BPS() view returns (uint256)",
  "function TREE_DEPTH() view returns (uint256)",
  "function minShield(address) view returns (uint256)",
]);

export function tokenPoolChain(c: TokenPoolConfig) {
  return {
    id: c.chainId, name: c.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [c.rpc] } },
    blockExplorers: { default: { name: "Explorer", url: c.explorer } },
  } as const;
}

export function tokenPoolClient(c: TokenPoolConfig) {
  return createPublicClient({ chain: tokenPoolChain(c), transport: http(c.rpc, { retryCount: 3 }) });
}

export async function checkTokenPool(c: TokenPoolConfig): Promise<{ minimum: bigint }> {
  const client = tokenPoolClient(c);
  const [chain, poolCode, tokenCode, head, decimals, supported, fee, depth, minimum] = await Promise.all([
    client.getChainId(), client.getCode({ address: c.pool }), client.getCode({ address: c.token }),
    client.getBlockNumber({ cacheTime: 0 }),
    client.readContract({ address: c.token, abi: TOKEN_ABI, functionName: "decimals" }),
    client.readContract({ address: c.pool, abi: CHECK_ABI, functionName: "isSupported", args: [c.token] }),
    client.readContract({ address: c.pool, abi: CHECK_ABI, functionName: "FEE_BPS" }),
    client.readContract({ address: c.pool, abi: CHECK_ABI, functionName: "TREE_DEPTH" }),
    client.readContract({ address: c.pool, abi: CHECK_ABI, functionName: "minShield", args: [c.token] }),
  ]);
  if (chain !== c.chainId) throw new Error("The STELX RPC is on the wrong chain.");
  if (!poolCode || poolCode === "0x" || !tokenCode || tokenCode === "0x") throw new Error("The STELX pool or token is missing on this chain.");
  checkStelxIdentity(chain, c.token, decimals, keccak256(tokenCode));
  if (c.deployBlock > head) throw new Error("The STELX pool deployment block is ahead of the chain.");
  if (decimals !== c.decimals) throw new Error("STELX token decimals do not match the deployment settings.");
  if (!supported) throw new Error("This pool does not accept the configured STELX token.");
  if (fee !== 10n || depth !== 24n || minimum < 1n) throw new Error("The STELX pool does not match this wallet's contract settings.");
  return { minimum };
}

export type TokenRelay = BroadcasterInfo & { feeToken: Address };

export function parseTokenRelay(value: unknown, url: string, c: TokenPoolConfig): TokenRelay {
  if (!value || typeof value !== "object") throw new Error("Invalid relay response");
  const j = value as Record<string, unknown>;
  if (j.chainId !== c.chainId || typeof j.pool !== "string" || j.pool.toLowerCase() !== c.pool.toLowerCase()) throw new Error("Relay serves another pool or chain");
  if (typeof j.address !== "string" || !isAddress(j.address) || j.address.toLowerCase() === zeroAddress) throw new Error("Invalid relay address");
  if (typeof j.shieldedAddress !== "string") throw new Error("Missing relay payment address");
  decodeAddress(j.shieldedAddress);
  if (typeof j.feeToken !== "string" || j.feeToken.toLowerCase() !== c.token.toLowerCase()) throw new Error("Relay does not quote fees in STELX");
  if (typeof j.fee !== "string" || !/^\d+$/.test(j.fee)) throw new Error("Invalid relay fee");
  const fee = BigInt(j.fee);
  if (fee > c.maxFee) throw new Error("Relay fee exceeds the STELX fee cap");
  return { url, address: j.address as Hex, shieldedAddress: j.shieldedAddress, pool: c.pool, chainId: c.chainId, feeToken: c.token, fee };
}

export async function pickTokenRelay(c: TokenPoolConfig): Promise<TokenRelay> {
  const errors: string[] = [];
  for (const url of c.relays) {
    try {
      const r = await fetch(new URL("/info", url), { signal: AbortSignal.timeout(10_000), cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return parseTokenRelay(await r.json(), url, c);
    } catch (e) { errors.push(`${new URL(url).host}: ${e instanceof Error ? e.message : "unavailable"}`); }
  }
  throw new Error(`No STELX relay available. ${errors.join(". ")}`);
}

export async function tokenWallet(mnemonic: string, c: TokenPoolConfig): Promise<Wallet> {
  const config: WalletConfig = {
    client: tokenPoolClient(c), pool: c.pool, token: c.token, chainId: BigInt(c.chainId),
    deployBlock: c.deployBlock, logChunk: 500_000n,
    broadcaster: zeroAddress, broadcasterAddress: "", fee: 0n,
    artifacts: { wasm: "/pool/transaction.wasm", zkey: "/pool/transaction.zkey", verificationKey: {} },
  };
  return Wallet.create(mnemonic, config);
}

export async function tokenReadiness(c: TokenPoolConfig, account: Address) {
  const client = tokenPoolClient(c);
  const [balance, allowance] = await Promise.all([
    client.readContract({ address: c.token, abi: TOKEN_ABI, functionName: "balanceOf", args: [account] }),
    client.readContract({ address: c.token, abi: TOKEN_ABI, functionName: "allowance", args: [account, c.pool] }),
  ]);
  return { balance, allowance };
}

export async function sendTokenTransaction(c: TokenPoolConfig, provider: EIP1193Provider, account: Address, tx: { to: Address; data: Hex }): Promise<Hex> {
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!accounts.some((a) => a.toLowerCase() === account.toLowerCase())) throw new Error("The connected account changed. Connect your wallet again.");
  const id = `0x${c.chainId.toString(16)}` as Hex;
  if (Number(await provider.request({ method: "eth_chainId" })) !== c.chainId) {
    try { await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: id }] }); }
    catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: id, chainName: c.chainName, nativeCurrency: tokenPoolChain(c).nativeCurrency, rpcUrls: [c.rpc], blockExplorerUrls: [c.explorer] }] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: id }] });
    }
  }
  if (Number(await provider.request({ method: "eth_chainId" })) !== c.chainId) throw new Error("The wallet is still on the wrong chain.");
  await checkTokenPool(c);
  const client = tokenPoolClient(c);
  const gas = await client.estimateGas({ ...tx, account });
  const wallet = createWalletClient({ account, chain: tokenPoolChain(c), transport: custom(provider) });
  const hash = await wallet.sendTransaction({ ...tx, gas: gas * 12n / 10n });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Transaction reverted on chain.");
  return hash;
}

export function tokenApproval(c: TokenPoolConfig, amount: bigint) {
  return { to: c.token, data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "approve", args: [c.pool, amount] }) };
}

export async function tokenInputsSpent(c: TokenPoolConfig, data: Hex, ms = 90_000): Promise<boolean> {
  const decoded = decodeFunctionData({ abi: POOL_ABI, data });
  if (decoded.functionName !== "transact") return false;
  const nullifiers = decoded.args[1].nullifiers;
  const client = tokenPoolClient(c), started = Date.now();
  do {
    try {
      const spent = await Promise.all(nullifiers.map((n) => client.readContract({ address: c.pool, abi: POOL_ABI, functionName: "isNullifierSpent", args: [n] })));
      if (spent.some(Boolean)) {
        const head = await client.getBlockNumber({ cacheTime: 0 });

        const recent = head > 2000n ? head - 2000n : 0n;
        const logs = await client.getLogs({ address: c.pool, fromBlock: recent > c.deployBlock ? recent : c.deployBlock, toBlock: head });
        for (const log of logs) {
          let event;
          try { event = decodeEventLog({ abi: POOL_ABI, data: log.data, topics: log.topics }); }
          catch { continue; }
          if (event.eventName !== "Transact" && event.eventName !== "Exit") continue;
          if (!event.args.nullifiers.some((n) => nullifiers.includes(n)) || !log.transactionHash) continue;
          const tx = await client.getTransaction({ hash: log.transactionHash });
          if (tx.to?.toLowerCase() === c.pool.toLowerCase() && tx.input.toLowerCase() === data.toLowerCase()) return true;
        }
      }
    } catch {  }
    if (Date.now() - started < ms) await new Promise((resolve) => setTimeout(resolve, 2000));
  } while (Date.now() - started < ms);
  return false;
}
