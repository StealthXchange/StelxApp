"use client";

import type { Address, Hex, PublicClient } from "viem";
import { POOL_ABI } from "./vendor/wallet.ts";
import { decodePlaintext, tryDecryptNote } from "./vendor/crypto.ts";
import { commitmentOf } from "./vendor/note.ts";
import { addressToField, bytes32ToField } from "./vendor/field.ts";
import type { WalletKeys } from "./vendor/keys.ts";
import { ASSETS } from "./assets.ts";

const EVENTS = POOL_ABI.filter(
  (x) => x.type === "event" && (x.name === "Shield" || x.name === "Transact" || x.name === "OutputsDropped" || x.name === "Exit" || x.name === "ExitFee"),
) as any;

const byField = new Map(ASSETS.map((a) => [addressToField(a.address).toString(), a.address]));

const bytes = (h: Hex) => Uint8Array.from((h.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16)));

export class Discovery {
  readonly found = new Set<Address>();
  private to = 0n;
  private hash: Hex | null = null;

  constructor(
    private client: PublicClient,
    private keys: WalletKeys,
    private pool: Address,
    private deployBlock: bigint,
    private chunk: bigint,
  ) {}

  async run(): Promise<Set<Address>> {
    const latest = await this.client.getBlockNumber();

    if (this.to !== 0n) {
      const now = await this.client.getBlock({ blockNumber: this.to }).then((b) => b.hash, () => null);
      if (now !== this.hash) { this.found.clear(); this.to = 0n; this.hash = null; }
    }
    let from = this.to === 0n ? this.deployBlock : this.to + 1n;
    while (from <= latest) {
      const to = from + this.chunk - 1n > latest ? latest : from + this.chunk - 1n;
      const hash = (await this.client.getBlock({ blockNumber: to })).hash as Hex;
      for (const log of await this.logs(from, to)) await this.read(log);
      this.to = to; this.hash = hash;
      from = to + 1n;
    }
    return this.found;
  }

  private async logs(from: bigint, to: bigint): Promise<any[]> {
    try {
      return await this.client.getLogs({ address: this.pool, events: EVENTS, fromBlock: from, toBlock: to }) as any[];
    } catch (e: any) {
      const msg = String(e?.details ?? e?.shortMessage ?? e?.message ?? e);
      if (!/exceeds? (the )?limit|query returned more than|too many results|response size|block range/i.test(msg) || to <= from) throw e;
      const mid = from + (to - from) / 2n;
      return [...await this.logs(from, mid), ...await this.logs(mid + 1n, to)];
    }
  }

  private async read(log: any): Promise<void> {
    if (log.eventName === "Shield") {
      const blob = bytes(log.args.encryptedNote as Hex);
      const publicKey = bytes32ToField(blob.slice(0, 32));
      if (publicKey !== this.keys.spending.publicKey) return;
      const token = addressToField(log.args.token as string);
      const note = { publicKey, token, value: bytes32ToField(blob.slice(64, 96)), blinding: bytes32ToField(blob.slice(32, 64)) };
      if (note.value > 0n && (await commitmentOf(note)) === log.args.commitment) this.add(token);
      return;
    }
    const pairs: [bigint, Hex][] =
      log.eventName === "Transact" ? (log.args.commitments as bigint[]).map((c, i) => [c, (log.args.encryptedNotes as Hex[])[i]])
      : log.eventName === "ExitFee" ? [[log.args.commitment as bigint, log.args.encryptedNote as Hex]]
      : [];
    for (const [commitment, payload] of pairs) {
      if (!payload) continue;
      const pt = tryDecryptNote(this.keys.viewing.privateKey, bytes(payload));
      if (!pt) continue;
      try {
        const note = decodePlaintext(this.keys.spending.publicKey, pt);
        if (note.value > 0n && (await commitmentOf(note)) === commitment) this.add(note.token);
      } catch {  }
    }
  }

  private add(token: bigint): void {
    const a = byField.get(token.toString());
    if (a) this.found.add(a);
  }
}
