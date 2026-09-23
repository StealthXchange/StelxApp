import { mnemonicToSeedSync, validateMnemonic, generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { x25519 } from "@noble/curves/ed25519";
import { FIELD_SIZE, fieldToBytes32, bytes32ToField, type Field } from "./field.ts";
import { publicKeyOf } from "./note.ts";

export const CHAIN_ID = 46630;

export interface SpendingKey {
  /** BN254 scalar, used as a private circuit input. Never leaves the client. */
  privateKey: Field;
  /** Poseidon([privateKey]); the owner field of every note. */
  publicKey: Field;
}

export interface ViewingKey {
  privateKey: Uint8Array; // X25519 scalar, 32 bytes
  publicKey: Uint8Array;  // X25519 point, 32 bytes
}

export interface WalletKeys {
  spending: SpendingKey;
  viewing: ViewingKey;
  address: string;
}

function bytesToBigInt(b: Uint8Array): bigint {
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return x;
}

// 64 HKDF bytes reduced into the field: bias near 2^-258. 32 bytes would give a bias near 2^-2.
function deriveSpendingScalar(ikm: Uint8Array, index: number): Field {
  for (let attempt = 0; attempt < 8; attempt++) {
    const info = new TextEncoder().encode(`stelx-pool/spend/v1/${index}/${attempt}`);
    const wide = hkdf(sha256, ikm, undefined, info, 64);
    const k = bytesToBigInt(wide) % FIELD_SIZE;
    if (k !== 0n) return k;
  }
  throw new Error("unreachable: eight zero scalars in a row");
}

export function newMnemonic(strength: 128 | 256 = 128): string {
  return generateMnemonic(wordlist, strength);
}

export async function keysFromMnemonic(mnemonic: string, index = 0, passphrase = ""): Promise<WalletKeys> {
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error("invalid mnemonic");
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
  const master = HDKey.fromMasterSeed(seed);

  // Both paths are fully hardened, so neither key can be derived from the other.
  const spendNode = master.derive(`m/44'/${CHAIN_ID}'/0'/0'/${index}'`);
  const viewNode = master.derive(`m/420'/${CHAIN_ID}'/0'/0'/${index}'`);
  if (!spendNode.privateKey || !viewNode.privateKey) throw new Error("derivation produced no private key");

  const privateKey = deriveSpendingScalar(spendNode.privateKey, index);
  const publicKey = await publicKeyOf(privateKey);

  const viewingPrivate = hkdf(
    sha256, viewNode.privateKey, undefined,
    new TextEncoder().encode(`stelx-pool/view/v1/${index}`), 32,
  );
  const viewingPublic = x25519.getPublicKey(viewingPrivate);

  const address = encodeAddress(publicKey, viewingPublic);
  return {
    spending: { privateKey, publicKey },
    viewing: { privateKey: viewingPrivate, publicKey: viewingPublic },
    address,
  };
}

const PREFIX = "stelx1";

/** address = publicKey (32) || viewingPublic (32), hex, with a 4-byte sha256 checksum. */
export function encodeAddress(publicKey: Field, viewingPublic: Uint8Array): string {
  if (viewingPublic.length !== 32) throw new RangeError("viewing public key must be 32 bytes");
  const body = new Uint8Array(64);
  body.set(fieldToBytes32(publicKey), 0);
  body.set(viewingPublic, 32);
  const check = sha256(body).slice(0, 4);
  return PREFIX + toHex(body) + toHex(check);
}

export function decodeAddress(address: string): { publicKey: Field; viewingPublic: Uint8Array } {
  if (!address.startsWith(PREFIX) || address.length !== PREFIX.length + 136) throw new Error("bad address");
  const hex = address.slice(PREFIX.length);
  const body = fromHex(hex.slice(0, 128));
  const check = fromHex(hex.slice(128));
  const expect = sha256(body).slice(0, 4);
  if (!equal(check, expect)) throw new Error("bad address checksum");
  return { publicKey: bytes32ToField(body.slice(0, 32)), viewingPublic: body.slice(32, 64) };
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromHex(h: string): Uint8Array {
  if (h.length % 2 || /[^0-9a-fA-F]/.test(h)) throw new Error("bad hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
