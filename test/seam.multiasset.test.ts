// Contract and scanner agreement in a multi-asset pool, on local Anvil with real proofs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, hexToBytes, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import type { WalletConfig } from "../client/src/wallet.ts";
// SEAM_WALLET can point at an alternative wallet.ts; unset, the shipped client runs.
const { Wallet, POOL_ABI, FEE_BPS, BPS, encodeSpentMemo } = await import(process.env.SEAM_WALLET ?? "../client/src/wallet.ts");
type Wallet = InstanceType<typeof Wallet>;
import { keysFromMnemonic, newMnemonic, decodeAddress } from "../client/src/keys.ts";
import { nullifierOf, randomBlinding } from "../client/src/note.ts";
import { encodePlaintext, encryptNote } from "../client/src/crypto.ts";
import { addressToField, bytes32ToField } from "../client/src/field.ts";
import { shutdownProver } from "../client/src/prover.ts";
import { createBroadcaster } from "../broadcaster/server.ts";
import { root, nodeArtifacts, DEPOSITOR_KEY, BROADCASTER_KEY, BROADCASTER_MNEMONIC, TREASURY, E } from "./helpers/local.ts";

const PORT = 8573;
const RPC = `http://127.0.0.1:${PORT}`;
const ERC20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const OUT = "0x00000000000000000000000000000000000000b1" as Hex;
const artifact = (p: string) => JSON.parse(readFileSync(join(root, "out", p), "utf8"));
const EVENTS = POOL_ABI.filter((x: any) => x.type === "event") as any;
const SHIELD_EVENT = POOL_ABI.find((x: any) => x.type === "event" && x.name === "Shield") as any;

let anvil: ChildProcess;
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const depositor = createWalletClient({ account: privateKeyToAccount(DEPOSITOR_KEY), chain: foundry, transport: http(RPC) });
const relayEoa = createWalletClient({ account: privateKeyToAccount(BROADCASTER_KEY), chain: foundry, transport: http(RPC) });
let pool: Hex, tokenA: Hex, tokenB: Hex, usdg: Hex, deployBlock: bigint, relayAddress: string;

const net = (x: bigint) => x - (x * FEE_BPS) / BPS;
async function sendAs(c: any, to: Hex, data: Hex) {
  const hash = await c.sendTransaction({ to, data, chain: foundry, account: c.account! });
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, "success", "transaction reverted");
  return r;
}
const deposit = (tx: { to: Hex; data: Hex }) => sendAs(depositor, tx.to, tx.data);
const submit = (tx: { to: Hex; data: Hex }) => sendAs(relayEoa, tx.to, tx.data);
async function deploy(abi: any, bytecode: Hex, args: any[] = []) {
  const hash = await depositor.deployContract({ abi, bytecode, args, chain: foundry, account: depositor.account! });
  const r = await pub.waitForTransactionReceipt({ hash });
  return { address: r.contractAddress as Hex, block: r.blockNumber };
}
const cfg = (token: Hex, fee = 0n, extra: Partial<WalletConfig> = {}): WalletConfig => ({
  client: pub as any, pool, token, chainId: BigInt(foundry.id), deployBlock,
  broadcaster: privateKeyToAccount(BROADCASTER_KEY).address, broadcasterAddress: relayAddress, fee,
  artifacts: nodeArtifacts(), ...extra,
});
const chainRoot = () => pub.readContract({ address: pool, abi: POOL_ABI, functionName: "merkleRoot" }) as Promise<bigint>;
const isSpent = (nf: bigint) => pub.readContract({ address: pool, abi: POOL_ABI, functionName: "isNullifierSpent", args: [nf] }) as Promise<boolean>;
async function fresh(m: string, token: Hex, fee = 0n) { const w = await Wallet.create(m, cfg(token, fee)); await w.scan(); return w; }
async function shieldTo(m: string, token: Hex, amount: bigint) {
  const w = await Wallet.create(m, cfg(token));
  const s = await w.buildShield(token, amount);
  return deposit(s);
}
const addr = async (m: string) => (await keysFromMnemonic(m)).address;
const noteView = async (w: Wallet) => (await w.getNotes()).map((n) => [n.leafIndex, n.value, n.spent]);

// A valid transact from `x` whose output plaintexts, memos included, are chosen by the caller.
type Out = { to: string; value: bigint; memo: number[] };
async function craft(x: Wallet, token: Hex, outs: (sumIn: bigint) => [Out, Out, Out]) {
  const inputs = (await x.getNotes()).filter((n) => !n.spent && n.value > 0n).slice(0, 2);
  const sumIn = inputs.reduce((s, n) => s + n.value, 0n);
  const tf = addressToField(token);
  const o = outs(sumIn).map((d) => {
    const a = decodeAddress(d.to);
    return { a, note: { publicKey: a.publicKey, value: d.value, blinding: randomBlinding() }, memo: d.memo };
  });
  const cts = o.map((e) => encryptNote(e.a.viewingPublic, encodePlaintext({ ...e.note, token: tf, memo: encodeSpentMemo(e.memo) })));
  // buildTransact is TS-private only; it is the wallet's own proving path.
  return (x as any).buildTransact(inputs, o.map((e) => e.note), cts, { extAmount: 0n, recipient: ZERO }, "crafted") as Promise<{ to: Hex; data: Hex }>;
}

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
  const u = artifact("ShieldedPool.t.sol/MockUSDG.json");
  tokenA = (await deploy(w.abi, w.bytecode.object)).address;
  tokenB = (await deploy(w.abi, w.bytecode.object)).address;
  usdg = (await deploy(u.abi, u.bytecode.object)).address;
  const p = artifact("ShieldedPool.sol/ShieldedPool.json");
  const d = await deploy(p.abi, p.bytecode.object, [[tokenA, tokenB, usdg], h2.address, h4.address, verifier.address, TREASURY]);
  pool = d.address; deployBlock = d.block;
  relayAddress = (await keysFromMnemonic(BROADCASTER_MNEMONIC)).address;
  for (const t of [tokenA, tokenB, usdg]) {
    await sendAs(depositor, t, encodeFunctionData({ abi: ERC20, functionName: "mint", args: [depositor.account!.address, 1000n * E] }));
    await sendAs(depositor, t, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [pool, 2n ** 255n] }));
  }
});

after(async () => { await shutdownProver(); anvil?.kill(); });

test("CONTROL: two assets interleaved, relay paid in each, 2- and 3-leaf transacts, exit in A while B is held", async () => {
  const P = newMnemonic(), Q = newMnemonic(), S = newMnemonic();
  const FA = E / 100n, FB = E / 50n;
  const incPA = await Wallet.create(P, cfg(tokenA, FA));
  const incPB = await Wallet.create(P, cfg(tokenB, FB));
  const incRA = await Wallet.create(BROADCASTER_MNEMONIC, cfg(tokenA));
  const incRB = await Wallet.create(BROADCASTER_MNEMONIC, cfg(tokenB));
  const step = async (label: string) => {
    const r = await chainRoot();
    for (const w of [incPA, incPB, incRA, incRB]) { await w.scan(); assert.equal(w.merkleRoot, r, `${label}: incremental root`); }
  };
  const relayABefore = await (await fresh(BROADCASTER_MNEMONIC, tokenA)).getBalance(tokenA);
  const relayBBefore = await (await fresh(BROADCASTER_MNEMONIC, tokenB)).getBalance(tokenB);

  await shieldTo(P, tokenA, 3n * E); await shieldTo(S, tokenA, E); await shieldTo(P, tokenB, 5n * E);
  await step("deposits");
  await submit(await incPA.buildTransfer(await addr(Q), tokenA, E));
  await step("A relayed send");
  await submit(await incPB.buildUnshield(OUT, tokenB, E));
  await step("B relayed unshield");
  const pB0 = await fresh(P, tokenB, 0n);
  await submit(await pB0.buildTransfer(await addr(Q), tokenB, E / 2n));
  await step("B fee-free send");
  await submit(await incPA.buildExit(OUT, tokenA));
  await step("A relayed exit");

  const expect: [string, Hex, bigint][] = [
    [P, tokenA, 0n],
    [P, tokenB, net(5n * E) - E - FB - E / 2n],
    [Q, tokenA, E], [Q, tokenB, E / 2n],
    [S, tokenA, net(E)], [S, tokenB, 0n],
    [BROADCASTER_MNEMONIC, tokenA, relayABefore + 2n * FA],
    [BROADCASTER_MNEMONIC, tokenB, relayBBefore + FB],
  ];
  for (const [m, t, bal] of expect) {
    const w = await fresh(m, t);
    assert.equal(w.merkleRoot, await chainRoot(), "fresh root");
    assert.equal(await w.getBalance(t), bal, `balance ${t === tokenA ? "A" : "B"}`);
    const k = await keysFromMnemonic(m);
    for (const n of await w.getNotes()) assert.equal(n.spent, await isSpent(await nullifierOf(k.spending.privateKey, n.leafIndex)), `leaf ${n.leafIndex} spent flag`);
  }
  assert.deepEqual(await noteView(incPA), await noteView(await fresh(P, tokenA)));
  assert.deepEqual(await noteView(incPB), await noteView(await fresh(P, tokenB)));
  assert.deepEqual(await noteView(incRA), await noteView(await fresh(BROADCASTER_MNEMONIC, tokenA)));
  const kP = await keysFromMnemonic(P);
  const vB = await Wallet.createViewOnly(kP.address, kP.viewing.privateKey, cfg(tokenB)); await vB.scan();
  assert.deepEqual(await noteView(vB), await noteView(await fresh(P, tokenB)), "view-only B == spending B");

  await submit(await (await fresh(P, tokenB)).buildUnshield(OUT, tokenB, E / 4n));
  const rA = await fresh(BROADCASTER_MNEMONIC, tokenA);
  await submit(await rA.buildTransfer(await addr(Q), tokenA, 2n * FA));
  assert.equal(await (await fresh(Q, tokenA)).getBalance(tokenA), E + 2n * FA);
  assert.equal((await fresh(S, tokenB)).merkleRoot, await chainRoot());
});

let f1: { V: string; leaf: number } | undefined;

test("FINDING 1: a stranger's spent-memo freezes a SPENDING wallet's deposit (asset B)", async () => {
  const V = newMnemonic();
  const vAddr = await addr(V);
  await shieldTo(V, tokenB, 2n * E);

  // Shield events publish the owner key and token, so V's address is enough to find V's leaves.
  const vPk = decodeAddress(vAddr).publicKey;
  const logs = await pub.getLogs({ address: pool, event: SHIELD_EVENT, fromBlock: deployBlock }) as any[];
  const victimLeaves = logs
    .filter((l) => bytes32ToField(hexToBytes(l.args.encryptedNote).slice(0, 32)) === vPk && l.args.token.toLowerCase() === tokenB.toLowerCase())
    .map((l) => Number(l.args.leafIndex));
  assert.equal(victimLeaves.length, 1);

  // Any funded wallet sends V a zero-value note whose memo names V's leaf.
  const X = newMnemonic();
  await shieldTo(X, tokenB, E);
  const x = await fresh(X, tokenB);
  await submit(await craft(x, tokenB, (sumIn) => [
    { to: vAddr, value: 0n, memo: victimLeaves },
    { to: x.getAddress(), value: sumIn, memo: [] },
    { to: relayAddress, value: 0n, memo: [] },
  ]));

  f1 = { V, leaf: victimLeaves[0] };
  const kV = await keysFromMnemonic(V);
  const v = await fresh(V, tokenB);
  const got = {
    rootMatchesChain: v.merkleRoot === await chainRoot(),
    chainSaysUnspent: !(await isSpent(await nullifierOf(kV.spending.privateKey, victimLeaves[0]))),
    walletBalance: await v.getBalance(tokenB),
    canSpend: await v.buildUnshield(OUT, tokenB, E).then(() => true, (e) => `rejected: ${e.message}`),
  };
  assert.deepEqual(got, { rootMatchesChain: true, chainSaysUnspent: true, walletBalance: net(2n * E), canSpend: true },
    "V's note is unspent on chain, but V's own spending wallet hides it and refuses to spend");
});

test("FINDING 1c (residual after the spending-wallet fix): the same forged memo hides the note from a VIEW-ONLY wallet", { todo: "view-only memos need authenticating (tagged memo); known limitation, stated in the README" }, async () => {
  assert.ok(f1, "needs FINDING 1's forged memo on chain");
  const k = await keysFromMnemonic(f1.V);
  const view = await Wallet.createViewOnly(k.address, k.viewing.privateKey, cfg(tokenB)); await view.scan();
  assert.equal(await isSpent(await nullifierOf(k.spending.privateKey, f1.leaf)), false, "chain: unspent");
  assert.equal(await view.getBalance(tokenB), net(2n * E), "a view-only wallet must not be told by a stranger that the note is spent");
});

test("FINDING 1b: a paying user freezes the RELAY's earned fee notes through the fee note's memo (asset A)", async () => {
  const FA = E / 100n;
  const U = newMnemonic();
  await shieldTo(U, tokenA, 2n * E);
  await submit(await (await fresh(U, tokenA, FA)).buildTransfer(await addr(U), tokenA, E / 10n));

  // Fee leaves are public: the third leaf of every 3-commitment Transact, and every ExitFee.
  const logs = (await pub.getLogs({ address: pool, events: EVENTS, fromBlock: deployBlock }) as any[])
    .sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : (a.blockNumber < b.blockNumber ? -1 : 1));
  const feeLeaves: number[] = []; let n = 0;
  for (const l of logs) {
    if (l.eventName === "Shield") n += 1;
    else if (l.eventName === "ExitFee") feeLeaves.push(n++);
    else if (l.eventName === "Transact") { if (l.args.commitments.length === 3) feeLeaves.push(n + 2); n += l.args.commitments.length; }
  }
  const targets = feeLeaves.slice(-2);

  const relayBefore = await (await fresh(BROADCASTER_MNEMONIC, tokenA)).getBalance(tokenA);

  // The attacker pays a genuine fee. Only the memo inside the relay's own fee note is hostile.
  const X = newMnemonic();
  await shieldTo(X, tokenA, E);
  const x = await fresh(X, tokenA, FA);
  await submit(await craft(x, tokenA, (sumIn) => [
    { to: x.getAddress(), value: sumIn - FA, memo: [] },
    { to: x.getAddress(), value: 0n, memo: [] },
    { to: relayAddress, value: FA, memo: targets },
  ]));

  const relay = await fresh(BROADCASTER_MNEMONIC, tokenA);
  assert.equal(relay.merkleRoot, await chainRoot());
  assert.equal(await relay.getBalance(tokenA), relayBefore + FA,
    "the relay was paid one more fee; it must hold every fee note it has not spent");
});

let exitCtx: { W: string; exitBlock: bigint } | undefined;

test("FINDING 2: a view-only wallet never learns of an exit (A exited, B still held)", { todo: "Exit must carry the ciphertexts for view-only wallets (contract change); known limitation, stated in the README" }, async () => {
  const FA = E / 100n;
  const W = newMnemonic();
  await shieldTo(W, tokenA, 2n * E); await shieldTo(W, tokenB, E);
  const wA = await fresh(W, tokenA, FA);
  const r = await submit(await wA.buildExit(OUT, tokenA));
  exitCtx = { W, exitBlock: r.blockNumber };

  const kW = await keysFromMnemonic(W);
  const full = await fresh(W, tokenA);
  assert.equal(await full.getBalance(tokenA), 0n, "spending wallet: exited, nothing left");
  const viewA = await Wallet.createViewOnly(kW.address, kW.viewing.privateKey, cfg(tokenA)); await viewA.scan();
  const viewB = await Wallet.createViewOnly(kW.address, kW.viewing.privateKey, cfg(tokenB)); await viewB.scan();
  assert.equal(await viewB.getBalance(tokenB), net(E), "view-only B is fine");
  assert.equal(viewA.merkleRoot, await chainRoot());
  assert.deepEqual(await noteView(viewA), await noteView(full), "view-only A must agree with the spending wallet after an exit");
});

test("FINDING 3 (low): history records a spend at the SCAN height, so fresh and incremental histories differ", async () => {
  assert.ok(exitCtx, "needs FINDING 2's exit");
  await pub.request({ method: "anvil_mine", params: ["0x5"] } as any);
  const h = (await fresh(exitCtx.W, tokenA)).getHistory().filter((e) => e.kind === "spent");
  assert.deepEqual(h.map((e) => e.blockNumber), [exitCtx.exitBlock],
    "the exit's spend must be dated to the exit's block, not to whenever the wallet happened to scan");
});

test("FINDING 4: a chunked scan interrupted by one transient RPC error corrupts the wallet on retry", async () => {
  // The first chunk must contain pool events; make it end at the first Shield.
  const first = (await pub.getLogs({ address: pool, event: SHIELD_EVENT, fromBlock: deployBlock }) as any[])[0];
  const chunk = first.blockNumber - deployBlock + 1n;
  let calls = 0;
  const flaky = new Proxy(pub as any, {
    get(t, p) {
      if (p === "getLogs") return async (args: any) => { if (++calls === 2) throw new Error("fetch failed: ECONNRESET"); return t.getLogs(args); };
      const v = t[p]; return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const w = await Wallet.create(newMnemonic(), cfg(tokenA, 0n, { client: flaky, logChunk: chunk }));
  await assert.rejects(w.scan(), /ECONNRESET/, "the transient error surfaces");
  await assert.doesNotReject(w.scan(), "retry after a transient RPC error");
  assert.equal(w.merkleRoot, await chainRoot());
});

test("FINDING 4b: two overlapping scan() calls on one wallet double-insert every leaf", async () => {
  const w = await Wallet.create(newMnemonic(), cfg(tokenA));
  const results = await Promise.allSettled([w.scan(), w.scan()]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"],
    `concurrent scans: ${results.map((r) => r.status === "rejected" ? (r.reason as Error).message.slice(0, 80) : "ok").join(" | ")}`);
  await assert.doesNotReject(w.scan(), "and the wallet must still scan afterwards");
});

test("FINDING 5: the relay accepts its fee integer in ANY asset (priced in USDG units, paid in WETH wei)", { todo: "per-asset relay fees: clients pass one constant non-zero fee in calldata as a flag (fee is public and bound in boundParamsHash); the relay checks the real amount and asset only by decrypting its note" }, async () => {
  // The relay operator prices in the stablecoin: 0.10 USDG = 100,000 base units.
  const FEE = 100_000n;
  const server = createBroadcaster({ rpcUrl: RPC, chainId: foundry.id, pool, privateKey: BROADCASTER_KEY, fee: FEE, mnemonic: BROADCASTER_MNEMONIC, port: 0 });
  const port = await server.listen();
  try {
    const M = newMnemonic();
    await shieldTo(M, tokenA, E);
    const w = await fresh(M, tokenA, FEE);
    const tx = await w.buildTransfer(await addr(newMnemonic()), tokenA, E / 10n);
    const res = await fetch(`http://127.0.0.1:${port}/transact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: tx.to, data: tx.data }) });
    const body = await res.json();
    if (res.status === 202) await pub.waitForTransactionReceipt({ hash: body.hash });
    assert.notEqual(res.status, 202,
      "a fee of 100,000 base units of USDG (0.10 USD) was accepted as 100,000 wei of WETH (~1e-13 ETH): 10^12 underpaid");
  } finally { await server.close(); }
});

// Runs last: this test rewrites chain history.
test("FINDING 6: equal-count divergence passes the scanner's only self-check (reorg shape)", async () => {
  const snap = await pub.request({ method: "evm_snapshot" } as any);
  const A1 = newMnemonic();
  await shieldTo(A1, tokenA, E);
  const a = await fresh(A1, tokenA);
  assert.equal(await a.getBalance(tokenA), net(E));
  // Replace the deposit with a different one at the same leaf index, so the leaf count is unchanged.
  await pub.request({ method: "evm_revert", params: [snap] } as any);
  await shieldTo(newMnemonic(), tokenB, E);
  let threw: string | null = null;
  try { await a.scan(); } catch (e: any) { threw = e.message; }
  const rootMatchesChain = a.merkleRoot === await chainRoot();
  const phantom = await a.getBalance(tokenA);
  assert.ok(threw !== null || rootMatchesChain,
    `scan() returned normally; wallet root != chain root; balance ${phantom} from a deposit that is not on chain`);
  if (threw !== null) {
    await a.scan();
    assert.equal(a.merkleRoot, await chainRoot(), "after refusing, the next scan converges");
    assert.equal(await a.getBalance(tokenA), 0n, "and the vanished deposit is gone");
  }
});
