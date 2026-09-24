import { entropyToMnemonic, mnemonicToEntropy, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { base64urlnopad } from "@scure/base";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { CHAIN_ID } from "./vendor/keys.ts";

export const MAX_GIFT_INDEX = 0x7fffffff;

const ENTROPY_BYTES = 16;

export function giftSeed(mnemonic: string, index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > MAX_GIFT_INDEX) throw new RangeError("bad gift index");
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error("invalid mnemonic");
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(`m/421'/${CHAIN_ID}'/0'/0'/${index}'`);
  if (!node.privateKey) throw new Error("derivation produced no private key");
  const entropy = hkdf(sha256, node.privateKey, undefined, new TextEncoder().encode(`stelx-pool/gift/v1/${index}`), ENTROPY_BYTES);
  return entropyToMnemonic(entropy, wordlist);
}

const VERSION = "1";

export function giftFragment(giftMnemonic: string): string {
  if (!validateMnemonic(giftMnemonic, wordlist)) throw new Error("invalid gift phrase");
  const entropy = mnemonicToEntropy(giftMnemonic.trim(), wordlist);
  if (entropy.length !== ENTROPY_BYTES) throw new Error("a gift phrase is twelve words");
  return `${VERSION}.${base64urlnopad.encode(entropy)}`;
}

export function giftLink(origin: string, giftMnemonic: string): string {
  return `${origin.replace(/\/+$/, "")}/gift#${giftFragment(giftMnemonic)}`;
}

export function phraseFromFragment(fragment: string): string | null {
  const m = /^#?1\.([A-Za-z0-9_-]{22})$/.exec(fragment.trim());
  if (!m) return null;

  let entropy: Uint8Array;
  try { entropy = base64urlnopad.decode(m[1]); } catch { return null; }
  if (entropy.length !== ENTROPY_BYTES) return null;
  return entropyToMnemonic(entropy, wordlist);
}

export async function nextGiftIndex(recorded: Set<number>, fundedOnChain: (index: number) => Promise<boolean>): Promise<number> {
  for (let i = 0; i <= MAX_GIFT_INDEX; i++) {
    if (recorded.has(i)) continue;
    if (!(await fundedOnChain(i))) return i;
  }
  throw new Error("no gift index left");
}

export const GIFT_GAP = 5;

export async function findGiftIndices(fundedOnChain: (index: number) => Promise<boolean>, gap = GIFT_GAP): Promise<number[]> {
  const found: number[] = [];
  let misses = 0;
  for (let i = 0; i <= MAX_GIFT_INDEX && misses < gap; i++) {
    if (await fundedOnChain(i)) { found.push(i); misses = 0; } else misses++;
  }
  return found;
}
