// Checks the pool's asset allowlist before deploy: the pinned list against
// Robinhood's live registry, the chain, and the TOKENS value the deploy reads.
// Usage: [RPC_URL=...] [TOKENS=0x..,0x..] node scripts/assets-check.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbi, getAddress } from "viem";

const LIST = "config/robinhood-mainnet-assets.json";
const PINNED_SHA256 = "d0bd81f641659514b9d479445e4f0ded471da1c4249e2451e162b7b22d7e159c";
const REGISTRY = "https://api.robinhood.com/rhj/assets";
const CHAIN_ID = 4663;
const RPC_URL = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

let fails = 0;
const line = (ok, what, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? "   " + detail : ""}`); if (!ok) fails++; };

const raw = readFileSync(LIST);
line(createHash("sha256").update(raw).digest("hex") === PINNED_SHA256, `${LIST} is the pinned list`, PINNED_SHA256.slice(0, 12));
const list = JSON.parse(raw.toString());
const addrs = list.map((a) => getAddress(a.address));
line(new Set(addrs).size === addrs.length, "no duplicates", `${addrs.length} assets`);

if (process.env.TOKENS) {
  const env = process.env.TOKENS.split(",").map((a) => getAddress(a.trim()));
  line(env.join() === addrs.join(), "TOKENS the deploy reads matches the list, in order", `${env.length} addresses`);
} else {
  console.log("skip  TOKENS not set (source .env.mainnet to check what the deploy will read)");
}

const reg = await (await fetch(REGISTRY)).json();
const live = new Map();
const inactive = [];
for (const a of reg.assets ?? []) {
  const d = (a.deployments ?? []).find((x) => x.chainId === CHAIN_ID);
  if (!d) continue;
  if (a.status !== "ASSET_STATUS_ACTIVE") inactive.push(`${a.tokenSymbol} ${a.status}`);
  live.set(getAddress(d.contractAddress), a);
}
const stocks = list.filter((a) => a.symbol !== "WETH" && a.symbol !== "USDG");
const added = [...live.keys()].filter((x) => !stocks.some((s) => getAddress(s.address) === x));
const removed = stocks.filter((s) => !live.has(getAddress(s.address)));
line(added.length === 0 && removed.length === 0, "registry matches the list's stock tokens", `${live.size} live, ${stocks.length} listed`);
for (const x of added) console.log(`      new in registry:  ${live.get(x).tokenSymbol} ${x}`);
for (const s of removed) console.log(`      gone from registry: ${s.symbol} ${s.address}`);
line(inactive.length === 0, "every registry token is active", inactive.join(", "));
for (const s of stocks) {
  const r = live.get(getAddress(s.address));
  if (r && r.tokenSymbol !== s.symbol) line(false, `registry symbol for ${s.address}`, `${r.tokenSymbol}, list says ${s.symbol}`);
}

const client = createPublicClient({ transport: http(RPC_URL, { retryCount: 6, retryDelay: 1000 }) });
line((await client.getChainId()) === CHAIN_ID, `RPC is chain ${CHAIN_ID}`);
const erc20 = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
let bad = 0;
for (const a of list) {
  const address = getAddress(a.address);
  const [code, dec, sym] = await Promise.all([
    client.getCode({ address }),
    client.readContract({ address, abi: erc20, functionName: "decimals" }).catch(() => null),
    client.readContract({ address, abi: erc20, functionName: "symbol" }).catch(() => null),
  ]);
  const ok = Boolean(code && code !== "0x") && dec === a.decimals && sym === a.symbol;
  if (!ok) { bad++; console.log(`FAIL  ${a.symbol} ${address}   code ${code && code !== "0x" ? "yes" : "no"}, decimals ${dec}, symbol ${sym}`); }
}
line(bad === 0, "every asset has code on chain and answers decimals() and symbol() as listed", `${list.length - bad} of ${list.length}`);

console.log(`\n${fails ? `${fails} FAILED: do not deploy with this list` : "ALL PASS: the list is current and matches the chain"}`);
process.exit(fails ? 1 : 0);
