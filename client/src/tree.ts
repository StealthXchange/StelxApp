// The contract inserts a transact's first two outputs as one pair when they start at an even index,
// so the root after only the first never exists on chain. Prove against roots from chain events.
import { poseidon, type Field } from "./field.ts";

export const TREE_DEPTH = 24;
export const TREE_CAPACITY = 1 << TREE_DEPTH;

export interface MerklePath {
  leafIndex: number;
  elements: Field[]; // siblings, leaf level first
}

export class MerkleTree {
  private levels: Field[][] = [];
  private zeros: Field[] = [];
  private H!: (inputs: bigint[]) => bigint;

  private constructor() {}

  static async create(leaves: Field[] = []): Promise<MerkleTree> {
    const t = new MerkleTree();
    t.H = await poseidon();
    let z = 0n;
    for (let d = 0; d <= TREE_DEPTH; d++) {
      t.zeros.push(z);
      z = t.H([z, z]);
    }
    for (let d = 0; d <= TREE_DEPTH; d++) t.levels.push([]);
    for (const l of leaves) t.insert(l);
    return t;
  }

  get size(): number {
    return this.levels[0].length;
  }

  get root(): Field {
    return this.levels[TREE_DEPTH][0] ?? this.zeros[TREE_DEPTH];
  }

  zeroAt(level: number): Field {
    return this.zeros[level];
  }

  leaf(index: number): Field {
    const l = this.levels[0][index];
    if (l === undefined) throw new RangeError(`no leaf at ${index}`);
    return l;
  }

  insert(leaf: Field): number {
    const index = this.levels[0].length;
    if (index >= TREE_CAPACITY) throw new RangeError("tree full");
    this.levels[0].push(leaf);
    let idx = index;
    for (let d = 0; d < TREE_DEPTH; d++) {
      const parent = idx >> 1;
      const left = this.levels[d][2 * parent];
      const right = this.levels[d][2 * parent + 1] ?? this.zeros[d];
      this.levels[d + 1][parent] = this.H([left, right]);
      idx = parent;
    }
    return index;
  }

  path(leafIndex: number): MerklePath {
    if (leafIndex < 0 || leafIndex >= this.size) throw new RangeError(`no leaf at ${leafIndex}`);
    const elements: Field[] = [];
    let idx = leafIndex;
    for (let d = 0; d < TREE_DEPTH; d++) {
      const sibling = idx ^ 1;
      elements.push(this.levels[d][sibling] ?? this.zeros[d]);
      idx >>= 1;
    }
    return { leafIndex, elements };
  }

  rootFromPath(leaf: Field, p: MerklePath): Field {
    let node = leaf;
    let idx = p.leafIndex;
    for (const sib of p.elements) {
      node = idx & 1 ? this.H([sib, node]) : this.H([node, sib]);
      idx >>= 1;
    }
    return node;
  }
}
