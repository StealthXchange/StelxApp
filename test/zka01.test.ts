// A full-tree transact emits OutputsDropped then Transact; the scanner must not insert those commitments.
import { MerkleTree } from "../client/src/tree.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeEventTopics, encodeAbiParameters, parseAbiParameters } from "viem";
import { Wallet, POOL_ABI, type WalletConfig } from "../client/src/wallet.ts";
import { commitmentOf } from "../client/src/note.ts";
import { addressToField } from "../client/src/field.ts";
import { keysFromMnemonic } from "../client/src/keys.ts";

const POOL = "0x7005aA5deaF8433d72fdc6B56a7ccC225F51FB5C" as const;
const TOKEN = "0x33e4191705c386532ba27cBF171Db86919200B94" as const;
const MNEMONIC = "test test test test test test test test test test test junk";

function log(eventName: string, args: any, blockNumber: bigint, logIndex: number) {
  return { eventName, args, blockNumber, logIndex };
}

test("ZKA-01: a full-tree OutputsDropped transact does not break a fresh scan", async () => {
  const tokenField = addressToField(TOKEN);

  const dropA = await commitmentOf({ publicKey: 11n, token: tokenField, value: 5n, blinding: 7n });
  const dropB = await commitmentOf({ publicKey: 12n, token: tokenField, value: 6n, blinding: 8n });

  const scripted = [
    log("OutputsDropped", { commitments: [dropA, dropB] }, 100n, 0),
    log("Transact", {
      nullifiers: [101n, 102n],
      commitments: [dropA, dropB],
      encryptedNotes: ["0x", "0x"],
    }, 100n, 1),
  ];

  const emptyRoot = (await MerkleTree.create()).root;
  const fake = {
    getBlockNumber: async () => 100n,
    getBlock: async ({ blockNumber }: any) => ({ hash: "0x" + blockNumber.toString(16).padStart(64, "0") }),
    getLogs: async () => scripted,
    // Nothing was inserted: nextLeafIndex is 0 and the root is the empty root.
    readContract: async ({ functionName }: any) => (functionName === "merkleRoot" ? emptyRoot : 0n),
  } as any;

  const cfg: WalletConfig = {
    client: fake, pool: POOL, token: TOKEN, chainId: 46630n,
    deployBlock: 0n, broadcaster: POOL, fee: 0n, artifacts: {} as any,
  };

  const w = await Wallet.create(MNEMONIC, cfg);
  const res = await w.scan();
  assert.equal(res.leaves, 0, "dropped commitments must not enter the local tree");

  const again = await w.scan();
  assert.equal(again.leaves, 0);
});
