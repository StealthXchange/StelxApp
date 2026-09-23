// Real Robinhood Chain assets through the pool, on a local Anvil fork of chain 4663 started just before running:
// anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663 -p 8570, then FORK_RPC=http://127.0.0.1:8570 node --test test/fork.stocks.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient, createWalletClient, decodeErrorResult, defineChain, encodeDeployData, encodeFunctionData,
  http, parseAbi, toHex, type Account, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Wallet, POOL_ABI, FEE_BPS, BPS, type WalletConfig } from "../client/src/wallet.ts";
import { keysFromMnemonic, newMnemonic } from "../client/src/keys.ts";
import { shutdownProver } from "../client/src/prover.ts";
import { root, nodeArtifacts, DEPOSITOR_KEY, BROADCASTER_KEY, BROADCASTER_MNEMONIC, TREASURY } from "./helpers/local.ts";

const RPC = process.env.FORK_RPC;
const CHAIN_ID = 4663;
/** ArbGasInfo.getMaxTxGasLimit() on Robinhood Chain mainnet, read 2026-09-23. */
const MAX_TX_GAS = 32_000_000n;

// Wallets without code that held each asset on 2026-09-23; the first still holding enough is used.
const CASES: { sym: string; token: Hex; holders: Hex[] }[] = [
  { sym: "TSLA", token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", holders: ["0xcfbd76ec9e6a545afdac1c3b7bc1bfc4eb50187c", "0x2ccc152ad68419f777531e6a40a52325e2a80ee2", "0xaae7b2026bd877a330a93c15c806372f057886f9"] },
  { sym: "AAPL", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", holders: ["0xc8b9748f360d604ce45db7d37df45236a9838a29", "0x9efe77bf14f5de979183c22484c64b9d74e135e8", "0x9dac88590ddb64d667503667e5339ece663cdf5b"] },
  { sym: "NVDA", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", holders: ["0xbc2d3d841233542292cbf48d4ce8100ea4dd2e6a", "0xff270e10d2e728ab1ed0b0a7c97e332fcdfd9237", "0xf50dad63482ba97ea3784ead7d22d1473a78200f"] },
  { sym: "SPY", token: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", holders: ["0x8f612edf9bb0e3ca8719341ed7c896fc46e54b66", "0xf60633d02690e2a15a54ab919925f3d038df163e", "0x046c58b10eef3b19154da71955815f05c0010a8a"] },
  // uiMultiplier 1.0011..., a dividend-style adjustment.
  { sym: "CRM", token: "0xd95B44124e475743a7589e68F3D74008A5536D44", holders: ["0xc06ebbefd94032b85424d51906e2a335efae264b", "0x9edb2548f6b6df045eb5503ad597a1eb0574c162", "0xe28601398a5448d1147e6e8b0e0c6d686f0d216d"] },
  // uiMultiplier 4.0: a 4-for-1 split done by multiplier, raw balances untouched.
  { sym: "CRWD", token: "0xea72Ecca2d0f6bFA1394DBBCff85b52CD4233931", holders: ["0x3ad95bb52b4a463128bf544938ae3af290143f09", "0xcd6b980029e6e6e0733ac8ec3e02be9410d09799", "0xcc82417f383fc3af7cb997eee3b6db6db4b73e14"] },
  { sym: "USDG", token: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", holders: ["0x3291f6b4958f014f73128079c7dda5462b3397a9", "0x7797c4a7f786f77dbce13d71d2c710310cb92aa3", "0x86963e1d6aeafff2868f3c6c7dc4176dc5e81b26"] },
  { sym: "WETH", token: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", holders: ["0x28c3c78903445a6525c1844738a3be61e41877b1", "0x866bbaa6497d8bbd90036ec4a6138b37df973f9c", "0xfc1004acf33cc0ed25e8284f23dd0b3a16e14cc7"] },
];

// Beacon of the stock token proxies and their access registry: it upgrades, pauses and blocklists them all at once.
const REGISTRY = "0xe10b6f6B275de231345c20D14Ab812db62151b00" as Hex;
const ROLE = {
  blocker: "0x913ca87347391218e5de2c17c5a0aeba8b0b28fd",
  pauser: "0xe7bcb188254bc6ebbff63014dfed4cd4a024f22a",
  tokenPauser: "0xfccf56b674113d9c4eb0f9b3370930ced9e6ab23",
  adminBurner: "0x957b6de6525c63349f7619743ef1e0ad93cd74d4",
  multiplier: "0x92905e8d0e2301ba143215b8d86d63ffd4188143",
} as const satisfies Record<string, Hex>;

const TOKEN = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function paused() view returns (bool)",
  "function uiMultiplier() view returns (uint256)",
  "function balanceOfUI(address a) view returns (uint256)",
  "function pause()",
  "function unpause()",
  "function updateMultiplier(uint256 multiplier)",
  "function adminBurn(address from, uint256 amount)",
]);
const REGISTRY_ABI = parseAbi([
  "function blockAccounts(address[] accounts)",
  "function unblockAccounts(address[] accounts)",
  "function isBlocked(address a) view returns (bool)",
  "function pause()",
  "function unpause()",
]);
const LEDGER = parseAbi([
  "function shieldedBalance(address token) view returns (uint256)",
  "function treasuryBalance(address token) view returns (uint256)",
  "function isSupported(address token) view returns (bool)",
  "function collectFees(address token)",
]);

const artifact = (p: string) => JSON.parse(readFileSync(join(root, "out", p), "utf8"));
function mainnetTokens(): Hex[] {
  const list = JSON.parse(readFileSync(join(root, "config", "robinhood-mainnet-assets.json"), "utf8"));
  return list.map((a: { address: string }) => a.address) as Hex[];
}

interface Row {
  sym: string; token: Hex; holder: Hex; holders: Hex[];
  decimals: number; paused: string; multiplier: string;
  mSender: string; mRecipient: string; withdrawTo: Hex; withdrawTo2: Hex;
  amount: bigint; net: bigint; sent: bigint; withdrawn: bigint; payout: bigint;
  holderDelta: bigint; poolIn: bigint; poolOut: bigint; received: bigint;
  deposit: string; send: string; withdraw: string; notes: string[];
}

if (!RPC) {
  test("fork: real Robinhood Chain assets through the pool", { skip: "set FORK_RPC to a local Anvil fork of chain 4663" }, () => {});
} else {
  const rh = defineChain({
    id: CHAIN_ID, name: "Robinhood Chain (local fork)",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  });
  // Long timeout: Anvil fetches each asset from the real RPC on first touch.
  const transport = () => http(RPC, { timeout: 600_000, retryCount: 0 });
  const pub = createPublicClient({ chain: rh, transport: transport(), pollingInterval: 50 });
  const rpc = (method: string, params: unknown[]) => pub.request({ method: method as any, params: params as any });
  const deployer = privateKeyToAccount(DEPOSITOR_KEY);
  const relay = privateKeyToAccount(BROADCASTER_KEY);
  const poolArt = artifact("ShieldedPool.sol/ShieldedPool.json");
  const ERRORS = [
    ...poolArt.abi.filter((x: any) => x.type === "error"),
    ...parseAbi([
      "error IsPaused()",
      "error Blocked(address account)",
      "error ERC20InvalidReceiver(address receiver)",
      "error AccessControlUnauthorizedAccount(address account, bytes32 role)",
      "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
      "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
      "error ContractPaused()",
      "error InsufficientFunds()",
      "error InsufficientAllowance()",
    ]),
  ];

  let pool: Hex, deployBlock: bigint, relayAddress: string, poolGas: bigint, oneTokenGas: bigint;
  const rows: Row[] = [];
  const t0 = Date.now();
  const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s] ${s}`);

  const cfg = (token: Hex): WalletConfig => ({
    client: pub as any, pool, token, chainId: BigInt(CHAIN_ID), deployBlock,
    broadcaster: relay.address, broadcasterAddress: relayAddress, fee: 0n,
    artifacts: nodeArtifacts(),
  });
  const chainRoot = () => pub.readContract({ address: pool, abi: POOL_ABI, functionName: "merkleRoot" }) as Promise<bigint>;
  const balanceOf = (token: Hex, who: Hex) => pub.readContract({ address: token, abi: TOKEN, functionName: "balanceOf", args: [who] });
  const ledger = (fn: "shieldedBalance" | "treasuryBalance", token: Hex) => pub.readContract({ address: pool, abi: LEDGER, functionName: fn, args: [token] });
  const fee = (x: bigint) => (x * FEE_BPS) / BPS;
  const freshAddress = () => toHex(randomBytes(20)) as Hex;
  const row = (sym: string) => rows.find((r) => r.sym === sym)!;

  function revertOf(e: any): string {
    let data: Hex | undefined;
    for (let x = e; x && !data; x = x.cause) {
      const d = typeof x.data === "object" ? x.data?.data : x.data;
      if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) data = d as Hex;
    }
    if (data) {
      try {
        const r = decodeErrorResult({ abi: ERRORS, data });
        return `${r.errorName}(${(r.args ?? []).map(String).join(", ")})`;
      } catch { return `revert data ${data.slice(0, 10)} (${(data.length - 2) / 2} bytes)`; }
    }
    return String(e?.details ?? e?.shortMessage ?? e?.message ?? e).split("\n")[0];
  }

  // Simulating first is what yields the revert reason.
  async function exec(from: Hex | Account, to: Hex, data: Hex): Promise<{ ok: true; gasUsed: bigint } | { ok: false; reason: string }> {
    try { await pub.call({ account: from, to, data }); } catch (e) { return { ok: false, reason: revertOf(e) }; }
    const w = createWalletClient({ account: from, chain: rh, transport: transport() });
    const hash = await w.sendTransaction({ to, data, chain: rh, account: w.account! });
    const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 50 });
    return r.status === "success" ? { ok: true, gasUsed: r.gasUsed } : { ok: false, reason: "reverted when mined" };
  }
  async function must(from: Hex | Account, to: Hex, data: Hex, what: string) {
    const r = await exec(from, to, data);
    if (!r.ok) assert.fail(`${what}: ${r.reason}`);
    return r.gasUsed;
  }
  const simulate = (from: Hex | Account, to: Hex, data: Hex) =>
    pub.call({ account: from, to, data }).then(() => "ok", (e) => revertOf(e));

  async function impersonate(a: Hex) {
    await rpc("anvil_impersonateAccount", [a]);
    await rpc("anvil_setBalance", [a, toHex(10n ** 20n)]);
    await pub.getTransactionCount({ address: a });   // fetch the nonce while the upstream still serves it
  }

  before(async () => {
    const url = new URL(RPC);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), `FORK_RPC must be a loopback fork, got ${url.hostname}`);
    const client = String(await rpc("web3_clientVersion", []));
    assert.match(client, /anvil/i, `FORK_RPC must be Anvil, got ${client}`);
    assert.equal(await pub.getChainId(), CHAIN_ID, "FORK_RPC must fork chain 4663");

    // Anvil's dev keys are EIP-7702-delegated to a sweeper on the real chain; make them plain accounts here.
    for (const a of [deployer.address, relay.address]) {
      await rpc("anvil_setCode", [a, "0x"]);
      await rpc("anvil_setBalance", [a, toHex(10n ** 21n)]);
    }
    relayAddress = (await keysFromMnemonic(BROADCASTER_MNEMONIC)).address;

    const dep = createWalletClient({ account: deployer, chain: rh, transport: transport() });
    const deploy = async (abi: any, bytecode: Hex, args: any[] = []) => {
      const hash = await dep.deployContract({ abi, bytecode, args, chain: rh, account: deployer });
      const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 50 });
      assert.equal(r.status, "success", "deployment reverted");
      return { address: r.contractAddress as Hex, block: r.blockNumber, gasUsed: r.gasUsed };
    };
    const t3 = ("0x" + readFileSync(join(root, "build", "PoseidonT3.bin"), "utf8").trim()) as Hex;
    const t5 = ("0x" + readFileSync(join(root, "build", "PoseidonT5.bin"), "utf8").trim()) as Hex;
    const h2 = await deploy([], t3), h4 = await deploy([], t5);
    const v = artifact("TransactionVerifier.sol/Groth16Verifier.json");
    const verifier = await deploy(v.abi, v.bytecode.object);
    const tokens = mainnetTokens();
    assert.equal(tokens.length, 197, "the mainnet list is 197 assets");
    const args = (ts: Hex[]) => [ts, h2.address, h4.address, verifier.address, TREASURY];
    oneTokenGas = await pub.estimateGas({ account: deployer, data: encodeDeployData({ abi: poolArt.abi, bytecode: poolArt.bytecode.object, args: args(tokens.slice(0, 1)) }) });
    const p = await deploy(poolArt.abi, poolArt.bytecode.object, args(tokens));
    pool = p.address; deployBlock = p.block; poolGas = p.gasUsed;
    log(`pool ${pool} with ${tokens.length} assets: constructor ${poolGas} gas (one asset: ~${oneTokenGas} estimated)`);

    for (const r of Object.values(ROLE)) await impersonate(r);

    // Make every deposit and warm every later read while the upstream RPC still serves the fork block's state.
    for (const c of CASES) {
      const r: Row = {
        ...c, holder: c.holders[0], decimals: 0, paused: "", multiplier: "",
        mSender: newMnemonic(), mRecipient: newMnemonic(), withdrawTo: freshAddress(), withdrawTo2: freshAddress(),
        amount: 0n, net: 0n, sent: 0n, withdrawn: 0n, payout: 0n, holderDelta: 0n, poolIn: 0n, poolOut: 0n, received: 0n,
        deposit: "not attempted", send: "not attempted", withdraw: "not attempted", notes: [],
      };
      rows.push(r);
      assert.equal(await pub.readContract({ address: pool, abi: LEDGER, functionName: "isSupported", args: [c.token] }), true, `${c.sym} is listed`);
      r.decimals = await pub.readContract({ address: c.token, abi: TOKEN, functionName: "decimals" });
      r.paused = await pub.readContract({ address: c.token, abi: TOKEN, functionName: "paused" }).then(String, () => "no paused()");
      r.multiplier = await pub.readContract({ address: c.token, abi: TOKEN, functionName: "uiMultiplier" })
        .then((m) => (Number(m) / 1e18).toString(), () => "none");
      let bal = 0n;
      for (const h of r.holders) {
        if (await pub.getCode({ address: h }) !== undefined) continue;
        bal = await balanceOf(c.token, h);
        r.holder = h;
        if (bal >= 10n ** BigInt(r.decimals) / 10_000n) break;
      }
      await impersonate(r.holder);
      r.notes.push(`holder ${r.holder}`);
      // The smaller of a tenth of a unit and a quarter of the holding, plus odd dust to exercise fee rounding.
      const cap = 10n ** BigInt(r.decimals) / 10n;
      const base = bal / 4n < cap ? bal / 4n : cap;
      r.amount = base - (base % 1000n) + 777n;
      r.net = r.amount - fee(r.amount);
      if (bal < 10n ** BigInt(r.decimals) / 10_000n || bal < r.amount) { r.deposit = `no candidate holds enough: ${r.holder} has ${bal}`; continue; }

      // Generous, so later simulated deposits need no second approval.
      const ap = await exec(r.holder, c.token, encodeFunctionData({ abi: TOKEN, functionName: "approve", args: [pool, 2n ** 255n] }));
      if (!ap.ok) { r.deposit = `approve reverted: ${ap.reason}`; continue; }
      const s = await (await Wallet.create(r.mSender, cfg(c.token))).buildShield(c.token, r.amount);
      const poolBefore = await balanceOf(c.token, pool);
      const sh = await exec(r.holder, s.to, s.data);
      if (!sh.ok) { r.deposit = `shield reverted: ${sh.reason}`; continue; }
      r.deposit = "ok";
      r.holderDelta = bal - await balanceOf(c.token, r.holder);
      r.poolIn = await balanceOf(c.token, pool) - poolBefore;
      if (r.multiplier !== "none") r.notes.push(`pool UI balance ${await pub.readContract({ address: c.token, abi: TOKEN, functionName: "balanceOfUI", args: [pool] })} vs raw ${await balanceOf(c.token, pool)}`);

      // Warm the payout path to each recipient and the treasury; simulated, so nothing moves.
      for (const to of [r.withdrawTo, r.withdrawTo2, TREASURY]) {
        await balanceOf(c.token, to);
        const sim = await simulate(pool, c.token, encodeFunctionData({ abi: TOKEN, functionName: "transfer", args: [to, 1n] }));
        if (sim !== "ok") r.notes.push(`pool -> ${to} transfer simulates as ${sim}`);
      }
      log(`${c.sym}: shielded ${r.amount} (decimals ${r.decimals}, paused ${r.paused}, multiplier ${r.multiplier}), gas ${sh.gasUsed}`);
    }

    // Warm the issuer calls the last tests make.
    const tsla = row("TSLA").token, crm = row("CRM").token;
    for (const a of [pool, row("TSLA").withdrawTo2]) {
      await simulate(ROLE.blocker, REGISTRY, encodeFunctionData({ abi: REGISTRY_ABI, functionName: "blockAccounts", args: [[a]] }));
      await simulate(ROLE.blocker, REGISTRY, encodeFunctionData({ abi: REGISTRY_ABI, functionName: "unblockAccounts", args: [[a]] }));
      await pub.readContract({ address: REGISTRY, abi: REGISTRY_ABI, functionName: "isBlocked", args: [a] });
    }
    await simulate(ROLE.pauser, REGISTRY, encodeFunctionData({ abi: REGISTRY_ABI, functionName: "pause" }));
    await simulate(ROLE.tokenPauser, tsla, encodeFunctionData({ abi: TOKEN, functionName: "pause" }));
    await simulate(ROLE.multiplier, crm, encodeFunctionData({ abi: TOKEN, functionName: "updateMultiplier", args: [2n * 10n ** 18n] }));
    await simulate(ROLE.adminBurner, tsla, encodeFunctionData({ abi: TOKEN, functionName: "adminBurn", args: [pool, 1n] }));
    log("phase 1 done: every deposit made and every later read warmed");
  });

  after(async () => {
    await shutdownProver();
    const lines = [
      "| token | decimals | paused | multiplier | deposit | private send | withdraw | exact amounts | notes |",
      "|---|---|---|---|---|---|---|---|---|",
      ...rows.map((r) => {
        const exact = r.deposit !== "ok" ? "-" :
          `in ${r.holderDelta === r.amount && r.poolIn === r.amount ? "exact" : `holder -${r.holderDelta} pool +${r.poolIn} for ${r.amount}`}` +
          (r.withdraw === "ok" ? `; out ${r.received === r.payout && r.poolOut === r.payout ? "exact" : `got ${r.received} pool -${r.poolOut} for ${r.payout}`}` : "");
        return `| ${r.sym} | ${r.decimals} | ${r.paused} | ${r.multiplier} | ${r.deposit} | ${r.send} | ${r.withdraw} | ${exact} | ${r.notes.join("; ")} |`;
      }),
      "",
      `pool constructor with 197 assets: ${poolGas} gas (cap ${MAX_TX_GAS}); one asset ~${oneTokenGas}; ` +
      `~${poolGas && oneTokenGas ? (poolGas - oneTokenGas) / 196n : 0n} gas per extra asset`,
    ];
    console.log("\n" + lines.join("\n"));
    if (process.env.FORK_REPORT) writeFileSync(process.env.FORK_REPORT, lines.join("\n") + "\n");
  });

  test("the pool deploys with all 197 mainnet assets in one transaction under the chain's gas cap", () => {
    assert.ok(poolGas > 0n);
    assert.ok(poolGas < MAX_TX_GAS, `constructor used ${poolGas}, the chain allows ${MAX_TX_GAS} per transaction`);
  });

  for (const c of CASES) {
    test(`${c.sym}: shield, rescan, private send and withdraw in the shared pool`, async () => {
      const r = row(c.sym);
      assert.equal(r.deposit, "ok", `${c.sym} deposit`);
      assert.equal(r.holderDelta, r.amount, "the holder is debited exactly the amount");
      assert.equal(r.poolIn, r.amount, "the pool receives exactly the amount: no transfer fee, no rebase");

      const w = await Wallet.create(r.mSender, cfg(c.token));
      await w.scan();
      assert.equal(await w.getBalance(c.token), r.net, "a rescanned wallet holds the amount less 10 bps");
      assert.equal(w.merkleRoot, await chainRoot(), "the rescanned wallet's tree matches the chain");

      r.sent = r.net / 3n;
      const recipient = (await keysFromMnemonic(r.mRecipient)).address;
      const tx = await w.buildTransfer(recipient, c.token, r.sent);
      const sent = await exec(relay, tx.to, tx.data);
      r.send = sent.ok ? "ok" : `reverted: ${sent.reason}`;
      assert.ok(sent.ok, `${c.sym} private send: ${r.send}`);
      assert.equal(tx.newRoot, await chainRoot(), "the prover's post-transaction root is the contract's");
      const rw = await Wallet.create(r.mRecipient, cfg(c.token));
      await rw.scan();
      assert.equal(await rw.getBalance(c.token), r.sent, "the recipient holds exactly what was sent");
      assert.equal(rw.merkleRoot, await chainRoot(), "the recipient's tree matches the chain");

      const again = await Wallet.create(r.mSender, cfg(c.token));
      await again.scan();
      assert.equal(await again.getBalance(c.token), r.net - r.sent, "the sender holds the change");
      r.withdrawn = (r.net - r.sent) / 2n;
      r.payout = r.withdrawn - fee(r.withdrawn);
      const un = await again.buildUnshield(r.withdrawTo, c.token, r.withdrawn);
      const poolBefore = await balanceOf(c.token, pool);
      const out = await exec(relay, un.to, un.data);
      r.withdraw = out.ok ? "ok" : `reverted: ${out.reason}`;
      assert.ok(out.ok, `${c.sym} withdraw: ${r.withdraw}`);
      r.received = await balanceOf(c.token, r.withdrawTo);
      r.poolOut = poolBefore - await balanceOf(c.token, pool);
      assert.equal(r.received, r.payout, "the recipient gets the withdrawal less 10 bps");
      assert.equal(r.poolOut, r.payout, "the pool is debited exactly the payout");
      assert.equal(un.newRoot, await chainRoot(), "the prover's post-withdrawal root is the contract's");
      log(`${c.sym}: sent ${r.sent}, withdrew ${r.withdrawn} (paid ${r.payout})`);
    });
  }

  test("after every asset has moved, every wallet's tree still equals the chain's", async () => {
    const want = await chainRoot();
    for (const r of rows.filter((x) => x.withdraw === "ok")) {
      const s = await Wallet.create(r.mSender, cfg(r.token));
      await s.scan();
      assert.equal(s.merkleRoot, want, `${r.sym} sender's tree`);
      assert.equal(await s.getBalance(r.token), r.net - r.sent - r.withdrawn, `${r.sym} sender's balance`);
      const d = await Wallet.create(r.mRecipient, cfg(r.token));
      await d.scan();
      assert.equal(d.merkleRoot, want, `${r.sym} recipient's tree`);
      assert.equal(await d.getBalance(r.token), r.sent, `${r.sym} recipient's balance`);
    }
  });

  test("each asset's ledger equals what the pool holds, and a year later still does (no rebasing)", async () => {
    const snapshot: Record<string, bigint> = {};
    for (const r of rows.filter((x) => x.withdraw === "ok")) {
      const held = await balanceOf(r.token, pool);
      const owed = await ledger("shieldedBalance", r.token), fees = await ledger("treasuryBalance", r.token);
      assert.equal(owed, r.net - r.withdrawn, `${r.sym} shielded ledger`);
      assert.equal(fees, fee(r.amount) + fee(r.withdrawn), `${r.sym} fee ledger`);
      assert.equal(held, owed + fees, `${r.sym}: the pool holds exactly what it owes`);
      snapshot[r.sym] = held;
    }
    await rpc("evm_increaseTime", [365 * 24 * 3600]);
    await rpc("evm_mine", []);
    for (const r of rows.filter((x) => x.withdraw === "ok")) {
      assert.equal(await balanceOf(r.token, pool), snapshot[r.sym], `${r.sym}: the pool's balance moved on its own`);
    }
  });

  test("issuer controls: blocking or pausing freezes the pool's stock tokens, lifting it releases them", async () => {
    const r = row("TSLA");
    assert.equal(r.withdraw, "ok", "TSLA must have completed its own flow first");
    const w = await Wallet.create(r.mSender, cfg(r.token));
    await w.scan();
    const x = (await w.getBalance(r.token)) / 2n;
    const un = await w.buildUnshield(r.withdrawTo2, r.token, x);
    const attempt = () => simulate(relay, un.to, un.data);
    const shieldFrom = async (sym: string) => {
      const c = row(sym);
      const s = await (await Wallet.create(newMnemonic(), cfg(c.token))).buildShield(c.token, c.amount);
      return simulate(c.holder, s.to, s.data);
    };
    const reg = (fn: "blockAccounts" | "unblockAccounts", a: Hex) => encodeFunctionData({ abi: REGISTRY_ABI, functionName: fn, args: [[a]] });
    const seen: Record<string, string> = {};

    await must(ROLE.blocker, REGISTRY, reg("blockAccounts", pool), "block the pool");
    seen["pool blocked: TSLA withdraw"] = await attempt();
    seen["pool blocked: TSLA deposit"] = await shieldFrom("TSLA");
    seen["pool blocked: AAPL deposit"] = await shieldFrom("AAPL");
    seen["pool blocked: USDG deposit"] = await shieldFrom("USDG");
    await must(ROLE.blocker, REGISTRY, reg("unblockAccounts", pool), "unblock the pool");

    await must(ROLE.blocker, REGISTRY, reg("blockAccounts", r.withdrawTo2), "block the recipient");
    seen["recipient blocked: TSLA withdraw"] = await attempt();
    await must(ROLE.blocker, REGISTRY, reg("unblockAccounts", r.withdrawTo2), "unblock the recipient");

    await must(ROLE.tokenPauser, r.token, encodeFunctionData({ abi: TOKEN, functionName: "pause" }), "pause TSLA");
    seen["TSLA paused: TSLA withdraw"] = await attempt();
    seen["TSLA paused: AAPL deposit"] = await shieldFrom("AAPL");
    await must(ROLE.tokenPauser, r.token, encodeFunctionData({ abi: TOKEN, functionName: "unpause" }), "unpause TSLA");

    await must(ROLE.pauser, REGISTRY, encodeFunctionData({ abi: REGISTRY_ABI, functionName: "pause" }), "pause the registry");
    seen["registry paused: TSLA withdraw"] = await attempt();
    seen["registry paused: AAPL deposit"] = await shieldFrom("AAPL");
    seen["registry paused: USDG deposit"] = await shieldFrom("USDG");
    await must(ROLE.pauser, REGISTRY, encodeFunctionData({ abi: REGISTRY_ABI, functionName: "unpause" }), "unpause the registry");

    console.log("issuer controls, as observed:\n" + Object.entries(seen).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
    for (const k of ["pool blocked: TSLA withdraw", "pool blocked: TSLA deposit", "recipient blocked: TSLA withdraw", "TSLA paused: TSLA withdraw", "registry paused: TSLA withdraw"]) {
      assert.notEqual(seen[k], "ok", `${k} should have been refused`);
    }
    assert.equal(seen["pool blocked: USDG deposit"], "ok", "the stock registry does not govern USDG");

    // The same proof, built before the restrictions, goes through once they are lifted.
    const out = await exec(relay, un.to, un.data);
    assert.ok(out.ok, `withdrawal after the issuer lifts every restriction: ${out.ok ? "" : out.reason}`);
    assert.equal(await balanceOf(r.token, r.withdrawTo2), x - fee(x), "and pays exactly");
  });

  test("CRM: a multiplier change moves the display balance, not the raw balance the pool accounts in", async () => {
    const r = row("CRM");
    assert.equal(r.withdraw, "ok", "CRM must have completed its own flow first");
    const raw = await balanceOf(r.token, pool);
    const ui = await pub.readContract({ address: r.token, abi: TOKEN, functionName: "balanceOfUI", args: [pool] });
    await must(ROLE.multiplier, r.token, encodeFunctionData({ abi: TOKEN, functionName: "updateMultiplier", args: [2n * 10n ** 18n] }), "set CRM multiplier to 2");
    assert.equal(await pub.readContract({ address: r.token, abi: TOKEN, functionName: "uiMultiplier" }), 2n * 10n ** 18n, "takes effect at once");
    assert.equal(await balanceOf(r.token, pool), raw, "raw balance unchanged");
    const ui2 = await pub.readContract({ address: r.token, abi: TOKEN, functionName: "balanceOfUI", args: [pool] });
    assert.notEqual(ui2, ui, "display balance changed");
    assert.equal(ui2, raw * 2n, "display balance is raw times the new multiplier");

    const w = await Wallet.create(r.mSender, cfg(r.token));
    await w.scan();
    const left = await w.getBalance(r.token);
    const un = await w.buildUnshield(r.withdrawTo2, r.token, left);
    const out = await exec(relay, un.to, un.data);
    assert.ok(out.ok, `CRM withdraw after a multiplier change: ${out.ok ? "" : out.reason}`);
    assert.equal(await balanceOf(r.token, r.withdrawTo2), left - fee(left));
    assert.equal(await ledger("shieldedBalance", r.token), r.sent, "what the pool still owes in CRM is the recipient's note");
  });

  test("an admin can burn a stock token out of the pool, leaving notes the pool cannot pay", async () => {
    const r = row("TSLA");
    const held = await balanceOf(r.token, pool);
    const owed = await ledger("shieldedBalance", r.token), fees = await ledger("treasuryBalance", r.token);
    assert.equal(held, owed + fees);
    // Leave the pool one unit short of its fee ledger.
    const burn = held - fees + 1n;
    await must(ROLE.adminBurner, r.token, encodeFunctionData({ abi: TOKEN, functionName: "adminBurn", args: [pool, burn] }), "adminBurn from the pool");
    assert.equal(await balanceOf(r.token, pool), fees - 1n, "the burn came out of the pool");
    assert.equal(await ledger("shieldedBalance", r.token), owed, "while the ledger still owes the shielded notes");
    const collect = await simulate(relay, pool, encodeFunctionData({ abi: LEDGER, functionName: "collectFees", args: [r.token] }));
    console.log(`after adminBurn(pool, ${burn}): pool holds ${fees - 1n} TSLA against ${owed} owed to notes and ${fees} to the treasury; collectFees: ${collect}`);
    assert.notEqual(collect, "ok", "even the fee claim can no longer be paid");
  });
}
