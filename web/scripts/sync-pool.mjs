import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const hashes = {};

const repo = process.env.POOL_REPO ?? resolve(process.cwd(), "../../../shielded-pool");
const clientDst = resolve(process.cwd(), "src/lib/pool/vendor");
const artefactDst = resolve(process.cwd(), "public/pool");

if (!existsSync(repo)) {
  console.warn(`[sync-pool] ${repo} not found; leaving existing copy in place.`);
  process.exit(0);
}

await rm(clientDst, { recursive: true, force: true });
await mkdir(clientDst, { recursive: true });
await cp(join(repo, "client/src"), clientDst, { recursive: true });

await mkdir(artefactDst, { recursive: true });
for (const [from, to] of [
  ["build/transaction_js/transaction.wasm", "transaction.wasm"],
  ["build/transaction_final.zkey", "transaction.zkey"],
  ["build/verification_key.json", "verification_key.json"],
]) {
  const src = join(repo, from);
  if (!existsSync(src)) { console.warn(`[sync-pool] missing ${from}`); continue; }
  await cp(src, join(artefactDst, to));
  const { size } = await stat(src);
  console.log(`[sync-pool] ${to} ${(size / 1e6).toFixed(2)} MB`);
  hashes[to] = createHash("sha256").update(await readFile(src)).digest("hex");
}

await writeFile(
  resolve(process.cwd(), "src/lib/pool/artifact-hashes.json"),
  JSON.stringify({ wasm: hashes["transaction.wasm"], zkey: hashes["transaction.zkey"], vkey: hashes["verification_key.json"] }, null, 2) + "\n",
);

const sha = async (f) => createHash("sha256").update(await readFile(f)).digest("hex");
const client = {};
for (const f of (await readdir(join(repo, "client/src"))).sort()) {
  if (f.endsWith(".ts")) client[f] = await sha(join(repo, "client/src", f));
}
const git = (...a) => { try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim(); } catch { return null; } };
const dirty = git("status", "--porcelain", "--", "client/src", "contracts", "circuits");
await writeFile(join(artefactDst, "manifest.json"), JSON.stringify({
  poolRepoCommit: git("rev-parse", "HEAD"),
  poolRepoDirty: Boolean(dirty),
  artefacts: hashes,
  client,
}, null, 2) + "\n");
console.log(`[sync-pool] zkey ${hashes["transaction.zkey"]}`);
console.log(`[sync-pool] manifest at pool commit ${git("rev-parse", "--short", "HEAD")}${dirty ? " (DIRTY)" : ""}`);
console.log("[sync-pool] client and artefacts synced");
