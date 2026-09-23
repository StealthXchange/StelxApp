// Live run against a deployed pool and its public broadcaster: shield, restore, send and withdraw via the relay. Usage:
// set -a; . ./.env.testnet; set +a; POOL=0x... DEPLOY_BLOCK=... BROADCASTER_URL=https://bc.example node test/live.relay.smoke.ts
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet, type WalletConfig } from "../client/src/wallet.ts";
import { keysFromMnemonic, newMnemonic } from "../client/src/keys.ts";
import { fetchBroadcasterInfo, submitViaBroadcaster, waitForBroadcast } from "../client/src/broadcast.ts";
import { shutdownProver } from "../client/src/prover.ts";

const env = (k: string) => process.env[k] ?? (() => { throw new Error(`missing ${k}`); })();
const RPC = env("RPC_URL"), POOL = env("POOL") as Hex, WETH = env("WETH") as Hex;
const CHAIN_ID = Number(env("CHAIN_ID")), DEPLOY_BLOCK = BigInt(env("DEPLOY_BLOCK"));
const KEY = env("DEPLOYER_KEY") as Hex;
const RELAY = env("BROADCASTER_URL");
const root = fileURLToPath(new URL("..", import.meta.url));

const chain = { id: CHAIN_ID, name: `chain-${CHAIN_ID}`, nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pub = createPublicClient({ chain, transport: http(RPC) });
const account = privateKeyToAccount(KEY);
const signer = createWalletClient({ account, chain, transport: http(RPC) });

const WETH_ABI = parseAbi([
  "function deposit() payable",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
  "function allowance(address o, address s) view returns (uint256)",
]);
const POOL_ABI = parseAbi(["function FEE_BPS() view returns (uint256)"]);

const AMOUNT = 10n ** 15n;
const explorer = (h: Hex) => `${chain.id === 4663 ? "https://robinhoodchain.blockscout.com" : "https://explorer.testnet.chain.robinhood.com"}/tx/${h}`;

async function send(to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const hash = await signer.sendTransaction({ to, data, value });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted: ${explorer(hash)}`);
  return hash;
}

const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
let failed = false;
const check = (label: string, ok: boolean, detail: string) => { log(`${ok ? "ok  " : "FAIL"} ${label}  ${detail}`); if (!ok) failed = true; };

try {
  const relay = await fetchBroadcasterInfo(RELAY);
  log(`relay ${relay.address} fee ${relay.fee} pool ${relay.pool}`);
  check("relay serves this pool", relay.pool.toLowerCase() === POOL.toLowerCase(), relay.pool);

  const bps = await pub.readContract({ address: POOL, abi: POOL_ABI, functionName: "FEE_BPS" });
  const cut = (x: bigint) => (x * bps) / 10_000n;

  const cfg = (): WalletConfig => ({
    client: pub, pool: POOL, token: WETH, chainId: BigInt(CHAIN_ID), deployBlock: DEPLOY_BLOCK,
    broadcaster: relay.address, broadcasterAddress: relay.shieldedAddress, fee: relay.fee,
    artifacts: {
      wasm: join(root, "build", "transaction_js", "transaction.wasm"),
      zkey: join(root, "build", "transaction_final.zkey"),
      verificationKey: JSON.parse(readFileSync(join(root, "build", "verification_key.json"), "utf8")),
    },
    logChunk: 5000n,
  } as WalletConfig);

  const mnemonicA = newMnemonic(), mnemonicB = newMnemonic();

  const bal = await pub.readContract({ address: WETH, abi: WETH_ABI, functionName: "balanceOf", args: [account.address] });
  if (bal < AMOUNT) { log("wrap"); log(`  ${explorer(await send(WETH, encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" }), AMOUNT - bal))}`); }
  const allowance = await pub.readContract({ address: WETH, abi: WETH_ABI, functionName: "allowance", args: [account.address, POOL] });
  if (allowance < AMOUNT) { log("approve"); log(`  ${explorer(await send(WETH, encodeFunctionData({ abi: WETH_ABI, functionName: "approve", args: [POOL, AMOUNT * 100n] })))}`); }
  const a = await Wallet.create(mnemonicA, cfg());
  const shield = await a.buildShield(WETH, AMOUNT);
  log("shield"); log(`  ${explorer(await send(shield.to, shield.data))}`);
  const net = AMOUNT - cut(AMOUNT);

  const a2 = await Wallet.create(mnemonicA, cfg());
  await a2.scan();
  check("restore from phrase finds the deposit", (await a2.getBalance(WETH)) === net, `${await a2.getBalance(WETH)} (expected ${net})`);

  const bAddr = (await keysFromMnemonic(mnemonicB)).address;
  const sendAmt = net / 2n;
  const tx = await a2.buildTransfer(bAddr, WETH, sendAmt);
  log("private send via relay");
  const h1 = await submitViaBroadcaster(relay, tx);
  const s1 = await waitForBroadcast(relay, h1, 120_000);
  log(`  ${explorer(h1)} ${s1}`);
  check("private send confirmed", s1 === "success", s1);

  const b = await Wallet.create(mnemonicB, cfg());
  await b.scan();
  check("recipient sees the send", (await b.getBalance(WETH)) === sendAmt, `${await b.getBalance(WETH)} (expected ${sendAmt})`);

  const fresh = ("0x" + Array.from(crypto.getRandomValues(new Uint8Array(20)), (x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
  const out = sendAmt - relay.fee;
  const un = await b.buildUnshield(fresh, WETH, out);
  log(`withdraw ${out} to ${fresh} via relay`);
  const h2 = await submitViaBroadcaster(relay, un);
  const s2 = await waitForBroadcast(relay, h2, 120_000);
  log(`  ${explorer(h2)} ${s2}`);
  check("withdraw confirmed", s2 === "success", s2);
  const got = await pub.readContract({ address: WETH, abi: WETH_ABI, functionName: "balanceOf", args: [fresh] });
  check("fresh address received the withdrawal less the protocol fee", got === out - cut(out), `${got} (expected ${out - cut(out)})`);

  const b2 = await Wallet.create(mnemonicB, cfg());
  await b2.scan();
  let refused = false;
  try { await b2.buildTransfer(bAddr, WETH, net * 10n); } catch { refused = true; }
  check("a send larger than the balance is refused before proving", refused, refused ? "refused" : "BUILT");

  log(failed ? "LIVE RELAY SMOKE FAILED" : "LIVE RELAY SMOKE OK");
} finally {
  await shutdownProver();
}
process.exit(failed ? 1 : 0);
