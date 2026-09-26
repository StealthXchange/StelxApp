import { mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { CHAIN_ID } from "./vendor/keys.ts";

export const MAX_DARK_INDEX = 0x7fffffff;

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export function darkLandingKey(mnemonic: string, index: number): `0x${string}` {
  if (!Number.isInteger(index) || index < 0 || index > MAX_DARK_INDEX) throw new RangeError("bad landing index");
  const words = mnemonic.trim().replace(/\s+/g, " ");
  if (!validateMnemonic(words, wordlist)) throw new Error("invalid mnemonic");
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(words)).derive(`m/423'/${CHAIN_ID}'/0'/0'/${index}'`);
  if (!node.privateKey) throw new Error("derivation produced no private key");
  const k = hkdf(sha256, node.privateKey, undefined, new TextEncoder().encode(`stelx-pool/dark/v1/${index}`), 32);
  const n = BigInt(`0x${bytesToHex(k)}`);

  if (n === 0n || n >= N) throw new Error("landing key out of range");
  return `0x${bytesToHex(k)}`;
}
