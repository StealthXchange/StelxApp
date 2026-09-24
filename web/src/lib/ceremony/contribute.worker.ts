import * as snarkjs from "snarkjs";

type In = { zkey: ArrayBuffer; name: string; entropy: string };
type Out = { out: ArrayBuffer; hash: string } | { error: string };

self.onmessage = async (ev: MessageEvent<In>) => {
  try {
    const { zkey, name, entropy } = ev.data;
    const out: { type: "mem"; data?: Uint8Array } = { type: "mem" };
    const hash = await snarkjs.zKey.contribute(new Uint8Array(zkey), out as any, name, entropy);
    const bytes = out.data!;
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const hex = Array.from(new Uint8Array(hash as ArrayBuffer | Uint8Array), (b) => b.toString(16).padStart(2, "0")).join("");
    (self as any).postMessage({ out: buf, hash: hex } satisfies Out, [buf]);
  } catch (e: any) {
    (self as any).postMessage({ error: String(e?.message ?? e) } satisfies Out);
  }
};
