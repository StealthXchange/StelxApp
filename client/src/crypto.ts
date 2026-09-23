// payload   = ephemeral X25519 public (32) || nonce (24) || XChaCha20-Poly1305 ciphertext
// plaintext = version (1) || value (16, uint128 BE) || blinding (32) || token (20) || memo (rest)
import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { fieldToBytes32, bytes32ToField, type Field } from "./field.ts";
import { MAX_VALUE, type Note } from "./note.ts";

const VERSION = 0x01;
const INFO = new TextEncoder().encode("stelx-pool/note/v1");

export interface NotePlaintext extends Note {
  memo: Uint8Array;
}

export function encodePlaintext(p: NotePlaintext): Uint8Array {
  if (p.value < 0n || p.value >= 1n << 128n) throw new RangeError("value does not fit uint128");
  const out = new Uint8Array(1 + 16 + 32 + 20 + p.memo.length);
  out[0] = VERSION;
  let v = p.value;
  for (let i = 16; i >= 1; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  out.set(fieldToBytes32(p.blinding), 17);
  let t = p.token;
  for (let i = 68; i >= 49; i--) { out[i] = Number(t & 0xffn); t >>= 8n; }
  out.set(p.memo, 69);
  return out;
}

export function decodePlaintext(publicKey: Field, b: Uint8Array): NotePlaintext {
  if (b.length < 69 || b[0] !== VERSION) throw new Error("bad plaintext");
  let value = 0n;
  for (let i = 1; i <= 16; i++) value = (value << 8n) | BigInt(b[i]);
  // Anyone can send a note above the circuit's 120-bit range. It is unspendable, so it is
  // rejected as malformed, and scanners must skip it rather than fail.
  if (value > MAX_VALUE) throw new Error("value above circuit range");
  const blinding = bytes32ToField(b.slice(17, 49));
  let token = 0n;
  for (let i = 49; i <= 68; i++) token = (token << 8n) | BigInt(b[i]);
  return { publicKey, value, blinding, token, memo: b.slice(69) };
}

function symmetricKey(shared: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, undefined, INFO, 32);
}

export function encryptNote(recipientViewingPublic: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const eph = x25519.utils.randomPrivateKey();
  const ephPub = x25519.getPublicKey(eph);
  const shared = x25519.getSharedSecret(eph, recipientViewingPublic);
  const key = symmetricKey(shared);
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const ct = xchacha20poly1305(key, nonce).encrypt(plaintext);
  const out = new Uint8Array(32 + 24 + ct.length);
  out.set(ephPub, 0);
  out.set(nonce, 32);
  out.set(ct, 56);
  return out;
}

/** Returns null unless the payload was encrypted to viewingPrivate; the auth tag rejects other keys. */
export function tryDecryptNote(viewingPrivate: Uint8Array, payload: Uint8Array): Uint8Array | null {
  if (payload.length < 32 + 24 + 16) return null;
  const ephPub = payload.slice(0, 32);
  const nonce = payload.slice(32, 56);
  const ct = payload.slice(56);
  try {
    const shared = x25519.getSharedSecret(viewingPrivate, ephPub);
    return xchacha20poly1305(symmetricKey(shared), nonce).decrypt(ct);
  } catch {
    return null;
  }
}
