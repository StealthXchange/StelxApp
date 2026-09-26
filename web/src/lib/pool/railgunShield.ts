import { encodeFunctionData, keccak256, parseAbi, parseAbiItem, decodeEventLog, type Address, type Hex, type Log } from "viem";
import type { LocalAccount } from "viem/accounts";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";
import { ed25519 } from "@noble/curves/ed25519";
import { gcm, ctr } from "@noble/ciphers/aes";
import { poseidon } from "./vendor/field.ts";

export const SHIELD_SIGNATURE_MESSAGE = "RAILGUN_SHIELD";

export const RAILGUN_ABI = parseAbi([
  "struct TokenData { uint8 tokenType; address tokenAddress; uint256 tokenSubID; }",
  "struct CommitmentPreimage { bytes32 npk; TokenData token; uint120 value; }",
  "struct ShieldCiphertext { bytes32[3] encryptedBundle; bytes32 shieldKey; }",
  "struct ShieldRequest { CommitmentPreimage preimage; ShieldCiphertext ciphertext; }",
  "struct Call { address to; bytes data; uint256 value; }",
  "function shield(ShieldRequest[] _shieldRequests) payable",
  "function wrapBase(uint256 _amount)",
  "function multicall(bool _requireSuccess, Call[] _calls) payable",
  "function shieldFee() view returns (uint120)",
]);

export const SHIELD_EVENT = parseAbiItem(
  "event Shield(uint256 treeNumber, uint256 startPosition, (bytes32 npk, (uint8 tokenType, address tokenAddress, uint256 tokenSubID) token, uint120 value)[] commitments, (bytes32[3] encryptedBundle, bytes32 shieldKey)[] shieldCiphertext, uint256[] fees)",
);

export interface ShieldRequest {
  preimage: { npk: Hex; token: { tokenType: number; tokenAddress: Address; tokenSubID: bigint }; value: bigint };
  ciphertext: { encryptedBundle: readonly [Hex, Hex, Hex]; shieldKey: Hex };
}

export interface ShieldTo { masterPublicKey: bigint; viewingPublicKey: Uint8Array }

const MAX_VALUE = (1n << 120n) - 1n;

const hex = (b: Uint8Array): Hex => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const bytes = (h: string): Uint8Array => {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error("bad hex");
  return Uint8Array.from(s.match(/../g) ?? [], (x) => parseInt(x, 16));
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function privateScalar(privateKey: Uint8Array): bigint {
  if (privateKey.length !== 32) throw new RangeError("expected 32 bytes");
  const head = sha512(privateKey).slice(0, 32);
  head[0] &= 0xf8; head[31] &= 0x7f; head[31] |= 0x40;
  let s = 0n;
  for (let i = 31; i >= 0; i--) s = (s << 8n) | BigInt(head[i]);
  s %= ed25519.CURVE.n;

  return s > 0n ? s : ed25519.CURVE.n;
}

export function sharedKey(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const point = ed25519.ExtendedPoint.fromHex(publicKey).multiply(privateScalar(privateKey));
  return sha256(point.toRawBytes());
}

export async function shieldPrivateKey(sender: Pick<LocalAccount, "signMessage">): Promise<Uint8Array> {
  return bytes(keccak256(await sender.signMessage({ message: SHIELD_SIGNATURE_MESSAGE })));
}

export async function notePublicKey(masterPublicKey: bigint, noteRandom: Uint8Array): Promise<bigint> {
  if (noteRandom.length !== 16) throw new RangeError("note random must be 16 bytes");
  return (await poseidon())([masterPublicKey, BigInt(hex(noteRandom))]);
}

export interface ShieldRandomness { noteRandom: Uint8Array; gcmIv: Uint8Array; ctrIv: Uint8Array }

export async function buildShieldRequest(
  to: ShieldTo, token: Address, value: bigint, shieldKey: Uint8Array, fixed?: ShieldRandomness,
): Promise<ShieldRequest> {
  if (value <= 0n || value > MAX_VALUE) throw new RangeError("shield value out of range");
  if (to.viewingPublicKey.length !== 32 || shieldKey.length !== 32) throw new RangeError("keys must be 32 bytes");
  const noteRandom = fixed?.noteRandom ?? random(16);
  const gcmIv = fixed?.gcmIv ?? random(16);
  const ctrIv = fixed?.ctrIv ?? random(16);
  if (noteRandom.length !== 16 || gcmIv.length !== 16 || ctrIv.length !== 16) throw new RangeError("randomness must be 16 bytes each");

  const sealed = gcm(sharedKey(shieldKey, to.viewingPublicKey), gcmIv).encrypt(noteRandom);
  const [ct, tag] = [sealed.slice(0, 16), sealed.slice(16, 32)];

  const receiver = ctr(shieldKey, ctrIv).encrypt(to.viewingPublicKey);

  return {
    preimage: {
      npk: `0x${(await notePublicKey(to.masterPublicKey, noteRandom)).toString(16).padStart(64, "0")}`,
      token: { tokenType: 0, tokenAddress: token, tokenSubID: 0n },
      value,
    },
    ciphertext: {
      encryptedBundle: [hex(concat(gcmIv, tag)), hex(concat(ct, ctrIv)), hex(receiver)],
      shieldKey: hex(ed25519.getPublicKey(shieldKey)),
    },
  };
}

export function shieldBaseTokenTx(relayAdapt: Address, request: ShieldRequest): { to: Address; data: Hex; value: bigint } {
  const value = request.preimage.value;
  const calls = [
    { to: relayAdapt, data: encodeFunctionData({ abi: RAILGUN_ABI, functionName: "wrapBase", args: [value] }), value: 0n },
    { to: relayAdapt, data: encodeFunctionData({ abi: RAILGUN_ABI, functionName: "shield", args: [[request]] }), value: 0n },
  ];
  return { to: relayAdapt, data: encodeFunctionData({ abi: RAILGUN_ABI, functionName: "multicall", args: [true, calls] }), value };
}

export function shieldTokenTx(proxy: Address, request: ShieldRequest): { to: Address; data: Hex; value: bigint } {
  return { to: proxy, data: encodeFunctionData({ abi: RAILGUN_ABI, functionName: "shield", args: [[request]] }), value: 0n };
}

export interface ShieldEvent {
  treeNumber: bigint;
  startPosition: bigint;
  commitments: readonly { npk: Hex; token: { tokenType: number; tokenAddress: Address; tokenSubID: bigint }; value: bigint }[];
  ciphertexts: readonly { encryptedBundle: readonly Hex[]; shieldKey: Hex }[];
  fees: readonly bigint[];
}

export function shieldEvents(logs: readonly Log[], proxy: Address): ShieldEvent[] {
  const out: ShieldEvent[] = [];
  for (const l of logs) {
    if (l.address.toLowerCase() !== proxy.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: [SHIELD_EVENT], data: l.data, topics: l.topics });
      const a = ev.args;
      out.push({ treeNumber: a.treeNumber, startPosition: a.startPosition, commitments: a.commitments, ciphertexts: a.shieldCiphertext, fees: a.fees });
    } catch {  }
  }
  return out;
}

export async function recognisesShield(
  wallet: { masterPublicKey: bigint; viewingPrivateKey: Uint8Array },
  commitment: { npk: Hex },
  ciphertext: { encryptedBundle: readonly Hex[]; shieldKey: Hex },
): Promise<boolean> {
  try {
    const b0 = bytes(ciphertext.encryptedBundle[0]);
    const b1 = bytes(ciphertext.encryptedBundle[1]);
    const key = sharedKey(wallet.viewingPrivateKey, bytes(ciphertext.shieldKey));
    const noteRandom = gcm(key, b0.slice(0, 16)).decrypt(concat(b1.slice(0, 16), b0.slice(16, 32)));
    return (await notePublicKey(wallet.masterPublicKey, noteRandom)) === BigInt(commitment.npk);
  } catch {
    return false;
  }
}
