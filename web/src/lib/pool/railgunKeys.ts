import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha512";
import { blake512 } from "@noble/hashes/blake1";
import { ed25519 } from "@noble/curves/ed25519";
import { bech32m } from "@scure/base";
import { poseidon } from "./vendor/field.ts";

const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const A = 168700n;
const D = 168696n;

const BASE8: [bigint, bigint] = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];

const HARDENED = 0x80000000;
const enc = new TextEncoder();

export const RAILGUN_PATHS = { spending: "m/44'/1984'/0'/0'/", viewing: "m/420'/1984'/0'/0'/" } as const;

export interface RailgunWallet {

  masterPublicKey: bigint;

  viewingPublicKey: Uint8Array;

  viewingPrivateKey: Uint8Array;

  address: string;
}

const normal = (phrase: string) => phrase.trim().replace(/\s+/g, " ");

interface Node { key: Uint8Array; chainCode: Uint8Array }

function masterNode(phrase: string): Node {
  const I = hmac(sha512, enc.encode("babyjubjub seed"), mnemonicToSeedSync(phrase));
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function derive(node: Node, path: string): Node {
  if (!/^m(\/[0-9]+')+$/.test(path)) throw new Error("hardened paths only");
  let n = node;
  for (const seg of path.split("/").slice(1)) {
    const index = Number(seg.slice(0, -1));
    if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new RangeError("bad path segment");
    const data = new Uint8Array(37);
    data.set(n.key, 1);
    new DataView(data.buffer).setUint32(33, index + HARDENED, false);
    const I = hmac(sha512, n.chainCode, data);
    n = { key: I.slice(0, 32), chainCode: I.slice(32) };
  }
  return n;
}

const mod = (x: bigint) => ((x % P) + P) % P;

function inverse(x: bigint): bigint {

  let r = 1n, b = mod(x), e = P - 2n;
  while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; }
  return r;
}

type Ext = [bigint, bigint, bigint, bigint];

function add([X1, Y1, Z1, T1]: Ext, [X2, Y2, Z2, T2]: Ext): Ext {
  const a = (X1 * X2) % P, b = (Y1 * Y2) % P, c = (((D * T1) % P) * T2) % P, d = (Z1 * Z2) % P;
  const e = mod((X1 + Y1) * (X2 + Y2) - a - b), f = mod(d - c), g = (d + c) % P, h = mod(b - A * a);
  return [(e * f) % P, (g * h) % P, (f * g) % P, (e * h) % P];
}

export function babyJubPublicKey(privateKey: Uint8Array): [bigint, bigint] {
  if (privateKey.length !== 32) throw new RangeError("private key must be 32 bytes");
  const h = blake512(privateKey).slice(0, 32);
  h[0] &= 0xf8; h[31] &= 0x7f; h[31] |= 0x40;
  let s = 0n;
  for (let i = 31; i >= 0; i--) s = (s << 8n) | BigInt(h[i]);
  s >>= 3n;
  let acc: Ext = [0n, 1n, 1n, 0n];
  let pt: Ext = [BASE8[0], BASE8[1], 1n, (BASE8[0] * BASE8[1]) % P];
  while (s > 0n) {
    if (s & 1n) acc = add(acc, pt);
    pt = add(pt, pt);
    s >>= 1n;
  }
  const zi = inverse(acc[2]);
  return [(acc[0] * zi) % P, (acc[1] * zi) % P];
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const beToBig = (b: Uint8Array) => (b.length ? BigInt(`0x${hex(b)}`) : 0n);

function networkIdAllChains(): Uint8Array {
  const id = new Uint8Array(8).fill(0xff);
  enc.encode("railgun").forEach((c, i) => { id[i] ^= c; });
  return id;
}

export function encodeRailgunAddress(masterPublicKey: bigint, viewingPublicKey: Uint8Array): string {
  if (viewingPublicKey.length !== 32) throw new RangeError("viewing public key must be 32 bytes");
  if (masterPublicKey < 0n || masterPublicKey >= 1n << 256n) throw new RangeError("master public key out of range");
  const data = new Uint8Array(73);
  data[0] = 1;
  data.set(Uint8Array.from(masterPublicKey.toString(16).padStart(64, "0").match(/../g)!.map((x) => parseInt(x, 16))), 1);
  data.set(networkIdAllChains(), 33);
  data.set(viewingPublicKey, 41);
  return bech32m.encode("0zk", bech32m.toWords(data), 127);
}

export function decodeRailgunAddress(address: string): { masterPublicKey: bigint; viewingPublicKey: Uint8Array } {
  const { prefix, words } = bech32m.decode(address as `${string}1${string}`, 127);
  const data = bech32m.fromWords(words);
  if (prefix !== "0zk" || data.length !== 73 || data[0] !== 1) throw new Error("not a RAILGUN address");
  return { masterPublicKey: beToBig(data.slice(1, 33)), viewingPublicKey: data.slice(41, 73) };
}

export async function railgunWallet(phrase: string, index = 0): Promise<RailgunWallet> {
  const words = normal(phrase);
  if (!validateMnemonic(words, wordlist)) throw new Error("invalid mnemonic");
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) throw new RangeError("bad account index");
  const root = masterNode(words);
  const spending = derive(root, `${RAILGUN_PATHS.spending}${index}'`);
  const viewing = derive(root, `${RAILGUN_PATHS.viewing}${index}'`);

  const [sx, sy] = babyJubPublicKey(spending.key);
  const h = await poseidon();
  const nullifyingKey = h([beToBig(viewing.key)]);
  const masterPublicKey = h([sx, sy, nullifyingKey]);
  const viewingPublicKey = ed25519.getPublicKey(viewing.key);
  return {
    masterPublicKey,
    viewingPublicKey,
    viewingPrivateKey: viewing.key,
    address: encodeRailgunAddress(masterPublicKey, viewingPublicKey),
  };
}
