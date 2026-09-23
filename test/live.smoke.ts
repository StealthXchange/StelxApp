// Live smoke run against the deployed testnet pool; spends real test ETH. Usage:
// set -a; . ./.env.testnet; set +a; node test/live.smoke.ts
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Wallet, type WalletConfig } from "../client/src/wallet.ts";
import { keysFromMnemonic, newMnemonic } from "../client/src/keys.ts";
import { shutdownProver } from "../client/src/prover.ts";

const env = (k: string) => process.env[k] ?? (() => { throw new Error(`missing ${k}`); })();
const RPC = env("RPC_URL"), POOL = env("POOL") as Hex, WETH = env("WETH") as Hex;
const CHAIN_ID = Number(env("CHAIN_ID")), DEPLOY_BLOCK = BigInt(env("DEPLOY_BLOCK"));
const KEY = env("DEPLOYER_KEY") as Hex;
const root = fileURLToPath(new URL("..", import.meta.url));

const chain = { id: CHAIN_ID, name: "robinhood-testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pub = createPublicClient({ chain, transport: http(RPC) });
const account = privateKeyToAccount(KEY);
const signer = createWalletClient({ account, chain, transport: http(RPC) });

const WETH_ABI = parseAbi([
  "function deposit() payable",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
  "function allowance(address o, address s) view returns (uint256)",
]);

const AMOUNT = 10n ** 15n;
const FEE = 10n ** 13n;
const explorer = (h: Hex) => `https://explorer.testnet.chain.robinhood.com/tx/${h}`;

async function send(to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const hash = await signer.sendTransaction({ to, data, value });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted: ${explorer(hash)}`);
  return hash;
}

const cfg: WalletConfig = {
  client: pub, pool: POOL, token: WETH, chainId: BigInt(CHAIN_ID), deployBlock: DEPLOY_BLOCK,
  broadcaster: account.address, fee: FEE,
  artifacts: {
    wasm: join(root, "build", "transaction_js", "transaction.wasm"),
    zkey: join(root, "build", "transaction_final.zkey"),
    verificationKey: JSON.parse(readFileSync(join(root, "build", "verification_key.json"), "utf8")),
  },
  logChunk: 5000n,
};

const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);

try {
  const mnemonicA = newMnemonic();
  const mnemonicB = newMnemonic();
  log(`wallet A ${(await keysFromMnemonic(mnemonicA)).address.slice(0, 22)}…`);
  log(`wallet B ${(await keysFromMnemonic(mnemonicB)).address.slice(0, 22)}…`);

  const bal = await pub.readContract({ address: WETH, abi: WETH_ABI, functionName: "balanceOf", args: [account.address] });
  if (bal < AMOUNT) {
    log(`wrapping ${AMOUNT} wei`);
    log(`  ${explorer(await send(WETH, encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" }), AMOUNT - bal))}`);
  }
  const allowance = await pub.readContract({ address: WETH, abi: WETH_ABI, functionName: "allowance", args: [account.address, POOL] });
  if (allowance < AMOUNT) {
    log("approving pool");
    log(`  ${explorer(await send(WETH, encodeFunctionData({ abi: WETH_ABI, functionName: "approve", args: [POOL, AMOUNT * 100n] })))}`);
  }

  const a = await Wallet.create(mnemonicA, cfg);
  const shield = await a.buildShield(WETH, AMOUNT);
  log("shield");
  log(`  ${explorer(await send(shield.to, shield.data))}`);

  const a2 = await Wallet.create(mnemonicA, cfg);
  const s1 = await a2.scan();
  log(`fresh scan: ${s1.leaves} leaves, balance ${await a2.getBalance(WETH)}`);
  if ((await a2.getBalance(WETH)) !== AMOUNT) throw new Error("shield not seen");

  const bAddress = (await keysFromMnemonic(mnemonicB)).address;
  const sendAmount = AMOUNT / 2n;
  const tx = await a2.buildTransfer(bAddress, WETH, sendAmount);
  log("private send");
  log(`  ${explorer(await send(tx.to, tx.data))}`);

  const b = await Wallet.create(mnemonicB, cfg);
  await b.scan();
  log(`B sees ${await b.getBalance(WETH)} (expected ${sendAmount})`);
  if ((await b.getBalance(WETH)) !== sendAmount) throw new Error("recipient did not see funds");

  const fresh = ("0x" + Array.from(crypto.getRandomValues(new Uint8Array(20)), (x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
  const out = sendAmount - FEE;
  const un = await b.buildUnshield(fresh, WETH, out);
  log(`unshield ${out} to ${fresh}`);
  log(`  ${explorer(await send(un.to, un.data))}`);
  const got = await pub.readContract({ address: WETH, abi: WETH_ABI, functionName: "balanceOf", args: [fresh] });
  log(`fresh address holds ${got} (expected ${out})`);
  if (got !== out) throw new Error("unshield amount wrong");

  const a3 = await Wallet.create(mnemonicA, cfg);
  const s3 = await a3.scan();
  log(`A rescan: ${s3.leaves} leaves, balance ${await a3.getBalance(WETH)} (expected ${AMOUNT - sendAmount - FEE})`);

  log("LIVE SMOKE OK");
} finally {
  await shutdownProver();
}
