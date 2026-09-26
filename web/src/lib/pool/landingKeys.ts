import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { CHAIN_ID } from "./vendor/keys.ts";

export const MAX_LANDING_INDEX = 0x7fffffff;

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

function landingNode(mnemonic: string, index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index > MAX_LANDING_INDEX) throw new RangeError("bad landing index");
  if (!validateMnemonic(mnemonic.trim().replace(/\s+/g, " "), wordlist)) throw new Error("invalid mnemonic");
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic.trim().replace(/\s+/g, " "))).derive(`m/422'/${CHAIN_ID}'/0'/0'/${index}'`);
  if (!node.privateKey) throw new Error("derivation produced no private key");
  return node.privateKey;
}

export function landingKey(mnemonic: string, index: number): `0x${string}` {
  const k = hkdf(sha256, landingNode(mnemonic, index), undefined, new TextEncoder().encode(`stelx-pool/onramp/v1/${index}`), 32);
  const n = BigInt(`0x${bytesToHex(k)}`);

  if (n === 0n || n >= N) throw new Error("landing key out of range");
  return `0x${bytesToHex(k)}`;
}

function landingSolanaSeed(mnemonic: string, index: number): Uint8Array {
  return hkdf(sha256, landingNode(mnemonic, index), undefined, new TextEncoder().encode(`stelx-pool/onramp/v1/solana/${index}`), 32);
}

export const landingSolanaAddress = (mnemonic: string, index: number): string => base58.encode(ed25519.getPublicKey(landingSolanaSeed(mnemonic, index)));

export function landingSolanaKey(mnemonic: string, index: number): string {
  const seed = landingSolanaSeed(mnemonic, index);
  return base58.encode(new Uint8Array([...seed, ...ed25519.getPublicKey(seed)]));
}

export async function nextLandingIndex(recorded: Set<number>, usedOnChain: (index: number) => Promise<boolean>): Promise<number> {
  for (let i = 0; i <= MAX_LANDING_INDEX; i++) {
    if (recorded.has(i)) continue;
    if (!(await usedOnChain(i))) return i;
  }
  throw new Error("no landing index left");
}

export const LANDING_GAP = 5;

export async function findLandingIndices(usedOnChain: (index: number) => Promise<boolean>, gap = LANDING_GAP): Promise<number[]> {
  const found: number[] = [];
  let misses = 0;
  for (let i = 0; i <= MAX_LANDING_INDEX && misses < gap; i++) {
    if (await usedOnChain(i)) { found.push(i); misses = 0; } else misses++;
  }
  return found;
}
