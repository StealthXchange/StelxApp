import { createPublicClient } from "viem";
import { Wallet, type WalletConfig } from "./vendor/wallet.ts";
import { loadArtifacts } from "./artifacts.ts";
import { CHAIN, poolTransport, SCAN_CHUNK } from "./config.ts";

type InMessage =
  | { type: "init"; mnemonic: string; config: SerializableConfig }
  | { type: "build"; kind: "transfer" | "unshield"; token: string; to: string; amount: string; broadcaster: string; broadcasterAddress: string; fee: string };

interface SerializableConfig {
  rpc: string;
  chainId: number;
  pool: string;
  deployBlock: string;
}

type WalletParams = { token: string; broadcaster: string; broadcasterAddress: string; fee: bigint };

let wallet: Wallet | null = null;
let config: SerializableConfig | null = null;

function post(msg: unknown) {
  (self as unknown as Worker).postMessage(msg);
}

function stage(name: string, detail?: string) {
  post({ type: "progress", stage: name, detail });
}

async function makeWallet(mnemonic: string, cfg: SerializableConfig, { token, broadcaster, broadcasterAddress, fee }: WalletParams): Promise<Wallet> {
  stage("artifacts", "Loading proving key");
  const artifacts = await loadArtifacts((loaded, total) => {
    post({ type: "download", loaded, total });
  });

  const chain = { ...CHAIN, id: cfg.chainId, rpcUrls: { default: { http: [cfg.rpc] } } };

  const walletConfig: WalletConfig = {
    client: createPublicClient({ chain: chain as any, transport: poolTransport(cfg.rpc) }) as any,
    pool: cfg.pool as `0x${string}`,
    token: token as `0x${string}`,
    chainId: BigInt(cfg.chainId),
    deployBlock: BigInt(cfg.deployBlock),
    logChunk: SCAN_CHUNK,
    broadcaster: broadcaster as `0x${string}`,
    broadcasterAddress,
    fee,
    artifacts,
  };
  return Wallet.create(mnemonic, walletConfig);
}

let mnemonicHeld: string | null = null;

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      mnemonicHeld = msg.mnemonic;
      config = msg.config;
      post({ type: "ready" });
      return;
    }

    if (msg.type === "build") {
      if (!mnemonicHeld || !config) throw new Error("Worker not initialised.");

      wallet = await makeWallet(mnemonicHeld, config, { token: msg.token, broadcaster: msg.broadcaster, broadcasterAddress: msg.broadcasterAddress, fee: BigInt(msg.fee) });

      stage("scanning", "Reading your notes from the chain");
      await wallet.scan();

      stage("proving", "Generating the zero-knowledge proof");
      const built = msg.kind === "transfer"
        ? await wallet.buildTransfer(msg.to, msg.token as `0x${string}`, BigInt(msg.amount))
        : await wallet.buildUnshield(msg.to as `0x${string}`, msg.token as `0x${string}`, BigInt(msg.amount));

      post({ type: "built", tx: { to: built.to, data: built.data, summary: built.summary } });
      return;
    }
  } catch (err: any) {
    post({ type: "error", message: String(err?.shortMessage ?? err?.message ?? err) });
  }
};
