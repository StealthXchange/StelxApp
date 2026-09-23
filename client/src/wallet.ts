import { encodeFunctionData, parseAbi, type Hex, type PublicClient } from "viem";
import { addressToField, fieldToBytes32, bytes32ToField, type Field } from "./field.ts";
import { commitmentOf, nullifierOf, randomBlinding, type Note } from "./note.ts";
import { MerkleTree, TREE_CAPACITY, TREE_DEPTH } from "./tree.ts";
import { keysFromMnemonic, decodeAddress, toHex, type WalletKeys } from "./keys.ts";
import { encodePlaintext, decodePlaintext, encryptNote, tryDecryptNote } from "./crypto.ts";
import { prove, N_INS, type InputNote, type OutputNote, type BoundParams, type ProvingArtifacts } from "./prover.ts";

export const POOL_ABI = parseAbi([
  "function shield(address token, uint256 amount, bytes encryptedNote)",
  "function transact(bytes proof, (uint256 root, uint256[] nullifiers, uint256[] commitments, int256 extAmount, address recipient, address broadcaster, uint256 fee, bytes[] encryptedNotes, address token, bool isExit) inputs)",
  "function isNullifierSpent(uint256 nullifier) view returns (bool)",
  "function merkleRoot() view returns (uint256)",
  "function nextLeafIndex() view returns (uint256)",
  "function TREE_DEPTH() view returns (uint256)",
  "event Shield(uint256 leafIndex, uint256 commitment, address token, bytes encryptedNote)",
  "event Transact(uint256[] nullifiers, uint256[] commitments, bytes[] encryptedNotes)",
  // Outputs a full tree did not insert on chain; the scanner must not insert them either.
  "event OutputsDropped(uint256[] commitments)",
  "event Exit(uint256[] nullifiers)",
  "event ExitFee(uint256 commitment, bytes encryptedNote)",
]);

/** The events scanning reads, selected by name so ABI edits cannot shift them. */
const POOL_EVENTS = POOL_ABI.filter(
  (x) => x.type === "event" && (x.name === "Shield" || x.name === "Transact" || x.name === "OutputsDropped" || x.name === "Exit" || x.name === "ExitFee"),
) as any;

function rateLimited(e: any, msg: string): boolean {
  for (let x = e; x; x = x.cause) if (x?.status === 429 || x?.code === 429) return true;
  return /\b429\b|too many requests|rate limit/i.test(msg);
}

export interface WalletConfig {
  client: PublicClient;
  pool: Hex;
  token: Hex;
  chainId: bigint;
  /** Block the pool was deployed in; scanning starts here. */
  deployBlock: bigint;
  /** EVM address of the broadcaster that submits built transactions. Bound into every proof. */
  broadcaster: Hex;
  /** The broadcaster's stelx1 address. The fee is a note to this key, not an on-chain
   *  transfer, so a private send moves no value out of the pool and reveals no asset. */
  broadcasterAddress: string;
  /** Fee paid to the broadcaster from inside the pool, per transaction. */
  fee: bigint;
  artifacts: ProvingArtifacts;
  /** Blocks per eth_getLogs call. Unset: one request for the whole range, split
   *  only when the RPC rejects the result size. */
  logChunk?: bigint;
}

export interface OwnedNote extends Note {
  leafIndex: number;
  spent: boolean;
  source:"shield" | "transact";
  blockNumber: bigint;
}

export interface HistoryEntry {
  kind: "received" | "spent";
  leafIndex: number;
  value: bigint;
  blockNumber: bigint;
}

export interface BuiltTx {
  to: Hex;
  data: Hex;
  /** Human-readable summary, never needed to submit. */
  summary: string;
  /** Tree root once this transaction is mined, as the prover computed it. 0 for a shield. */
  newRoot: Field;
}

/** Protocol fee in basis points. Must equal ShieldedPool.FEE_BPS. */
export const FEE_BPS = 10n;
export const BPS = 10_000n;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Hex;
const MEMO_SPENT = 0x02;

/** Bytes per slot: TREE_DEPTH + 1 bits, so the all-ones sentinel is never a valid leaf index. */
const MEMO_SLOT_BYTES = Math.ceil((TREE_DEPTH + 1) / 8);
/** All-ones marks an unused slot. */
const MEMO_NONE = 2 ** (8 * MEMO_SLOT_BYTES) - 1;

/** Memo: one MEMO_SPENT byte, then N_INS big-endian slots, unused ones MEMO_NONE.
 *  Constant length so every note ciphertext is the same size. */
export function encodeSpentMemo(leafIndices: number[]): Uint8Array {
  if (leafIndices.length > N_INS) throw new Error("too many spent indices");
  const out = new Uint8Array(1 + MEMO_SLOT_BYTES * N_INS);
  out[0] = MEMO_SPENT;
  for (let k = 0; k < N_INS; k++) {
    const i = k < leafIndices.length ? leafIndices[k] : MEMO_NONE;
    if (i !== MEMO_NONE && (!Number.isInteger(i) || i < 0 || i >= TREE_CAPACITY)) {
      throw new RangeError(`leaf index ${i} does not fit a depth-${TREE_DEPTH} memo slot`);
    }
    // Big-endian.
    for (let b = 0; b < MEMO_SLOT_BYTES; b++) {
      out[1 + MEMO_SLOT_BYTES * k + b] = (i >>> (8 * (MEMO_SLOT_BYTES - 1 - b))) & 0xff;
    }
  }
  return out;
}

export function decodeSpentMemo(memo: Uint8Array): number[] {
  if (memo.length !== 1 + MEMO_SLOT_BYTES * N_INS || memo[0] !== MEMO_SPENT) return [];
  const out: number[] = [];
  for (let k = 0; k < N_INS; k++) {
    let i = 0;
    for (let b = 0; b < MEMO_SLOT_BYTES; b++) {
      i = i * 256 + memo[1 + MEMO_SLOT_BYTES * k + b];
    }
    if (i !== MEMO_NONE) out.push(i);
  }
  return out;
}

/** Local notes and tree are a cache of chain state. Built calldata binds recipient,
 *  amount, fee and broadcaster into the proof, so altering it fails verification. */
export class Wallet {
  readonly keys: WalletKeys;
  readonly cfg: WalletConfig;
  private tree!: MerkleTree;
  private notes: OwnedNote[] = [];
  private history: HistoryEntry[] = [];
  /** nullifier -> block it was published in, so a spend is dated by the chain, not the scan. */
  private seenNullifiers = new Map<string, bigint>();
  private inflight: Promise<{ leaves: number; owned: number; unspent: number }> | null = null;
  // Commitments from OutputsDropped, as strings. The paired Transact log (same tx,
  // higher logIndex) is always ingested after it and must skip them.
  private droppedCommitments = new Set<string>();
  private scannedTo = 0n;
  /** Hash of block scannedTo, read before its logs. A different hash later means a reorg. */
  private scannedHash: Hex | null = null;
  private viewOnly: boolean;

  private constructor(keys: WalletKeys, cfg: WalletConfig, viewOnly: boolean) {
    this.keys = keys;
    this.cfg = cfg;
    this.viewOnly = viewOnly;
  }

  static async create(mnemonic: string, cfg: WalletConfig): Promise<Wallet> {
    const keys = await keysFromMnemonic(mnemonic);
    const w = new Wallet(keys, cfg, false);
    w.tree = await MerkleTree.create();
    return w;
  }

  /** A wallet that can decrypt and rebuild history but cannot spend. */
  static async createViewOnly(address: string, viewingPrivate: Uint8Array, cfg: WalletConfig): Promise<Wallet> {
    const d = decodeAddress(address);
    const keys: WalletKeys = {
      spending: { privateKey: 0n, publicKey: d.publicKey },
      viewing: { privateKey: viewingPrivate, publicKey: d.viewingPublic },
      address,
    };
    const w = new Wallet(keys, cfg, true);
    w.tree = await MerkleTree.create();
    return w;
  }

  getAddress(): string {
    return this.keys.address;
  }

  /** Rebuild the tree and this wallet's notes from chain state. Idempotent. */
  scan(): Promise<{ leaves: number; owned: number; unspent: number }> {
    // One scan at a time: overlapping scans would ingest the same logs twice.
    return (this.inflight ??= this.scanOnce().finally(() => { this.inflight = null; }));
  }

  private async reset(): Promise<void> {
    this.tree = await MerkleTree.create();
    this.notes = []; this.history = [];
    this.seenNullifiers = new Map(); this.droppedCommitments = new Set();
    this.scannedTo = 0n; this.scannedHash = null;
  }

  private async scanOnce(attempt = 0): Promise<{ leaves: number; owned: number; unspent: number }> {
    const latest = await this.cfg.client.getBlockNumber({ cacheTime: 0 });
    // A reorg at or below scannedTo changes its hash, or removes the block: rebuild rather than
    // keep state from a dropped branch.
    if (this.scannedTo !== 0n) {
      const h = await this.blockHash(this.scannedTo);
      if (h === null || h !== this.scannedHash) await this.reset();
    }
    const chunk = this.cfg.logChunk;
    let from = this.scannedTo === 0n ? this.cfg.deployBlock : this.scannedTo + 1n;

    const committed: [bigint, Hex | null][] = [];
    // Skip when nothing is new; not every RPC accepts fromBlock > toBlock.
    while (from <= latest) {
      const to = chunk === undefined || from + chunk - 1n > latest ? latest : from + chunk - 1n;
      // Read before the logs: a reorg in between then shows as a mismatch on the next scan.
      const hash = await this.blockHash(to);
      const logs = await this.fetchLogs(from, to);
      await this.ingestAll(logs);
      // Commit per range so a retry after a failed call does not re-ingest.
      this.scannedTo = to; this.scannedHash = hash;
      committed.push([to, hash]);
      from = to + 1n;
    }

    // Check the root as well as the size: a divergence can keep the leaf count.
    const [onChain, chainRoot] = await Promise.all([
      this.cfg.client.readContract({ address: this.cfg.pool, abi: POOL_ABI, functionName: "nextLeafIndex", blockNumber: latest }),
      this.cfg.client.readContract({ address: this.cfg.pool, abi: POOL_ABI, functionName: "merkleRoot", blockNumber: latest }),
    ]);
    if (BigInt(this.tree.size) !== onChain || this.tree.root !== chainRoot) {
      const msg = `tree desynchronised at block ${latest}: local ${this.tree.size} leaves, chain ${onChain}` +
        (this.tree.root !== chainRoot ? "; roots differ" : "");
      // Drop local state so the next scan rebuilds from the deploy block.
      await this.reset();
      throw new Error(msg);
    }
    // A reorg during this scan into a range already read leaves a later boundary consistent but
    // that range stale: every boundary committed here must still hold.
    for (const [n, hash] of committed) {
      const now = await this.blockHash(n);
      if (now === null || now !== hash) {
        await this.reset();
        if (attempt >= 2) throw new Error(`chain reorganised during the scan at block ${n}`);
        return this.scanOnce(attempt + 1);
      }
    }
    await this.refreshSpent();

    return {
      leaves: this.tree.size,
      owned: this.notes.length,
      unspent: this.notes.filter((n) => !n.spent).length,
    };
  }

  /** One range, bisected only when the RPC refuses on result size. Sorted here by
   *  (blockNumber, logIndex) so leaf indices line up with the chain. */
  private async fetchLogs(from: bigint, to: bigint, attempt = 0): Promise<unknown[]> {
    let logs: any[];
    try {
      logs = await this.cfg.client.getLogs({
        address: this.cfg.pool, events: POOL_EVENTS, fromBlock: from, toBlock: to,
      }) as any[];
    } catch (e: any) {
      const msg = String(e?.details ?? e?.shortMessage ?? e?.message ?? e);
      // A 429 is a rate limit, not an oversized result: back off and retry the same range.
      if (rateLimited(e, msg)) {
        if (attempt >= 6) throw e;
        const wait = Math.min(8000, 400 * 2 ** attempt) * (0.5 + Math.random());
        await new Promise((r) => setTimeout(r, wait));
        return this.fetchLogs(from, to, attempt + 1);
      }
      // Split only on a result-set or block-range cap.
      const tooMany = /exceeds? (the )?limit|query returned more than|too many results|response size|block range/i.test(msg);
      if (!tooMany || to <= from) throw e;
      const mid = from + (to - from) / 2n;
      return [...await this.fetchLogs(from, mid), ...await this.fetchLogs(mid + 1n, to)];
    }
    logs.sort((a, b) => a.blockNumber === b.blockNumber
      ? Number(a.logIndex) - Number(b.logIndex)
      : (a.blockNumber < b.blockNumber ? -1 : 1));
    return logs;
  }

  /** Null when the chain has no block at that height, as after a reorg to a shorter branch. */
  private async blockHash(n: bigint): Promise<Hex | null> {
    try {
      return (await this.cfg.client.getBlock({ blockNumber: n })).hash as Hex;
    } catch (e: any) {
      if (e?.name === "BlockNotFoundError") return null;
      throw e;
    }
  }

  /** Local state is a cache: a throw partway through leaves it ahead of scannedTo, so drop it. */
  private async ingestAll(logs: unknown[]): Promise<void> {
    try {
      for (const log of logs) await this.ingest(log as any);
    } catch (e) {
      await this.reset();
      throw e;
    }
  }

  private async ingest(log: any): Promise<void> {
    const tokenField = addressToField(this.cfg.token);
    if (log.eventName === "Shield") {
      // Insert the published leaf as-is: every shield enters the tree, whatever its asset.
      const commitment = log.args.commitment as bigint;
      const leafIndex = this.tree.insert(commitment);
      if (BigInt(leafIndex) !== BigInt(log.args.leafIndex)) {
        throw new Error(`leaf index drift at ${leafIndex}: chain says ${log.args.leafIndex}`);
      }
      // Credit only notes to this wallet's key in this wallet's asset; other assets
      // belong to that asset's wallet and would fail as spend inputs here.
      if ((log.args.token as Hex).toLowerCase() !== this.cfg.token.toLowerCase()) return;
      const blob = hexToBytes(log.args.encryptedNote as Hex);
      const publicKey = bytes32ToField(blob.slice(0, 32));
      if (publicKey !== this.keys.spending.publicKey) return;
      const blinding = bytes32ToField(blob.slice(32, 64));
      const value = bytes32ToField(blob.slice(64, 96));
      const note: Note = { publicKey, token: tokenField, value, blinding };
      // Credit only if the blob re-hashes to the on-chain leaf.
      if ((await commitmentOf(note)) !== commitment) return;
      this.notes.push({ ...note, leafIndex, spent: false, source: "shield", blockNumber: log.blockNumber });
      this.history.push({ kind: "received", leafIndex, value, blockNumber: log.blockNumber });
      return;
    }

    if (log.eventName === "OutputsDropped") {
      for (const c of log.args.commitments as bigint[]) this.droppedCommitments.add(c.toString());
      return;
    }

    // A relayed exit inserts one leaf, the relay's fee note; every wallet must insert it.
    if (log.eventName === "ExitFee") {
      const commitment = log.args.commitment as bigint;
      const leafIndex = this.tree.insert(commitment);
      const pt = tryDecryptNote(this.keys.viewing.privateKey, hexToBytes(log.args.encryptedNote as Hex));
      if (pt) {
        try {
          const note = decodePlaintext(this.keys.spending.publicKey, pt);
          if (note.token === tokenField && (await commitmentOf(note)) === commitment) {
            this.notes.push({ ...note, leafIndex, spent: false, source: "transact", blockNumber: log.blockNumber });
            this.history.push({ kind: "received", leafIndex, value: note.value, blockNumber: log.blockNumber });
          }
        } catch { /* malformed: skip, never fatal */ }
      }
      return;
    }

    // A full exit inserts nothing: record the nullifiers, leave the tree as it is.
    if (log.eventName === "Exit") {
      for (const n of log.args.nullifiers as bigint[]) this.seenNullifiers.set(n.toString(), log.blockNumber);
      return;
    }

    if (log.eventName === "Transact") {
      for (const n of log.args.nullifiers as bigint[]) this.seenNullifiers.set(n.toString(), log.blockNumber);
      // The event carries exactly the leaves the contract inserted: insert every one
      // and nothing else. The count comes from the event, never from calldata.
      const commitments = log.args.commitments as bigint[];
      const payloads = log.args.encryptedNotes as Hex[];
      if (commitments.length !== payloads.length) {
        // Halt rather than guess the insertion count: a wrong guess permanently desynchronises the tree.
        throw new Error(
          `Transact at block ${log.blockNumber} carries ${commitments.length} commitments and ` +
          `${payloads.length} ciphertexts; cannot determine what was inserted`,
        );
      }
      const all = commitments;
      // A fully dropped batch still spent its nullifiers (recorded above) but inserted nothing.
      const dropped = all.every((c) => this.droppedCommitments.has(c.toString()));
      if (dropped) return;
      for (let i = 0; i < commitments.length; i++) {
        const leafIndex = this.tree.insert(commitments[i]);
        const pt = tryDecryptNote(this.keys.viewing.privateKey, hexToBytes(payloads[i]));
        if (!pt) continue;
        // A note that is malformed or does not re-hash to the leaf is skipped, never fatal:
        // anyone can encrypt arbitrary bytes to a known address.
        let decoded;
        try {
          decoded = decodePlaintext(this.keys.spending.publicKey, pt);
          if ((await commitmentOf(decoded)) !== commitments[i]) continue;
        } catch { continue; }
        if (decoded.token !== tokenField) continue;
        this.notes.push({ ...decoded, leafIndex, spent: false, source: "transact", blockNumber: log.blockNumber });
        this.history.push({ kind: "received", leafIndex, value: decoded.value, blockNumber: log.blockNumber });
        // Anyone who knows the address can forge a spent memo, so only a view-only
        // wallet reads it; a spending wallet uses the nullifier set (refreshSpent).
        if (this.viewOnly) for (const idx of decodeSpentMemo(decoded.memo)) {
          const own = this.notes.find((n) => n.leafIndex === idx);
          if (own && !own.spent) {
            own.spent = true;
            this.history.push({ kind: "spent", leafIndex: idx, value: own.value, blockNumber: log.blockNumber });
          }
        }
      }
    }
  }


  /** Marks notes spent whose nullifiers are on chain. Spending wallets only. */
  private async refreshSpent(): Promise<void> {
    if (this.viewOnly) return;
    for (const n of this.notes) {
      if (n.spent) continue;
      const nf = await nullifierOf(this.keys.spending.privateKey, n.leafIndex);
      const at = this.seenNullifiers.get(nf.toString());
      if (at !== undefined) {
        n.spent = true;
        this.history.push({ kind: "spent", leafIndex: n.leafIndex, value: n.value, blockNumber: at });
      }
    }
  }

  async getBalance(token: Hex): Promise<bigint> {
    if (token.toLowerCase() !== this.cfg.token.toLowerCase()) return 0n;
    await this.refreshSpent();
    return this.notes.filter((n) => !n.spent).reduce((s, n) => s + n.value, 0n);
  }

  async getNotes(): Promise<OwnedNote[]> {
    await this.refreshSpent();
    return this.notes.map((n) => ({ ...n }));
  }

  /** Root of the scanned tree. Building a transaction does not move it (see BuiltTx.newRoot). */
  get merkleRoot(): Field {
    return this.tree.root;
  }

  getHistory(): HistoryEntry[] {
    return [...this.history].sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.leafIndex - b.leafIndex));
  }

  /** Deposit calldata, submitted by the depositor. `amount` is gross; the note holds the net
   *  of the protocol fee, split exactly as the contract does or the deposit reverts. */
  async buildShield(token: Hex, amount: bigint): Promise<BuiltTx & { blinding: Field; net: bigint; protocolFee: bigint }> {
    this.assertToken(token);
    const protocolFee = (amount * FEE_BPS) / BPS;   // integer division, rounds down
    const net = amount - protocolFee;
    const blinding = randomBlinding();
    const note: Note = { publicKey: this.keys.spending.publicKey, token: addressToField(token), value: net, blinding };
    const ciphertext = encryptNote(this.keys.viewing.publicKey, encodePlaintext({ ...note, memo: encodeSpentMemo([]) }));
    const blob = concat(fieldToBytes32(note.publicKey), fieldToBytes32(blinding), fieldToBytes32(net), ciphertext);
    const data = encodeFunctionData({ abi: POOL_ABI, functionName: "shield", args: [token, amount, ("0x" + toHex(blob)) as Hex] });
    return {
      to: this.cfg.pool, data, blinding, net, protocolFee,
      // Not computed: a shield does not use the prover.
      newRoot: 0n,
      summary: `shield ${amount} of ${token} (${net} after a ${protocolFee} protocol fee)`,
    };
  }

  async buildTransfer(recipientAddress: string, token: Hex, amount: bigint): Promise<BuiltTx> {
    this.assertToken(token);
    this.assertCanSpend();
    const recipient = decodeAddress(recipientAddress);
    const { inputs, sumIn } = await this.selectInputs(amount + this.cfg.fee);
    const change = sumIn - amount - this.cfg.fee;

    const relay = decodeAddress(this.cfg.broadcasterAddress);
    const outRecipient: OutputNote = { publicKey: recipient.publicKey, value: amount, blinding: randomBlinding() };
    const outChange: OutputNote = { publicKey: this.keys.spending.publicKey, value: change, blinding: randomBlinding() };
    // The fee is paid as a note, so nothing leaves the pool and the asset is never published.
    const outFee: OutputNote = { publicKey: relay.publicKey, value: this.cfg.fee, blinding: randomBlinding() };

    const tokenField = addressToField(token);
    const ct0 = encryptNote(recipient.viewingPublic, encodePlaintext({ ...outRecipient, token: tokenField, memo: encodeSpentMemo([]) }));
    const ct1 = encryptNote(this.keys.viewing.publicKey, encodePlaintext({ ...outChange, token: tokenField, memo: encodeSpentMemo(inputs.map((i) => i.leafIndex)) }));
    const ct2 = encryptNote(relay.viewingPublic, encodePlaintext({ ...outFee, token: tokenField, memo: encodeSpentMemo([]) }));

    return this.buildTransact(inputs, [outRecipient, outChange, outFee], [ct0, ct1, ct2], {
      extAmount: 0n, recipient: "0x0000000000000000000000000000000000000000",
    }, `send ${amount} to ${recipientAddress.slice(0, 14)}…`);
  }

  async buildUnshield(publicAddress: Hex, token: Hex, amount: bigint): Promise<BuiltTx> {
    this.assertToken(token);
    this.assertCanSpend();
    const { inputs, sumIn } = await this.selectInputs(amount + this.cfg.fee);
    const change = sumIn - amount - this.cfg.fee;

    const relay = decodeAddress(this.cfg.broadcasterAddress);
    const outChange: OutputNote = { publicKey: this.keys.spending.publicKey, value: change, blinding: randomBlinding() };
    const outDummy: OutputNote = { publicKey: this.keys.spending.publicKey, value: 0n, blinding: randomBlinding() };
    // Fee paid as a note here too, so the public amount is exactly what is withdrawn.
    const outFee: OutputNote = { publicKey: relay.publicKey, value: this.cfg.fee, blinding: randomBlinding() };
    const tokenField = addressToField(token);
    const ct0 = encryptNote(this.keys.viewing.publicKey, encodePlaintext({ ...outChange, token: tokenField, memo: encodeSpentMemo(inputs.map((i) => i.leafIndex)) }));
    const ct1 = encryptNote(this.keys.viewing.publicKey, encodePlaintext({ ...outDummy, token: tokenField, memo: encodeSpentMemo([]) }));
    const ct2 = encryptNote(relay.viewingPublic, encodePlaintext({ ...outFee, token: tokenField, memo: encodeSpentMemo([]) }));

    return this.buildTransact(inputs, [outChange, outDummy, outFee], [ct0, ct1, ct2], {
      extAmount: -amount, recipient: publicAddress,
    }, `unshield ${amount} to ${publicAddress}`);
  }

  /** Withdraws every note minus the relay fee. Both value outputs are proved zero, so
   *  the contract inserts at most the fee note and a full tree can still be left. */
  async buildExit(publicAddress: Hex, token: Hex): Promise<BuiltTx> {
    this.assertToken(token);
    this.assertCanSpend();
    // Spend every note, since an exit cannot carry change.
    const spendable = this.notes.filter((n) => !n.spent && n.value > 0n && n.token === addressToField(token));
    if (spendable.length === 0) throw new Error("nothing to exit");
    if (spendable.length > N_INS) throw new Error(`an exit spends at most ${N_INS} notes; consolidate first`);
    const sumIn = spendable.reduce((s, n) => s + n.value, 0n);
    if (sumIn <= this.cfg.fee) throw new Error("notes do not cover the relay fee");
    const amount = sumIn - this.cfg.fee;

    const relay = decodeAddress(this.cfg.broadcasterAddress);
    const zeroA: OutputNote = { publicKey: this.keys.spending.publicKey, value: 0n, blinding: randomBlinding() };
    const zeroB: OutputNote = { publicKey: this.keys.spending.publicKey, value: 0n, blinding: randomBlinding() };
    const outFee: OutputNote = { publicKey: relay.publicKey, value: this.cfg.fee, blinding: randomBlinding() };

    const tokenField = addressToField(token);
    const ct0 = encryptNote(this.keys.viewing.publicKey, encodePlaintext({ ...zeroA, token: tokenField, memo: encodeSpentMemo(spendable.map((i) => i.leafIndex)) }));
    const ct1 = encryptNote(this.keys.viewing.publicKey, encodePlaintext({ ...zeroB, token: tokenField, memo: encodeSpentMemo([]) }));
    const ct2 = encryptNote(relay.viewingPublic, encodePlaintext({ ...outFee, token: tokenField, memo: encodeSpentMemo([]) }));

    return this.buildTransact(spendable, [zeroA, zeroB, outFee], [ct0, ct1, ct2], {
      extAmount: -amount, recipient: publicAddress, isExit: true,
    }, `exit ${amount} to ${publicAddress}`);
  }

  private async buildTransact(
    inputs: OwnedNote[],
    outputs: OutputNote[],
    ciphertexts: Uint8Array[],
    ext: { extAmount: bigint; recipient: Hex; isExit?: boolean },
    summary: string,
  ): Promise<BuiltTx> {
    // The contract reverts when the outputs do not fit, so refuse before proving.
    const leavesNeeded = ext.isExit === true ? (this.cfg.fee > 0n ? 1 : 0) : outputs.length;
    if (this.tree.size + leavesNeeded > TREE_CAPACITY && outputs.some((o) => o.value > 0n)) {
      throw new Error("tree is full: only a full exit with zero-value outputs is possible");
    }
    // One per output note, matching the count bound into the proof.
    const encryptedNotes: Hex[] = ciphertexts.map((c) => ("0x" + toHex(c)) as Hex);
    const bound: BoundParams = {
      extAmount: ext.extAmount,
      recipient: ext.recipient,
      broadcaster: this.cfg.broadcaster,
      fee: this.cfg.fee,
      encryptedNotes,
      chainId: this.cfg.chainId,
      pool: this.cfg.pool,
    };
    const proved = await prove({
      isExit: ext.isExit === true,
      spendingKey: this.keys.spending.privateKey,
      token: addressToField(this.cfg.token),
      leaves: Array.from({ length: this.tree.size }, (_, i) => this.tree.leaf(i)),
      inputs: inputs.map((n): InputNote => ({ value: n.value, blinding: n.blinding, leafIndex: n.leafIndex })),
      outputs,
      bound,
    }, this.cfg.artifacts);

    const data = encodeFunctionData({
      abi: POOL_ABI,
      functionName: "transact",
      args: [proved.proof, {
        root: proved.root,
        nullifiers: [proved.nullifiers[0], proved.nullifiers[1]],
        commitments: [proved.commitments[0], proved.commitments[1], proved.commitments[2]],
        extAmount: bound.extAmount,
        recipient: bound.recipient,
        broadcaster: bound.broadcaster,
        fee: bound.fee,
        encryptedNotes,
        // Zero on a private send, matching publicToken; a real address would publish the asset.
        token: proved.publicToken === 0n ? ZERO_ADDRESS : (("0x" + proved.publicToken.toString(16).padStart(40, "0")) as Hex),
        // From the proof: isExit is a public signal, so the struct must match it.
        isExit: proved.isExit,
      }],
    });
    return { to: this.cfg.pool, data, summary, newRoot: proved.newRoot };
  }

  /** Largest-first, at most N_INS notes. Consolidation is a transfer to self. */
  private async selectInputs(needed: bigint): Promise<{ inputs: OwnedNote[]; sumIn: bigint }> {
    await this.refreshSpent();
    const unspent = this.notes.filter((n) => !n.spent && n.value > 0n).sort((a, b) => (a.value > b.value ? -1 : 1));
    const chosen: OwnedNote[] = [];
    let sum = 0n;
    for (const n of unspent) {
      if (chosen.length === N_INS) break;
      chosen.push(n);
      sum += n.value;
      if (sum >= needed) break;
    }
    if (sum < needed) {
      const total = unspent.reduce((s, n) => s + n.value, 0n);
      throw new Error(total >= needed
        ? `need ${needed} but no ${N_INS} notes cover it; consolidate with a transfer to yourself first`
        : `insufficient balance: have ${total}, need ${needed} including fee`);
    }
    return { inputs: chosen, sumIn: sum };
  }

  private assertToken(token: Hex): void {
    if (token.toLowerCase() !== this.cfg.token.toLowerCase()) throw new Error("this pool holds one asset only");
  }

  private assertCanSpend(): void {
    if (this.viewOnly) throw new Error("view-only wallet cannot spend");
  }
}

export async function createWallet(mnemonic: string, cfg: WalletConfig): Promise<Wallet> {
  return Wallet.create(mnemonic, cfg);
}

function hexToBytes(h: Hex): Uint8Array {
  const s = h.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
