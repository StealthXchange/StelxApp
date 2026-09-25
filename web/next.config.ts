import type { NextConfig } from "next";
import { configuredTokenPool } from "./src/lib/pool/tokenPoolConfig.ts";

const tokenPool = configuredTokenPool();

const TESTNET_ADDRESSES = new Map([
  ["0x33e4191705c386532ba27cbf171db86919200b94", "testnet WETH"],
  ["0x564dd87b9110630ec592176e2f64d4d7a329e114", "the testnet pool"],
  ["0xec9ecebdde288d9247143984ced724f57ad67098", "the withdrawn testnet pool"],
]);

function mainnetPreflight() {
  if (process.env.NEXT_PUBLIC_POOL_CHAIN_ID?.trim() !== "4663") return;

  const problems: string[] = [];
  const val = (k: string) => {
    const v = process.env[k]?.trim();
    if (!v) problems.push(`${k} is not set`);
    return v ?? "";
  };

  const testnetUrl = (k: string, u: string) => {
    let host = "";
    try { host = new URL(u).host; } catch { problems.push(`${k} has a value that is not a URL: ${u}`); return; }
    if (/testnet/i.test(host)) problems.push(`${k} is a testnet URL: ${u}`);
  };
  const testnetAddress = (k: string, a: string) => {
    const known = TESTNET_ADDRESSES.get(a.toLowerCase());
    if (known) problems.push(`${k} is ${known} (${a})`);
    if (a && !/^0x[0-9a-fA-F]{40}$/.test(a)) problems.push(`${k} is not an address: ${a}`);
  };

  const rpc = val("NEXT_PUBLIC_POOL_RPC");
  if (rpc) testnetUrl("NEXT_PUBLIC_POOL_RPC", rpc);
  for (const k of ["NEXT_PUBLIC_POOL_TOKEN", "NEXT_PUBLIC_POOL_ADDRESS"]) {
    const a = val(k);
    if (a) testnetAddress(k, a);
  }
  const block = val("NEXT_PUBLIC_POOL_DEPLOY_BLOCK");
  if (block && !/^[1-9]\d*$/.test(block)) problems.push(`NEXT_PUBLIC_POOL_DEPLOY_BLOCK is not a block number: ${block}`);
  const relays = val("NEXT_PUBLIC_POOL_BROADCASTERS").split(",").map((s) => s.trim()).filter(Boolean);
  for (const r of relays) testnetUrl("NEXT_PUBLIC_POOL_BROADCASTERS", r);

  const explorer = process.env.NEXT_PUBLIC_POOL_EXPLORER?.trim();
  if (explorer) testnetUrl("NEXT_PUBLIC_POOL_EXPLORER", explorer);

  if (problems.length) {
    throw new Error(
      "Mainnet build refused (NEXT_PUBLIC_POOL_CHAIN_ID=4663). Every pool setting must be set, and none may be a testnet value:\n  - " +
      problems.join("\n  - "),
    );
  }
}
mainnetPreflight();

const rpcOrigins = [
  tokenPool?.rpc,
  process.env.NEXT_PUBLIC_POOL_RPC,
  "https://rpc.testnet.chain.robinhood.com",
  "https://rpc.mainnet.chain.robinhood.com",
];
const relayOrigins = [
  ...(tokenPool?.relays ?? []),
  ...(process.env.NEXT_PUBLIC_POOL_BROADCASTERS ?? "").split(","),
  process.env.NEXT_PUBLIC_CEREMONY_URL,
  "https://bc.nonyabusiness.xyz",
];
const origin = (u?: string) => {
  try { return u ? new URL(u.trim()).origin : null; } catch { return null; }
};
const connect = [...new Set([...rpcOrigins, ...relayOrigins].map(origin).filter(Boolean))];

const dev = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",

  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${connect.join(" ")}${dev ? " ws: http://localhost:*" : ""}`,
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
