"use client";

import type { Address } from "viem";
import { Wallet } from "./vendor/wallet.ts";
import { keysFromMnemonic } from "./vendor/keys.ts";
import { Discovery } from "./discover.ts";
import { poolAddress, poolDeployBlock, SCAN_CHUNK } from "./config.ts";
import { assetOf, readMultiplier, type Asset } from "./assets.ts";
import { reads, storage, walletConfig } from "./walletStore.ts";
import { findGiftIndices, giftSeed, nextGiftIndex } from "./giftKeys.ts";

export interface GiftHolding {
  asset: Asset;

  balance: bigint;

  received: bigint;
  multiplier: bigint | null;
}

export interface GiftContents {

  address: string;

  funded: boolean;

  holdings: GiftHolding[];
}

async function giftAssets(giftPhrase: string): Promise<Set<Address>> {
  const keys = await keysFromMnemonic(giftPhrase);
  return new Discovery(reads(), keys, poolAddress(), poolDeployBlock(), SCAN_CHUNK).run();
}

export async function inspectGift(giftPhrase: string): Promise<GiftContents> {
  const keys = await keysFromMnemonic(giftPhrase);
  const tokens = await giftAssets(giftPhrase);
  const holdings: GiftHolding[] = [];
  for (const token of tokens) {
    const asset = assetOf(token);
    if (!asset) continue;
    const w = await Wallet.create(giftPhrase, walletConfig(asset.address));
    await w.scan();
    const received = w.getHistory().filter((h) => h.kind === "received").reduce((s, h) => s + h.value, 0n);
    holdings.push({ asset, balance: await w.getBalance(asset.address), received, multiplier: await readMultiplier(asset) });
  }
  return { address: keys.address, funded: tokens.size > 0, holdings };
}

export interface GiftRecord {
  index: number;
  asset: Address;

  amount: string;

  at: number;

  takenBack?: boolean;
}

const recordKey = (address: string) => `stelx.pool.v1.gifts.${address.slice(6, 26)}`;

export function loadGifts(address: string): GiftRecord[] {
  try {
    const raw = storage()?.getItem(recordKey(address));
    const list = raw ? (JSON.parse(raw) as GiftRecord[]) : [];
    return Array.isArray(list) ? list.filter((r) => Number.isInteger(r?.index)) : [];
  } catch {
    return [];
  }
}

function writeGifts(address: string, list: GiftRecord[]): void {
  try { storage()?.setItem(recordKey(address), JSON.stringify(list)); } catch {  }
}

export function saveGift(address: string, r: GiftRecord): void {
  writeGifts(address, [...loadGifts(address).filter((x) => x.index !== r.index), r].sort((a, b) => a.index - b.index));
}

export function dropGift(address: string, index: number): void {
  writeGifts(address, loadGifts(address).filter((x) => x.index !== index));
}

export async function allocateGift(phrase: string, address: string): Promise<{ index: number; giftPhrase: string; giftAddress: string }> {
  const recorded = new Set(loadGifts(address).map((r) => r.index));
  const index = await nextGiftIndex(recorded, async (i) => (await giftAssets(giftSeed(phrase, i))).size > 0);
  const giftPhrase = giftSeed(phrase, index);
  return { index, giftPhrase, giftAddress: (await keysFromMnemonic(giftPhrase)).address };
}

export async function findGifts(phrase: string, address: string, progress?: (index: number) => void): Promise<number> {
  const known = new Set(loadGifts(address).map((r) => r.index));
  const found: GiftRecord[] = [];
  await findGiftIndices(async (i) => {
    progress?.(i);
    if (known.has(i)) return true;
    const c = await inspectGift(giftSeed(phrase, i));
    const h = c.holdings[0];
    if (c.funded && h) found.push({ index: i, asset: h.asset.address, amount: h.received.toString(), at: 0 });
    return c.funded;
  });
  for (const r of found) saveGift(address, r);
  return found.length;
}
