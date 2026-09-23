// Two assets in one pool, scanned by the real client: a wallet's tree must match the chain after any deposit.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { Wallet, POOL_ABI, type WalletConfig } from "../client/src/wallet.ts";
import { keysFromMnemonic, newMnemonic } from "../client/src/keys.ts";
import { shutdownProver } from "../client/src/prover.ts";
import { root, nodeArtifacts, DEPOSITOR_KEY, BROADCASTER_KEY, BROADCASTER_MNEMONIC, TREASURY, E } from "./helpers/local.ts";

const PORT = 8561;
const RPC = `http://127.0.0.1:${PORT}`;
const ERC20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const artifact = (p: string) => JSON.parse(readFileSync(join(root, "out", p), "utf8"));

let anvil: ChildProcess;
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const depositor = createWalletClient({ account: privateKeyToAccount(DEPOSITOR_KEY), chain: foundry, transport: http(RPC) });
let pool: Hex, tokenA: Hex, tokenB: Hex, deployBlock: bigint, relayAddress: string;

async function send(to: Hex, data: Hex) {
  const hash = await depositor.sendTransaction({ to, data, chain: foundry, account: depositor.account! });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success");
}
async function deploy(abi: any, bytecode: Hex, args: any[] = []) {
  const hash = await depositor.deployContract({ abi, bytecode, args, chain: foundry, account: depositor.account! });
  const r = await pub.waitForTransactionReceipt({ hash });
  return { address: r.contractAddress as Hex, block: r.blockNumber };
}
const cfg = (token: Hex): WalletConfig => ({
  client: pub as any, pool, token, chainId: BigInt(foundry.id), deployBlock,
  broadcaster: privateKeyToAccount(BROADCASTER_KEY).address, broadcasterAddress: relayAddress, fee: 0n,
  artifacts: nodeArtifacts(),
});
const chainRoot = () => pub.readContract({ address: pool, abi: POOL_ABI, functionName: "merkleRoot" }) as Promise<bigint>;

before(async () => {
  const exe = process.platform === "win32" ? "anvil.exe" : "anvil";
  const bundled = join(homedir(), ".foundry", "bin", exe);
  anvil = spawn(existsSync(bundled) ? bundled : exe, ["-p", String(PORT), "--silent"], { stdio: "ignore" });
  for (let i = 0; ; i++) { try { await pub.getChainId(); break; } catch { if (i > 100) throw new Error("anvil"); await new Promise((r) => setTimeout(r, 200)); } }

  const t3 = ("0x" + readFileSync(join(root, "build", "PoseidonT3.bin"), "utf8").trim()) as Hex;
  const t5 = ("0x" + readFileSync(join(root, "build", "PoseidonT5.bin"), "utf8").trim()) as Hex;
  const h2 = await deploy([], t3), h4 = await deploy([], t5);
  const v = artifact("TransactionVerifier.sol/Groth16Verifier.json");
  const verifier = await deploy(v.abi, v.bytecode.object);
  const w = artifact("ShieldedPool.t.sol/MockWETH.json");
  tokenA = (await deploy(w.abi, w.bytecode.object)).address;
  tokenB = (await deploy(w.abi, w.bytecode.object)).address;
  const p = artifact("ShieldedPool.sol/ShieldedPool.json");
  const d = await deploy(p.abi, p.bytecode.object, [[tokenA, tokenB], h2.address, h4.address, verifier.address, TREASURY]);
  pool = d.address; deployBlock = d.block;
  relayAddress = (await keysFromMnemonic(BROADCASTER_MNEMONIC)).address;
  for (const t of [tokenA, tokenB]) {
    await send(t, encodeFunctionData({ abi: ERC20, functionName: "mint", args: [depositor.account!.address, 100n * E] }));
    await send(t, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [pool, 2n ** 255n] }));
  }
});

after(async () => { await shutdownProver(); anvil?.kill(); });

test("a wallet's tree matches the chain after a deposit in its own asset", async () => {
  const a = await Wallet.create(newMnemonic(), cfg(tokenA));
  const s = await a.buildShield(tokenA, E);
  await send(s.to, s.data);
  const fresh = await Wallet.create(newMnemonic(), cfg(tokenA));
  await fresh.scan();
  assert.equal(fresh.merkleRoot, await chainRoot(), "one-asset case: roots must agree");
});

test("a wallet's tree still matches the chain after SOMEONE ELSE deposits a different asset", async () => {
  const b = await Wallet.create(newMnemonic(), cfg(tokenB));
  const s = await b.buildShield(tokenB, E);
  await send(s.to, s.data);

  const watcherA = await Wallet.create(newMnemonic(), cfg(tokenA));
  await watcherA.scan();
  assert.equal(watcherA.merkleRoot, await chainRoot(),
    "a token-A wallet rebuilt someone's token-B deposit as token A: its tree no longer matches the chain");
});

test("the token-B depositor's own wallet sees its deposit and its tree matches", async () => {
  const m = newMnemonic();
  const b = await Wallet.create(m, cfg(tokenB));
  const s = await b.buildShield(tokenB, 2n * E);
  await send(s.to, s.data);
  const again = await Wallet.create(m, cfg(tokenB));
  await again.scan();
  assert.equal(again.merkleRoot, await chainRoot(), "token-B wallet's tree must match the chain");
});

test("a token-A wallet does not count someone's token-B deposit as its balance", async () => {
  const m = newMnemonic();
  const a = await Wallet.create(m, cfg(tokenA));
  await a.scan();
  assert.equal(await a.getBalance(tokenA), 0n, "a fresh token-A wallet must hold nothing");
});

test("one person holding two assets sees each balance only under its own asset", async () => {
  const m = newMnemonic();
  const asA = await Wallet.create(m, cfg(tokenA));
  const asB = await Wallet.create(m, cfg(tokenB));
  const sa = await asA.buildShield(tokenA, 3n * E);
  await send(sa.to, sa.data);
  const sb = await asB.buildShield(tokenB, 5n * E);
  await send(sb.to, sb.data);

  const viewA = await Wallet.create(m, cfg(tokenA));
  const viewB = await Wallet.create(m, cfg(tokenB));
  await viewA.scan(); await viewB.scan();
  const net = (x: bigint) => x - (x * 10n) / 10_000n;
  assert.equal(await viewA.getBalance(tokenA), net(3n * E), "token-A balance must be only the token-A deposit");
  assert.equal(await viewB.getBalance(tokenB), net(5n * E), "token-B balance must be only the token-B deposit");
});

// End-to-end spends with real proofs and the ceremony verifier, in a pool holding both assets.
const relay = createWalletClient({ account: privateKeyToAccount(BROADCASTER_KEY), chain: foundry, transport: http(RPC) });
async function submit(tx: { to: Hex; data: Hex }) {
  const hash = await relay.sendTransaction({ to: tx.to, data: tx.data, chain: foundry, account: relay.account! });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success", "transaction reverted");
}

test("in a pool holding both assets, a token-A wallet can send privately", async () => {
  const m = newMnemonic();
  const a = await Wallet.create(m, cfg(tokenA));
  const s = await a.buildShield(tokenA, E);
  await send(s.to, s.data);
  // A deposit in the other asset lands in between.
  const other = await Wallet.create(newMnemonic(), cfg(tokenB));
  const ob = await other.buildShield(tokenB, E);
  await send(ob.to, ob.data);

  const sender = await Wallet.create(m, cfg(tokenA));
  await sender.scan();
  const recipient = newMnemonic();
  const tx = await sender.buildTransfer((await keysFromMnemonic(recipient)).address, tokenA, E / 4n);
  await submit(tx);
  const r = await Wallet.create(recipient, cfg(tokenA));
  await r.scan();
  assert.equal(await r.getBalance(tokenA), E / 4n, "recipient must hold exactly what was sent");
  assert.equal(r.merkleRoot, await chainRoot(), "recipient's tree must match the chain");
});

test("in a pool holding both assets, a token-B wallet can withdraw token B", async () => {
  const m = newMnemonic();
  const b = await Wallet.create(m, cfg(tokenB));
  const s = await b.buildShield(tokenB, 2n * E);
  await send(s.to, s.data);
  const w = await Wallet.create(m, cfg(tokenB));
  await w.scan();
  const to = ("0x" + "b0".repeat(20)) as Hex;
  const un = await w.buildUnshield(to, tokenB, E);
  await submit(un);
  const bal = await pub.readContract({ address: tokenB, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [to] });
  assert.equal(bal, E - E * 10n / 10_000n, "recipient gets token B less the protocol fee");
  const tokenABal = await pub.readContract({ address: tokenA, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [to] });
  assert.equal(tokenABal, 0n, "and no token A");
});
