import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = process.env.POOL_REPO ?? resolve(process.cwd(), "../../../shielded-pool");
const AUDITED = "d0bd81f641659514b9d479445e4f0ded471da1c4249e2451e162b7b22d7e159c";
const raw = readFileSync(resolve(repo, "config/robinhood-mainnet-assets.json"));
if (createHash("sha256").update(raw).digest("hex") !== AUDITED) throw new Error("asset list is not the audited one");

const names = new Map([
  ["0x0bd7d308f8e1639fab988df18a8011f41eacad73", "Wrapped Ether"],
  ["0x5fc5360d0400a0fd4f2af552add042d716f1d168", "Global Dollar"],
]);
const reg = await (await fetch("https://api.robinhood.com/rhj/assets")).json();
for (const a of reg.assets) {
  const d = a.deployments?.find((x) => x.chainId === 4663);
  if (d) names.set(d.contractAddress.toLowerCase(), a.tokenName.replace(/\s*•\s*Robinhood Token$/, "").trim());
}

const out = JSON.parse(raw).map((a) => ({
  symbol: a.symbol, name: names.get(a.address.toLowerCase()) ?? a.symbol, address: a.address, decimals: a.decimals,
}));
writeFileSync(resolve(process.cwd(), "src/lib/pool/assets.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`${out.length} assets, ${out.filter((a) => a.name === a.symbol).length} without a name`);
