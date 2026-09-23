import { poseidon, assertInField, type Field } from "./field.ts";

export interface Note {
  publicKey: Field;
  token: Field;     // address as uint160
  value: bigint;    // < 2^120, matching the circuit range
  blinding: Field;
}

export const MAX_VALUE = (1n << 120n) - 1n;

export async function publicKeyOf(privateKey: Field): Promise<Field> {
  const H = await poseidon();
  return H([assertInField(privateKey, "privateKey")]);
}

export async function commitmentOf(n: Note): Promise<Field> {
  if (n.value < 0n || n.value > MAX_VALUE) throw new RangeError("note value out of range");
  const H = await poseidon();
  return H([
    assertInField(n.publicKey, "publicKey"),
    assertInField(n.token, "token"),
    n.value,
    assertInField(n.blinding, "blinding"),
  ]);
}

// nullifier = Poseidon([privateKey, leafIndex]). It does not bind the note contents;
// the circuit's Merkle inclusion check pins which note sits at leafIndex.
export async function nullifierOf(privateKey: Field, leafIndex: number): Promise<Field> {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= 1 << 24) {
    throw new RangeError("leafIndex out of range for a depth-24 tree");
  }
  const H = await poseidon();
  return H([assertInField(privateKey, "privateKey"), BigInt(leafIndex)]);
}

export function randomBlinding(): Field {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  // 512 bits reduced into a 254-bit field: bias on the order of 2^-258.
  return x % 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
}
