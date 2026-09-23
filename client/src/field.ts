import { buildPoseidon } from "circomlibjs";

export const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export type Field = bigint;

type PoseidonFn = (inputs: bigint[]) => bigint;

let poseidonPromise: Promise<PoseidonFn> | null = null;

/** Poseidon over BN254 with the circomlib parameter set, returning a bigint. */
export function poseidon(): Promise<PoseidonFn> {
  // One shared instance, so the tree, notes and nullifiers use the same parameter set.
  return (poseidonPromise ??= buildPoseidon().then((instance: any) => {
    const F = instance.F;
    return (inputs: bigint[]) => BigInt(F.toString(instance(inputs)));
  }));
}

export function assertInField(x: bigint, what = "value"): bigint {
  if (x < 0n || x >= FIELD_SIZE) throw new RangeError(`${what} is not a field element`);
  return x;
}

/** Reduce an arbitrary-length big-endian byte string into the field. */
export function bytesToField(bytes: Uint8Array): Field {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x % FIELD_SIZE;
}

export function fieldToBytes32(x: Field): Uint8Array {
  assertInField(x);
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function bytes32ToField(b: Uint8Array): Field {
  if (b.length !== 32) throw new RangeError("expected 32 bytes");
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return assertInField(x);
}

/** A token's field element: its address as a uint160. */
export function addressToField(address: string): Field {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new RangeError("bad address");
  return BigInt(address);
}
