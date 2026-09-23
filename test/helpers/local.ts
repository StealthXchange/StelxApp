// Local Anvil setup for the end-to-end and broadcaster tests, mirroring script/Deploy.s.sol.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import type { WalletConfig } from "../../client/src/wallet.ts";
import { keysFromMnemonic } from "../../client/src/keys.ts";

/** The relay's shielded identity for local runs. Not a secret. */
export const BROADCASTER_MNEMONIC =
  "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

export const root = fileURLToPath(new URL("../..", import.meta.url));
const artifact = (p: string) => JSON.parse(readFileSync(join(root, "out", p), "utf8"));

export const TREASURY = "0x0000000000000000000000000000000000007EA5" as Hex;

// Anvil's well-known development keys.
export const DEPOSITOR_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
export const BROADCASTER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;

export const E = 10n ** 18n;

export const ERC20 = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address a) view returns (uint256)",
]);

export function nodeArtifacts() {
  return {
    wasm: join(root, "build", "transaction_js", "transaction.wasm"),
    zkey: join(root, "build", "transaction_final.zkey"),
    verificationKey: JSON.parse(readFileSync(join(root, "build", "verification_key.json"), "utf8")),
  };
}

export interface Local {
  anvil: ChildProcess;
  rpc: string;
  pub: PublicClient;
  depositor: WalletClient;
  broadcaster: WalletClient;
  weth: Hex;
  pool: Hex;
  deployBlock: bigint;
  cfg: WalletConfig;
  send(client: WalletClient, tx: { to: Hex; data: Hex }): Promise<Hex>;
  balanceOf(a: Hex): Promise<bigint>;
  stop(): void;
}

export async function startLocal(port: number, fee: bigint): Promise<Local> {
  const rpc = `http://127.0.0.1:${port}`;
  const exe = process.platform === "win32" ? "anvil.exe" : "anvil";
  const bundled = join(homedir(), ".foundry", "bin", exe);
  const anvilBin = existsSync(bundled) ? bundled : exe;
  const anvil = spawn(anvilBin, ["-p", String(port), "--silent"], { stdio: "ignore" });
  const pub = createPublicClient({ chain: foundry, transport: http(rpc) });
  for (let i = 0; ; i++) {
    try { await pub.getChainId(); break; } catch { if (i > 100) throw new Error("anvil did not start"); await new Promise((r) => setTimeout(r, 200)); }
  }
  const depositor = createWalletClient({ account: privateKeyToAccount(DEPOSITOR_KEY), chain: foundry, transport: http(rpc) });
  const broadcaster = createWalletClient({ account: privateKeyToAccount(BROADCASTER_KEY), chain: foundry, transport: http(rpc) });

  const deploy = async (abi: any, bytecode: Hex, args: any[] = []) => {
    const hash = await depositor.deployContract({ abi, bytecode, args, chain: foundry, account: depositor.account! });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (!rcpt.contractAddress) throw new Error("no contract address");
    return { address: rcpt.contractAddress, block: rcpt.blockNumber };
  };
  const send = async (client: WalletClient, tx: { to: Hex; data: Hex }): Promise<Hex> => {
    const hash = await client.sendTransaction({ to: tx.to, data: tx.data, chain: foundry, account: client.account! });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error("tx reverted");
    return hash;
  };

  const t3 = ("0x" + readFileSync(join(root, "build", "PoseidonT3.bin"), "utf8").trim()) as Hex;
  const t5 = ("0x" + readFileSync(join(root, "build", "PoseidonT5.bin"), "utf8").trim()) as Hex;
  const hash2 = await deploy([], t3);
  const hash4 = await deploy([], t5);
  const verifierArt = artifact("TransactionVerifier.sol/Groth16Verifier.json");
  const verifier = await deploy(verifierArt.abi, verifierArt.bytecode.object);
  const wethArt = artifact("ShieldedPool.t.sol/MockWETH.json");
  const weth = (await deploy(wethArt.abi, wethArt.bytecode.object)).address;
  const poolArt = artifact("ShieldedPool.sol/ShieldedPool.json");
  const p = await deploy(poolArt.abi, poolArt.bytecode.object, [[weth], hash2.address, hash4.address, verifier.address, TREASURY]);

  const cfg: WalletConfig = {
    client: pub, pool: p.address, token: weth, chainId: BigInt(foundry.id), deployBlock: p.block,
    broadcaster: broadcaster.account!.address,
    broadcasterAddress: (await keysFromMnemonic(BROADCASTER_MNEMONIC)).address,
    fee,
    artifacts: nodeArtifacts(),
  };

  await send(depositor, { to: weth, data: encodeFunctionData({ abi: ERC20, functionName: "mint", args: [depositor.account!.address, 100n * E] }) });
  await send(depositor, { to: weth, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [p.address, 2n ** 255n] }) });

  return {
    anvil, rpc, pub, depositor, broadcaster, weth, pool: p.address, deployBlock: p.block, cfg, send,
    balanceOf: (a: Hex) => pub.readContract({ address: weth, abi: ERC20, functionName: "balanceOf", args: [a] }),
    stop: () => { anvil.kill(); },
  };
}
