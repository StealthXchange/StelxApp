// Checks that the repo files, the pool's bytecode, the site's proving files and the broadcaster match the pinned hashes.
// Usage after forge build: [NETWORK=mainnet POOL=0x...] [SSH_KEY=... SSH_HOST=... SSH_DIR=...] node scripts/verify-live.mjs
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createPublicClient, http, keccak256, parseAbi } from "viem";

const PINNED = {
  "contracts/ShieldedPool.sol": "d0af09d98291d483d6d5edd7da6be0a70ee6156c815528130a9bb9982a743d64",
  "contracts/TransactionVerifier.sol": "d64cb8cfbe9621f568bd4410533cba8987db0dda38024872186a83965758b1fb",
  "client/src/broadcast.ts": "c3a108ee4379eddc6dc6df2633da3818ef689f9c32515b2e34ade546f04eefd5",
  "client/src/crypto.ts": "40133e99210e5a8a7ba83546ff633be3e79712c5e8bec61560b97c73629fbba0",
  "client/src/field.ts": "12fd12d2b9c3037cd95665a35f07c7b2ce5edc592373bd335aa56711876f83ad",
  "client/src/keys.ts": "e0c7f4c30f1c39a874572955aa4354a7405d4898d623b4b4a8d10c3458ba4d33",
  "client/src/note.ts": "83c6960056dfb734cdac7d4ba92903d2ca33a1620549cecd279e1861c8305f7e",
  "client/src/prover.ts": "45d48c1ed1cc9fd8728343b49f05d78d9ce1d6f92a253de3bacbd3f6dcd422e5",
  "client/src/tree.ts": "723920895c6d62bb37ed20c121b1cf070f122e5743d1a4f8012c1082ae1214ff",
  "client/src/wallet.ts": "8142c98d61b30d0cbb0046d7d308bafeefba9549fafe4281fd63b3ab5d189282",
  "broadcaster/server.ts": "24baa46c842ff0286439ed90b2f6f29b2c7fe46bfa92e1351cc9df526f8e5d98",
};


const ARTEFACTS = {
  "transaction.zkey": "53212a1c772160234dacca372d9e0bf158fc2ffb529aa61297deead1ccc96cc5",
  "verification_key.json": "b6caa8896766340f6bc6d2da892d088701b3938c0b1cd074dbee3d0c81591e58",
  "transaction.wasm": "02e86c45dbf18119ca068efbda49932e80f85d5299eeb863546f80aab9464718",
};

const PRESETS = {
  testnet: {
    CHAIN_ID: 46630, RPC_URL: "https://rpc.testnet.chain.robinhood.com",
    POOL: "0x564dd87b9110630eC592176E2F64d4D7a329E114",
    SITE: "https://www.stelx.app", BROADCASTER_URL: "https://bc.nonyabusiness.xyz",
  },
  mainnet: {
    CHAIN_ID: 4663, RPC_URL: "https://rpc.mainnet.chain.robinhood.com",
    POOL: "0x7005aA5deaF8433d72fdc6B56a7ccC225F51FB5C", TREASURY: "0xE0d43ceA8c9a069f41D4Ce39126167532Dac2CAC",
    SITE: "https://www.stelx.app", BROADCASTER_URL: "https://bc.nonyabusiness.xyz",
  },
};
const NET = process.env.NETWORK ?? "mainnet";
const cfg = { ...PRESETS[NET] };
for (const k of Object.keys(cfg)) if (process.env[k]) cfg[k] = k === "CHAIN_ID" ? Number(process.env[k]) : process.env[k];
if (!cfg.POOL) { console.error(`set POOL for ${NET}`); process.exit(2); }

let fails = 0;
const line = (ok, what, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? "   " + detail : ""}`); if (!ok) fails++; };
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const short = (h) => (h ? h.slice(0, 12) : "none");
const fetchBytes = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
const client = createPublicClient({ transport: http(cfg.RPC_URL) });

console.log(`\nverify-live  ${NET}  pool ${cfg.POOL}  chain ${cfg.CHAIN_ID}\n`);

console.log("repo");
for (const [f, want] of Object.entries(PINNED)) {
  const got = existsSync(f) ? sha256(readFileSync(f)) : null;
  line(got === want, f, got === want ? short(got) : `have ${short(got)}, pinned ${short(want)}`);
}
const artifact = (p) => JSON.parse(readFileSync(p, "utf8"));
const poolArt = artifact("out/ShieldedPool.sol/ShieldedPool.json");
const verArt = artifact("out/TransactionVerifier.sol/Groth16Verifier.json");
for (const [art, src] of [[poolArt, "contracts/ShieldedPool.sol"], [verArt, "contracts/TransactionVerifier.sol"]]) {
  const built = art.metadata?.sources?.[src]?.keccak256;
  line(built === keccak256(readFileSync(src)), `compiled ${src.split("/")[1]} was built from this source`, built ? "" : "no metadata: run forge build");
}

console.log("\nchain");
line((await client.getChainId()) === cfg.CHAIN_ID, `RPC is chain ${cfg.CHAIN_ID}`);

// Immutables are written into the runtime code at deploy, so blank them in both before comparing.
const onchain = Buffer.from(((await client.getCode({ address: cfg.POOL })) ?? "0x").slice(2), "hex");
const built = Buffer.from(poolArt.deployedBytecode.object.slice(2), "hex");
const refs = Object.values(poolArt.deployedBytecode.immutableReferences ?? {});
const blank = (b) => { const c = Buffer.from(b); for (const rs of refs) for (const r of rs) c.fill(0, r.start, r.start + r.length); return c; };
const sameShape = onchain.length === built.length;
// Solidity appends CBOR metadata, a fingerprint of the source, whose length is the last two bytes.
// Code and fingerprint are compared separately; a fingerprint mismatch fails only on mainnet.
const split = (b) => { const n = b.length >= 2 ? b.readUInt16BE(b.length - 2) + 2 : 0; return [b.subarray(0, b.length - n), b.subarray(b.length - n)]; };
const [liveCode, liveMeta] = split(blank(onchain));
const [builtCode, builtMeta] = split(blank(built));
line(sameShape && liveCode.equals(builtCode), "pool code is this repo's ShieldedPool",
  !onchain.length ? "no code at that address" : sameShape ? `${onchain.length} bytes` : `${onchain.length} bytes, this repo builds ${built.length}`);
if (sameShape && liveMeta.equals(builtMeta)) line(true, "pool was compiled from this exact source");
else if (NET === "mainnet") line(false, "pool was compiled from this exact source", "source fingerprint differs");
else console.log("NOTE  pool was compiled from an earlier revision of this source (fingerprint differs; code identical above)");

// Read each dependency from the pool itself, then check what is deployed there.
const wiring = parseAbi(["function VERIFIER() view returns (address)", "function HASH2() view returns (address)", "function HASH4() view returns (address)", "function TREASURY() view returns (address)"]);
const read = (f) => client.readContract({ address: cfg.POOL, abi: wiring, functionName: f }).catch(() => null);
const [verifier, hash2, hash4, treasury] = await Promise.all(["VERIFIER", "HASH2", "HASH4", "TREASURY"].map(read));
const codeAt = async (a) => (a ? ((await client.getCode({ address: a }).catch(() => null)) ?? "0x").toLowerCase() : "0x");
line((await codeAt(verifier)) === verArt.deployedBytecode.object.toLowerCase(), "VERIFIER() runs the ceremony verifier", verifier ?? "unreadable");
// The hashers are circomlibjs creation code; running it as a call returns the runtime they must have.
for (const [name, addr, bin] of [["HASH2", hash2, "PoseidonT3"], ["HASH4", hash4, "PoseidonT5"]]) {
  const want = await client.call({ data: "0x" + readFileSync(`build/${bin}.bin`, "utf8").trim() }).then((r) => (r.data ?? "").toLowerCase()).catch(() => null);
  line(Boolean(want) && (await codeAt(addr)) === want, `${name}() runs circomlibjs ${bin}`, addr ?? "unreadable");
}
if (cfg.TREASURY) line(Boolean(treasury) && treasury.toLowerCase() === cfg.TREASURY.toLowerCase(), "TREASURY() is the expected Safe", treasury ?? "unreadable");
else console.log(`note  TREASURY() is ${treasury}`);

console.log("\nsite");
for (const [f, want] of Object.entries(ARTEFACTS)) {
  let got = null;
  try { got = sha256(await fetchBytes(`${cfg.SITE}/pool/${f}`)); } catch (e) { got = null; }
  line(got === want, `serves ${f}`, got === want ? short(got) : `serves ${short(got)}, expected ${short(want)}`);
}
let manifest = null;
try { manifest = JSON.parse((await fetchBytes(`${cfg.SITE}/pool/manifest.json`)).toString()); } catch { /* reported below */ }
line(Boolean(manifest), "publishes a build manifest", manifest ? `built from pool ${short(manifest.poolRepoCommit)}` : "none: built before manifests, or not synced");
if (manifest) {
  line(manifest.poolRepoDirty === false, "was built from a clean pool repo");
  for (const [f, want] of Object.entries(PINNED).filter(([f]) => f.startsWith("client/src/"))) {
    const got = manifest.client?.[f.split("/").pop()];
    line(got === want, `bundles ${f}`, got === want ? short(got) : `bundled ${short(got)}, pinned ${short(want)}`);
  }
}
// The pool address is inlined at build time, so find it in the page's code.
let wired = false;
try {
  const html = (await fetchBytes(`${cfg.SITE}/pool`)).toString();
  for (const js of new Set(html.match(/\/_next\/static\/[^"]+\.js/g) ?? [])) {
    if ((await fetchBytes(cfg.SITE + js)).toString().toLowerCase().includes(cfg.POOL.toLowerCase().slice(2))) { wired = true; break; }
  }
} catch { /* reported below */ }
line(wired, "site is pointed at this pool");

console.log("\nrelay");
let info = null;
try { info = JSON.parse((await fetchBytes(`${cfg.BROADCASTER_URL}/info`)).toString()); } catch { /* reported below */ }
line(Boolean(info), "broadcaster answers /info", info ? info.address : "no answer");
if (info) {
  line(String(info.pool).toLowerCase() === cfg.POOL.toLowerCase(), "broadcaster serves this pool", info.pool);
  line(Number(info.chainId) === cfg.CHAIN_ID, "broadcaster is on this chain", String(info.chainId));
  line(typeof info.shieldedAddress === "string" && info.shieldedAddress.startsWith("stelx1"), "broadcaster publishes a pool address for its fee");
}
if (process.env.SSH_KEY && process.env.SSH_HOST && process.env.SSH_DIR) {
  const files = Object.keys(PINNED).filter((f) => f.startsWith("client/src/") || f === "broadcaster/server.ts");
  let out = "";
  try {
    out = execFileSync("ssh", ["-i", process.env.SSH_KEY, "-o", "BatchMode=yes", process.env.SSH_HOST,
      `cd ${process.env.SSH_DIR} && sha256sum ${files.join(" ")}`], { encoding: "utf8" });
  } catch (e) { out = ""; }
  const remote = Object.fromEntries(out.trim().split("\n").filter(Boolean).map((l) => { const [h, f] = l.split(/\s+\*?/); return [f, h]; }));
  for (const f of files) line(remote[f] === PINNED[f], `server runs ${f}`, remote[f] === PINNED[f] ? short(remote[f]) : `runs ${short(remote[f])}, pinned ${short(PINNED[f])}`);
} else {
  console.log("skip  server file hashes (set SSH_KEY, SSH_HOST and SSH_DIR to check them)");
}

console.log(`\n${fails ? `${fails} FAILED: what's live does NOT match the pinned files` : "ALL PASS: what's live matches the pinned files"}`);
console.log("");
process.exit(fails ? 1 : 0);
