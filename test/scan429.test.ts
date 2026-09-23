// A 429 rate limit is waited out on the same range; only a real result cap splits the range.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, type WalletConfig } from "../client/src/wallet.ts";
import { MerkleTree } from "../client/src/tree.ts";

const MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const POOL = "0x00000000000000000000000000000000000000aa" as const;
const TOKEN = "0x00000000000000000000000000000000000000bb" as const;

function httpError(status: number, message: string) {
  // The shape viem throws: an HttpRequestError nested as the cause.
  const cause = Object.assign(new Error(message), { name: "HttpRequestError", status });
  return Object.assign(new Error("HTTP request failed."), { details: message, cause });
}

async function wallet(getLogs: (a: any) => Promise<any[]>): Promise<Wallet> {
  const emptyRoot = (await MerkleTree.create()).root;
  const client = {
    getBlockNumber: async () => 1000n,
    getBlock: async ({ blockNumber }: any) => ({ hash: "0x" + blockNumber.toString(16).padStart(64, "0") }),
    getLogs,
    readContract: async ({ functionName }: any) => (functionName === "merkleRoot" ? emptyRoot : 0n),
  } as any;
  const cfg: WalletConfig = {
    client, pool: POOL, token: TOKEN, chainId: 4663n, deployBlock: 1n,
    broadcaster: POOL, broadcasterAddress: "", fee: 0n, artifacts: {} as any,
  };
  return Wallet.create(MNEMONIC, cfg);
}

test("a 429 is waited out on the same range, not split", async () => {
  const ranges: string[] = [];
  let fails = 2;
  const w = await wallet(async ({ fromBlock, toBlock }) => {
    ranges.push(`${fromBlock}-${toBlock}`);
    if (fails-- > 0) throw httpError(429, '{"code":429,"message":"Too Many Requests"}');
    return [];
  });
  const res = await w.scan();
  assert.equal(res.leaves, 0);
  assert.deepEqual(ranges, ["1-1000", "1-1000", "1-1000"], "retried the same range after each 429");
});

test("a real result cap is still split", async () => {
  const ranges: string[] = [];
  const w = await wallet(async ({ fromBlock, toBlock }) => {
    ranges.push(`${fromBlock}-${toBlock}`);
    if (fromBlock === 1n && toBlock === 1000n) {
      throw Object.assign(new Error("RPC error"), { details: "logs matched by query exceeds limit of 10000" });
    }
    return [];
  });
  await w.scan();
  assert.deepEqual(ranges, ["1-1000", "1-500", "501-1000"], "halved once on a result cap");
});

test("a rate limit that never lifts fails the scan instead of looping", async () => {
  let calls = 0;
  const w = await wallet(async () => { calls++; throw httpError(429, "Too Many Requests"); });
  await assert.rejects(w.scan());
  assert.equal(calls, 7, "one try and six retries");
});
