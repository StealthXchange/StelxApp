"use client";

import { get, set } from "idb-keyval";
import { ARTIFACTS } from "./config.ts";
import HASHES from "./artifact-hashes.json";

const VERSION = HASHES.zkey.slice(0, 16);
const KEY = (name: string) => `stelx.pool.${VERSION}.${name}`;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface LoadedArtifacts {
  wasm: Uint8Array;
  zkey: Uint8Array;
  verificationKey: object;
}

export type Progress = (loaded: number, total: number) => void;

let inFlight: Promise<LoadedArtifacts> | null = null;

async function fetchWithProgress(url: string, onProgress: (n: number) => void): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download ${url}: ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(value.length);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

export async function artifactsCached(): Promise<boolean> {
  try {
    return Boolean(await get(KEY("zkey")) && await get(KEY("wasm")));
  } catch {
    return false;
  }
}

export function loadArtifacts(onProgress?: Progress): Promise<LoadedArtifacts> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let wasm: Uint8Array | undefined;
    let zkey: Uint8Array | undefined;
    let vkey: object | undefined;
    try {
      wasm = await get(KEY("wasm"));
      zkey = await get(KEY("zkey"));
      vkey = await get(KEY("vkey"));
    } catch {  }

    if (wasm && zkey && vkey) {
      onProgress?.(ARTIFACTS.totalBytes, ARTIFACTS.totalBytes);
      return { wasm, zkey, verificationKey: vkey };
    }

    let loaded = 0;
    const bump = (n: number) => { loaded += n; onProgress?.(loaded, ARTIFACTS.totalBytes); };

    const [w, z, v] = await Promise.all([
      fetchWithProgress(ARTIFACTS.wasm, bump),
      fetchWithProgress(ARTIFACTS.zkey, bump),
      fetch(ARTIFACTS.verificationKey).then((r) => r.json()),
    ]);

    const [hw, hz] = await Promise.all([sha256Hex(w), sha256Hex(z)]);
    if (hz !== HASHES.zkey || hw !== HASHES.wasm) {
      throw new Error("The proving files don't match this version of the site. Reload and try again.");
    }

    try {
      await set(KEY("wasm"), w);
      await set(KEY("zkey"), z);
      await set(KEY("vkey"), v);
    } catch {  }

    return { wasm: w, zkey: z, verificationKey: v };
  })();

  inFlight.catch(() => { inFlight = null; });
  return inFlight;
}
