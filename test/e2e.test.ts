// End-to-end wallet tests against a local Anvil chain.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { BROADCASTER_MNEMONIC, startLocal, E, type Local } from "./helpers/local.ts";
import { Wallet, FEE_BPS, BPS, type WalletConfig } from "../client/src/wallet.ts";
import { keysFromMnemonic, decodeAddress } from "../client/src/keys.ts";
import { shutdownProver } from "../client/src/prover.ts";
import { encryptNote } from "../client/src/crypto.ts";
import { addressToField } from "../client/src/field.ts";
import { prove } from "../client/src/prover.ts";
import { POOL_ABI } from "../client/src/wallet.ts";
import { encodeFunctionData } from "viem";

const MNEMONIC_A = "test test test test test test test test test test test junk";
const MNEMONIC_B = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const MNEMONIC_C = "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";
// Test-only mnemonics for later tests that each need a wallet with no history. Not secret.
const MNEMONIC_D = "skull project forest accuse champion civil fiber jeans punch layer parent rebel";
const MNEMONIC_E = "lady december hello stone recycle gym flip seminar adult fantasy video maid";
const MNEMONIC_F = "give sea apology invest city upgrade warm lady input offer hybrid civil";
const MNEMONIC_G = "valley life rail tonight visit rule want dash analyst bicycle exact bird";
const MNEMONIC_H = "hunt parent month remind bike dad wife bid leave cabin thunder bike";
const FEE = E / 100n;

let local: Local;
let cfg: WalletConfig;
let weth: Hex;
const send = (client: any, tx: { to: Hex; data: Hex }) => local.send(client, tx);
const balanceOf = (a: Hex) => local.balanceOf(a);
let depositor: any;
let broadcaster: any;

before(async () => {
  local = await startLocal(8547, FEE);
  cfg = local.cfg; weth = local.weth; depositor = local.depositor; broadcaster = local.broadcaster;
});

after(async () => {
  await shutdownProver();
  local.stop();
});

let transferCalldata: { to: Hex; data: Hex };
let shielded: bigint;

test("2: shield, then a fresh client with only the seed sees the balance", async () => {
  const a = await Wallet.create(MNEMONIC_A, cfg);
  const built = await a.buildShield(weth, 5n * E);
  shielded = built.net;
  await send(depositor, built);

  const fresh = await Wallet.create(MNEMONIC_A, cfg);
  const r = await fresh.scan();
  assert.equal(r.leaves, 1);
  assert.equal(await fresh.getBalance(weth), shielded);
});

test("3: private send; the recipient scans from a fresh client and sees the funds", async () => {
  const a = await Wallet.create(MNEMONIC_A, cfg);
  await a.scan();
  const bAddress = (await keysFromMnemonic(MNEMONIC_B)).address;
  transferCalldata = await a.buildTransfer(bAddress, weth, 2n * E);

  const feeBefore = await balanceOf(broadcaster.account!.address);
  await send(broadcaster, transferCalldata);
  assert.equal((await balanceOf(broadcaster.account!.address)) - feeBefore, 0n, "relay fee must not leave the pool");

  const relay = await Wallet.create(BROADCASTER_MNEMONIC, cfg);
  await relay.scan();
  assert.equal(await relay.getBalance(weth), FEE, "relay must be paid inside the pool");

  const b = await Wallet.create(MNEMONIC_B, cfg);
  await b.scan();
  assert.equal(await b.getBalance(weth), 2n * E);

  const a2 = await Wallet.create(MNEMONIC_A, cfg);
  await a2.scan();
  assert.equal(await a2.getBalance(weth), shielded - 2n * E - FEE, "sender keeps change minus fee");
});

test("5: replaying the same transaction is rejected", async () => {
  await assert.rejects(send(broadcaster, transferCalldata));
});

test("4: unshield to a fresh public address", async () => {
  const b = await Wallet.create(MNEMONIC_B, cfg);
  await b.scan();
  const fresh = "0x000000000000000000000000000000000000f4e5" as Hex;
  const built = await b.buildUnshield(fresh, weth, 1n * E);
  await send(broadcaster, built);
  const withdrawFee = (1n * E * FEE_BPS) / BPS;
  assert.equal(await balanceOf(fresh), 1n * E - withdrawFee, "recipient gets the net withdrawal");
  const b2 = await Wallet.create(MNEMONIC_B, cfg);
  await b2.scan();
  assert.equal(await b2.getBalance(weth), 2n * E - 1n * E - FEE);
});

test("8: another wallet's viewing key reveals nothing", async () => {
  const c = await Wallet.create(MNEMONIC_C, cfg);
  const r = await c.scan();
  assert.equal(r.leaves, 7, "sees the whole tree: 1 shield + 3 outputs + 3 outputs");
  assert.equal(r.owned, 0, "owns none of it");
  assert.equal(await c.getBalance(weth), 0n);
});

test("9: full rescan from the deployment block reproduces the balance", async () => {
  const a = await Wallet.create(MNEMONIC_A, cfg);
  await a.scan();
  const again = await Wallet.create(MNEMONIC_A, cfg);
  await again.scan();
  assert.equal(await again.getBalance(weth), await a.getBalance(weth));
  assert.deepEqual(again.getHistory(), a.getHistory());
});

test("view-only wallet rebuilds balance and spends from memos alone", async () => {
  const keys = await keysFromMnemonic(MNEMONIC_A);
  const view = await Wallet.createViewOnly(keys.address, keys.viewing.privateKey, cfg);
  await view.scan();
  const full = await Wallet.create(MNEMONIC_A, cfg);
  await full.scan();
  const viewNotes = await view.getNotes();
  const fullNotes = await full.getNotes();
  assert.deepEqual(viewNotes.map((n) => [n.leafIndex, n.value, n.spent]), fullNotes.map((n) => [n.leafIndex, n.value, n.spent]));
  await assert.rejects(view.buildUnshield("0x0000000000000000000000000000000000000001", weth, 1n));
});

test("a hostile note with a value above the circuit range does not break the victim's scan", async () => {
  // The attacker knows only A's address and sends a real transaction whose ciphertext claims a value of 2^127.
  const aKeys = await keysFromMnemonic(MNEMONIC_A);
  const victim = decodeAddress(aKeys.address);
  const attacker = await Wallet.create(MNEMONIC_C, cfg);
  const attackerShield = await attacker.buildShield(weth, 1n * E);
  await send(depositor, attackerShield);
  await attacker.scan();
  const mine = (await attacker.getNotes()).filter((n) => !n.spent);
  const tokenField = addressToField(weth);
  const outToVictim = { publicKey: victim.publicKey, value: attackerShield.net - FEE, blinding: 777n };
  const outChange = { publicKey: attacker.keys.spending.publicKey, value: 0n, blinding: 778n };
  const relayKeys = await keysFromMnemonic(BROADCASTER_MNEMONIC);
  const outFee = { publicKey: relayKeys.spending.publicKey, value: FEE, blinding: 779n };
  const lie = new Uint8Array(69 + 5); lie[0] = 0x01; lie[1] = 0x80; // value = 2^127
  lie.set(new Uint8Array(32), 17);
  let t = tokenField; for (let i = 68; i >= 49; i--) { lie[i] = Number(t & 0xffn); t >>= 8n; }
  const hostile = ("0x" + Array.from(encryptNote(victim.viewingPublic, lie), (x) => x.toString(16).padStart(2, "0")).join("")) as Hex;
  const zero = "0x0000000000000000000000000000000000000000" as Hex;
  const bound = { extAmount: 0n, recipient: zero, broadcaster: cfg.broadcaster, fee: FEE, encryptedNotes: [hostile, "0x00", "0x01"] as Hex[], chainId: cfg.chainId, pool: cfg.pool };
  const proved = await prove({
    spendingKey: attacker.keys.spending.privateKey, token: tokenField,
    leaves: await allLeaves(),
    inputs: [{ value: mine[0].value, blinding: mine[0].blinding, leafIndex: mine[0].leafIndex }],
    outputs: [outToVictim, outChange, outFee], bound,
  }, cfg.artifacts);
  const data = encodeFunctionData({ abi: POOL_ABI, functionName: "transact", args: [proved.proof, {
    root: proved.root, nullifiers: [proved.nullifiers[0], proved.nullifiers[1]], commitments: [proved.commitments[0], proved.commitments[1], proved.commitments[2]],
    extAmount: 0n, recipient: zero, broadcaster: bound.broadcaster, fee: FEE, encryptedNotes: [hostile, "0x00", "0x01"],
    token: proved.publicToken === 0n ? zero : cfg.token, isExit: proved.isExit,
  }] });

  const victimWallet = await Wallet.create(MNEMONIC_A, cfg);
  await victimWallet.scan();
  const before = await victimWallet.getBalance(weth);
  await send(broadcaster, { to: cfg.pool, data });
  await assert.doesNotReject(victimWallet.scan(), "scan survives the hostile note");
  assert.equal(await victimWallet.getBalance(weth), before, "a lying ciphertext is not credited");
});

async function allLeaves(): Promise<bigint[]> {
  const w = await Wallet.create(MNEMONIC_C, cfg);
  await w.scan();
  return Array.from({ length: (w as any).tree.size }, (_, i) => (w as any).tree.leaf(i));
}

// The prover's new root, a fresh scan's root and the contract's root must agree for every transaction shape.
// Four shapes, because the contract branches on isExit and on whether a relay is paid.
test("root invariant: prover, fresh scan and contract agree on every shape", async () => {
  const chainRoot = () => local.pub.readContract({
    address: cfg.pool, abi: POOL_ABI, functionName: "merkleRoot",
  }) as Promise<bigint>;

  const scannedRoot = async (mnemonic: string) => {
    const w = await Wallet.create(mnemonic, cfg);
    await w.scan();
    return w.merkleRoot;
  };

  const check = async (shape: string, built: { newRoot: bigint }, mnemonic: string) => {
    const scanned = await scannedRoot(mnemonic);
    const chain = await chainRoot();
    assert.equal(built.newRoot, chain, `${shape}: the prover's post-transaction root must equal the contract's`);
    assert.equal(scanned, chain, `${shape}: a fresh scan must equal the contract's`);
  };

  // Shape 1: relayed send (fee > 0, isExit = false), three leaves.
  const d = await Wallet.create(MNEMONIC_D, cfg);
  await send(depositor, await d.buildShield(weth, 10n * E));
  await d.scan();
  const relayedSend = await d.buildTransfer(d.getAddress(), weth, 1n * E);
  await send(broadcaster, relayedSend);
  await check("relayed send", relayedSend, MNEMONIC_D);

  // Shape 2: self-submitted send (fee = 0, isExit = false), two leaves.
  const freeCfg: WalletConfig = { ...cfg, fee: 0n };
  const e = await Wallet.create(MNEMONIC_D, freeCfg);
  await e.scan();
  const selfSend = await e.buildTransfer(e.getAddress(), weth, 1n * E);
  await send(depositor, selfSend);
  await check("self-submitted send", selfSend, MNEMONIC_D);

  // Shape 3: relayed exit (fee > 0, isExit = true), one leaf for the fee.
  const f = await Wallet.create(MNEMONIC_E, cfg);
  await send(depositor, await f.buildShield(weth, 3n * E));
  await f.scan();
  const relayedExit = await f.buildExit("0x00000000000000000000000000000000000000e1", weth);
  await send(broadcaster, relayedExit);
  await check("relayed exit", relayedExit, MNEMONIC_E);

  // Shape 4: self-submitted exit (fee = 0, isExit = true), no leaves.
  const g = await Wallet.create(MNEMONIC_F, freeCfg);
  await send(depositor, await g.buildShield(weth, 3n * E));
  await g.scan();
  const selfExit = await g.buildExit("0x00000000000000000000000000000000000000e2", weth);
  await send(depositor, selfExit);
  await check("self-submitted exit", selfExit, MNEMONIC_F);
});

test("a relay's exit fee note is spendable by the relay", async () => {
  const relayBefore = await Wallet.create(BROADCASTER_MNEMONIC, cfg);
  await relayBefore.scan();
  const before = await relayBefore.getBalance(weth);

  const h = await Wallet.create(MNEMONIC_G, cfg);
  await send(depositor, await h.buildShield(weth, 4n * E));
  await h.scan();
  await send(broadcaster, await h.buildExit("0x00000000000000000000000000000000000000e3", weth));

  const relay = await Wallet.create(BROADCASTER_MNEMONIC, cfg);
  await relay.scan();
  const after = await relay.getBalance(weth);
  // Other tests also pay the relay, so assert the delta.
  assert.equal(after - before, FEE, "the relay must be paid its exit fee");
  const notes = (await relay.getNotes()).filter((n) => !n.spent && n.value > 0n);
  assert.ok(notes.length > 0, "the fee note must be in the relay's tree, not just its ciphertext");
});

test("a client can still exit when the tree is completely full", async () => {
  const w = await Wallet.create(MNEMONIC_H, { ...cfg, fee: 0n });
  await send(depositor, await w.buildShield(weth, 2n * E));
  await w.scan();
  // One note, because an exit spends at most N_INS notes.
  assert.equal((await w.getNotes()).filter((n) => !n.spent && n.value > 0n).length, 1);

  // Storage slot of nextLeafIndex, computed as in ShieldedPool.t.sol.
  const depth = await local.pub.readContract({ address: cfg.pool, abi: POOL_ABI, functionName: "TREE_DEPTH" }) as bigint;
  const slot = 1n + depth + (depth + 1n) + 2n;
  const capacity = 1n << depth;
  await local.pub.request({
    method: "anvil_setStorageAt" as any,
    params: [cfg.pool, "0x" + slot.toString(16), "0x" + capacity.toString(16).padStart(64, "0")] as any,
  });

  // The wallet's guard checks its local tree, which predates the fill, so this builds; the chain must reject it.
  const doomed = await w.buildTransfer(w.getAddress(), weth, 1n * E);
  await assert.rejects(send(depositor, doomed), "a value-carrying send must fail at a full tree");

  const exit = await w.buildExit("0x00000000000000000000000000000000000000e4", weth);
  await send(depositor, exit);
  assert.ok(await balanceOf("0x00000000000000000000000000000000000000e4") > 0n,
    "a full tree must still be leavable through the shipped wallet");
});
