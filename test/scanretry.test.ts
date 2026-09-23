// A transient RPC failure or a reorg must not leave the wallet stuck or wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, type WalletConfig } from "../client/src/wallet.ts";
import { MerkleTree } from "../client/src/tree.ts";
import { keysFromMnemonic } from "../client/src/keys.ts";
import { commitmentOf, nullifierOf } from "../client/src/note.ts";
import { addressToField, fieldToBytes32 } from "../client/src/field.ts";

const MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const POOL = "0x00000000000000000000000000000000000000aa" as const;
const TOKEN = "0x00000000000000000000000000000000000000bb" as const;
const COMMITMENT = 12345n;

const hashAt = (fork: number, n: bigint) => "0x" + fork.toString(16).padStart(8, "0") + n.toString(16).padStart(56, "0");
const inRange = (logs: any[], { fromBlock, toBlock }: any) => logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
const cfgFor = (client: any, logChunk: bigint | undefined): WalletConfig => ({
  client, pool: POOL, token: TOKEN, chainId: 4663n, deployBlock: 1n, logChunk,
  broadcaster: POOL, broadcasterAddress: "", fee: 0n, artifacts: {} as any,
});
const otherShield = {
  eventName: "Shield", blockNumber: 10n, logIndex: 0,
  args: { leafIndex: 0n, commitment: COMMITMENT, token: "0x00000000000000000000000000000000000000cc", encryptedNote: "0x" + "00".repeat(96) },
};

async function setup(logChunk: bigint | undefined) {
  const t = await MerkleTree.create();
  t.insert(COMMITMENT);
  const root = t.root;
  let failRootCheck = 1;
  const client = {
    getBlockNumber: async () => 1000n,
    getBlock: async ({ blockNumber }: any) => ({ hash: hashAt(0, blockNumber) }),
    getLogs: async (q: any) => inRange([otherShield], q),
    readContract: async ({ functionName }: any) => {
      if (functionName === "merkleRoot" && failRootCheck-- > 0) throw new Error("fetch failed");
      return functionName === "merkleRoot" ? root : 1n;
    },
  } as any;
  return Wallet.create(MNEMONIC, cfgFor(client, logChunk));
}

test("chunked scan recovers after a failed root check", async () => {
  const w = await setup(100_000n);
  await assert.rejects(w.scan(), /fetch failed/);
  const res = await w.scan();
  assert.equal(res.leaves, 1);
});

test("unchunked scan recovers after a failed root check", async () => {
  const w = await setup(undefined);
  await assert.rejects(w.scan(), /fetch failed/);
  const res = await w.scan();
  assert.equal(res.leaves, 1);
});

for (const logChunk of [undefined, 100_000n]) {
  test(`a reorg that drops a spend restores the balance (${logChunk ? "chunked" : "unchunked"})`, async () => {
    const keys = await keysFromMnemonic(MNEMONIC);
    const note = { publicKey: keys.spending.publicKey, token: addressToField(TOKEN), value: 100n, blinding: 5n };
    const commitment = await commitmentOf(note);
    const blob = "0x" + [note.publicKey, note.blinding, note.value].map((x) => Buffer.from(fieldToBytes32(x)).toString("hex")).join("");
    const shield = { eventName: "Shield", blockNumber: 10n, logIndex: 0, args: { leafIndex: 0n, commitment, token: TOKEN, encryptedNote: blob } };
    // A full exit inserts no leaf, so dropping it leaves the tree and its root unchanged.
    const exit = { eventName: "Exit", blockNumber: 900n, logIndex: 0, args: { nullifiers: [await nullifierOf(keys.spending.privateKey, 0), 1n] } };
    const t = await MerkleTree.create();
    t.insert(commitment);

    let fork = 0;
    const client = {
      getBlockNumber: async () => 1000n,
      getBlock: async ({ blockNumber }: any) => ({ hash: hashAt(fork, blockNumber) }),
      getLogs: async (q: any) => inRange(fork === 0 ? [shield, exit] : [shield], q),
      readContract: async ({ functionName }: any) => (functionName === "merkleRoot" ? t.root : 1n),
    } as any;
    const w = await Wallet.create(MNEMONIC, cfgFor(client, logChunk));

    await w.scan();
    assert.equal(await w.getBalance(TOKEN), 0n, "spent on the first branch");
    fork = 1;
    await w.scan();
    assert.equal(await w.getBalance(TOKEN), 100n, "unspent once the exit is reorged out");
  });
}

test("a throw while ingesting resets, so the retry rebuilds", async () => {
  const t = await MerkleTree.create();
  t.insert(COMMITMENT);
  // A Transact whose counts disagree halts the scan, after the leaf before it went in.
  const bad = { eventName: "Transact", blockNumber: 20n, logIndex: 0, args: { nullifiers: [1n, 2n], commitments: [7n], encryptedNotes: [] } };
  let first = true;
  const client = {
    getBlockNumber: async () => 1000n,
    getBlock: async ({ blockNumber }: any) => ({ hash: hashAt(0, blockNumber) }),
    getLogs: async (q: any) => inRange(first ? [otherShield, bad] : [otherShield], q),
    readContract: async ({ functionName }: any) => (functionName === "merkleRoot" ? t.root : 1n),
  } as any;
  const w = await Wallet.create(MNEMONIC, cfgFor(client, undefined));
  await assert.rejects(w.scan(), /cannot determine what was inserted/);
  first = false;
  const res = await w.scan();
  assert.equal(res.leaves, 1);
});

async function mine() {
  const keys = await keysFromMnemonic(MNEMONIC);
  const note = { publicKey: keys.spending.publicKey, token: addressToField(TOKEN), value: 100n, blinding: 5n };
  const commitment = await commitmentOf(note);
  const blob = "0x" + [note.publicKey, note.blinding, note.value].map((x) => Buffer.from(fieldToBytes32(x)).toString("hex")).join("");
  const shield = { eventName: "Shield", blockNumber: 10n, logIndex: 0, args: { leafIndex: 0n, commitment, token: TOKEN, encryptedNote: blob } };
  const exit = { eventName: "Exit", blockNumber: 50n, logIndex: 0, args: { nullifiers: [await nullifierOf(keys.spending.privateKey, 0), 1n] } };
  const t = await MerkleTree.create();
  t.insert(commitment);
  return { shield, exit, root: t.root };
}

class BlockNotFoundError extends Error { name = "BlockNotFoundError"; }

test("a reorg into a range already read during the same scan is caught", async () => {
  const { shield, exit, root } = await mine();
  let fork = 0;
  const client = {
    getBlockNumber: async () => 1000n,
    getBlock: async ({ blockNumber }: any) => ({ hash: hashAt(fork, blockNumber) }),
    getLogs: async (q: any) => {
      const out = inRange(fork === 0 ? [shield, exit] : [shield], q);
      // The first range is read on the old branch; the exit in it is dropped right after.
      if (q.fromBlock === 1n) fork = 1;
      return out;
    },
    readContract: async ({ functionName }: any) => (functionName === "merkleRoot" ? root : 1n),
  } as any;
  const w = await Wallet.create(MNEMONIC, cfgFor(client, 100n));
  await w.scan();
  assert.equal(await w.getBalance(TOKEN), 100n);
});

test("a chain that is briefly shorter than the last scan does not fail the scan", async () => {
  const { shield, root } = await mine();
  let head = 1000n;
  const client = {
    getBlockNumber: async () => head,
    getBlock: async ({ blockNumber }: any) => {
      if (blockNumber > head) throw new BlockNotFoundError(`block ${blockNumber} not found`);
      return { hash: hashAt(head === 1000n ? 0 : 1, blockNumber) };
    },
    getLogs: async (q: any) => inRange([shield], q),
    readContract: async ({ functionName }: any) => (functionName === "merkleRoot" ? root : 1n),
  } as any;
  const w = await Wallet.create(MNEMONIC, cfgFor(client, 100_000n));
  await w.scan();
  head = 900n;
  const res = await w.scan();
  assert.equal(res.leaves, 1);
  assert.equal(await w.getBalance(TOKEN), 100n);
});
