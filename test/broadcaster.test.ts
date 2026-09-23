// Broadcaster on a local chain: discovery, submission, and refusal of transactions that would waste its gas.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Hex } from "viem";
import { BROADCASTER_MNEMONIC, startLocal, BROADCASTER_KEY, E, type Local } from "./helpers/local.ts";
import { Wallet } from "../client/src/wallet.ts";
import { keysFromMnemonic } from "../client/src/keys.ts";
import { shutdownProver } from "../client/src/prover.ts";
import { createBroadcaster } from "../broadcaster/server.ts";
import { fetchBroadcasterInfo, pickBroadcaster, submitViaBroadcaster, waitForBroadcast, type BroadcasterInfo } from "../client/src/broadcast.ts";

const MNEMONIC_A = "test test test test test test test test test test test junk";
const MNEMONIC_B = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const FEE = E / 100n;

let local: Local;
let server: ReturnType<typeof createBroadcaster>;
let info: BroadcasterInfo;

before(async () => {
  local = await startLocal(8548, FEE);
  server = createBroadcaster({ rpcUrl: local.rpc, chainId: 31337, pool: local.pool, privateKey: BROADCASTER_KEY, fee: FEE, mnemonic: BROADCASTER_MNEMONIC, port: 0 });
  const port = await server.listen();
  info = await pickBroadcaster(["http://127.0.0.1:1", `http://127.0.0.1:${port}`]);
  // The client takes the broadcaster's terms from /info, not from local config.
  local.cfg.broadcaster = info.address;
  local.cfg.fee = info.fee;

  const a = await Wallet.create(MNEMONIC_A, local.cfg);
  await local.send(local.depositor, await a.buildShield(local.weth, 5n * E));
});

after(async () => {
  await server.close();
  await shutdownProver();
  local.stop();
});

test("info advertises the bound address and fee, and a dead broadcaster is skipped", async () => {
  assert.equal(info.address.toLowerCase(), server.address.toLowerCase());
  assert.equal(info.fee, FEE);
  assert.equal(info.pool.toLowerCase(), local.pool.toLowerCase());
  await assert.rejects(fetchBroadcasterInfo("http://127.0.0.1:1"));
});

let sent: { to: Hex; data: Hex };

test("a transfer built against /info is accepted and mined, and the relay fee stays inside", async () => {
  const a = await Wallet.create(MNEMONIC_A, local.cfg);
  await a.scan();
  const bAddress = (await keysFromMnemonic(MNEMONIC_B)).address;
  sent = await a.buildTransfer(bAddress, local.weth, 2n * E);

  const before = await local.balanceOf(info.address);
  const hash = await submitViaBroadcaster(info, sent);
  assert.equal(await waitForBroadcast(info, hash), "success");
  assert.equal((await local.balanceOf(info.address)) - before, 0n, "relay fee must not leave the pool");

  const b = await Wallet.create(MNEMONIC_B, local.cfg);
  await b.scan();
  assert.equal(await b.getBalance(local.weth), 2n * E);
});

test("replay is refused at simulation, costing no gas", async () => {
  await assert.rejects(submitViaBroadcaster(info, sent), /simulation reverted/);
});

test("calldata not addressed to the pool, or not transact(), is refused", async () => {
  await assert.rejects(submitViaBroadcaster(info, { to: local.weth, data: sent.data, summary: "" }), /not the pool/);
  await assert.rejects(submitViaBroadcaster(info, { to: local.pool, data: "0xdeadbeef", summary: "" }), /not pool calldata/);
});

test("a proof bound to a different broadcaster is refused before simulation", async () => {
  const other = { ...local.cfg, broadcaster: "0x000000000000000000000000000000000000dEaD" as Hex };
  const a = await Wallet.create(MNEMONIC_A, other);
  await a.scan();
  const bAddress = (await keysFromMnemonic(MNEMONIC_B)).address;
  const tx = await a.buildTransfer(bAddress, local.weth, 1n * E);
  await assert.rejects(submitViaBroadcaster(info, tx), /different broadcaster/);
});

test("a fee below the advertised minimum is refused", async () => {
  const cheap = { ...local.cfg, fee: FEE / 2n };
  const a = await Wallet.create(MNEMONIC_A, cheap);
  await a.scan();
  const bAddress = (await keysFromMnemonic(MNEMONIC_B)).address;
  const tx = await a.buildTransfer(bAddress, local.weth, 1n * E);
  await assert.rejects(submitViaBroadcaster(info, tx), /fee below minimum/);
});

test("a tampered byte in the proof is caught by simulation, not on chain", async () => {
  const a = await Wallet.create(MNEMONIC_A, local.cfg);
  await a.scan();
  const bAddress = (await keysFromMnemonic(MNEMONIC_B)).address;
  const tx = await a.buildTransfer(bAddress, local.weth, 1n * E);
  // Flip a byte inside the proof (after the 4-byte selector and the offset word).
  const bytes = tx.data.slice(2).split("");
  const idx = 2 * (4 + 32 + 32 + 32 + 5);
  bytes[idx] = bytes[idx] === "0" ? "1" : "0";
  const tampered = { ...tx, data: ("0x" + bytes.join("")) as Hex };
  await assert.rejects(submitViaBroadcaster(info, tampered), /simulation reverted/);
});
