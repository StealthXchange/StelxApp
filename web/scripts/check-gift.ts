import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import {
  findGiftIndices, giftFragment, giftLink, giftSeed, nextGiftIndex, phraseFromFragment,
} from "../src/lib/pool/giftKeys.ts";
import { keysFromMnemonic } from "../src/lib/pool/vendor/keys.ts";

const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const OTHER = "legal winner thank year wave sausage worth useful legal winner thank yellow";

test("derivation is pinned", () => {
  assert.equal(giftSeed(PHRASE, 0), PINNED[0]);
  assert.equal(giftSeed(PHRASE, 1), PINNED[1]);
  assert.equal(giftSeed(PHRASE, 1000), PINNED[1000]);
});

test("each gift gets its own valid twelve-word wallet, apart from the sender's", async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const g = giftSeed(PHRASE, i);
    assert.ok(validateMnemonic(g, wordlist), `gift ${i} is a valid phrase`);
    assert.equal(g.split(" ").length, 12);
    assert.notEqual(g, PHRASE);
    seen.add(g);
  }
  assert.equal(seen.size, 8, "no two indices share a gift wallet");
  assert.notEqual(giftSeed(OTHER, 0), giftSeed(PHRASE, 0), "another phrase, other gifts");

  const sender = await keysFromMnemonic(PHRASE);
  const gift = await keysFromMnemonic(giftSeed(PHRASE, 0));
  assert.notEqual(gift.address, sender.address);
  assert.notEqual(gift.spending.privateKey, sender.spending.privateKey);
});

test("bad indices are refused", () => {
  for (const i of [-1, 1.5, 2 ** 31, Number.NaN]) assert.throws(() => giftSeed(PHRASE, i));
  assert.throws(() => giftSeed("not a phrase", 0));
});

test("a link opens exactly the gift it was made for", () => {
  for (let i = 0; i < 16; i++) {
    const g = giftSeed(PHRASE, i);
    const f = giftFragment(g);
    assert.match(f, /^1\.[A-Za-z0-9_-]{22}$/);
    assert.equal(phraseFromFragment(f), g);
    assert.equal(phraseFromFragment(`#${f}`), g);
  }
  const g = giftSeed(PHRASE, 0);
  assert.equal(giftLink("https://stelx.app/", g), `https://stelx.app/gift#${giftFragment(g)}`);
});

test("anything that is not exactly a gift link is refused", () => {
  const f = giftFragment(giftSeed(PHRASE, 0));
  const body = f.slice(2);
  const bad = [
    "",
    "#",
    body,
    `2.${body}`,
    `1.${body.slice(0, -1)}`,
    `1.${body}A`,
    `1.${body.slice(0, 10)}+${body.slice(11)}`,
    `1.${body.slice(0, 10)} ${body.slice(11)}`,
    `1.${body}&x=1`,
  ];
  for (const b of bad) assert.equal(phraseFromFragment(b), null, `refused: ${JSON.stringify(b)}`);

  const last = body.at(-1)!;
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const v = B64.indexOf(last);
  for (let pad = 1; pad < 16; pad++) {
    const alt = B64[(v & 0b110000) | pad];
    assert.equal(phraseFromFragment(`1.${body.slice(0, -1)}${alt}`), null, `non-canonical ${alt}`);
  }
});

test("allocation never reuses a recorded index, even one not yet on chain", async () => {
  const nothingFunded = async () => false;
  assert.equal(await nextGiftIndex(new Set(), nothingFunded), 0);

  assert.equal(await nextGiftIndex(new Set([0, 1]), nothingFunded), 2);
  assert.equal(await nextGiftIndex(new Set([1]), nothingFunded), 0);
});

test("allocation skips indices funded from another device", async () => {
  const funded = new Set([0, 1, 3]);
  let asked: number[] = [];
  const onChain = async (i: number) => { asked.push(i); return funded.has(i); };
  assert.equal(await nextGiftIndex(new Set(), onChain), 2);
  asked = [];
  assert.equal(await nextGiftIndex(new Set([2]), onChain), 4);
  assert.deepEqual(asked, [0, 1, 3, 4], "a recorded index is not even asked about");
});

test("finding gifts stops after a run of unfunded indices", async () => {
  const funded = new Set([0, 1, 2, 4, 9]);
  const onChain = async (i: number) => funded.has(i);
  assert.deepEqual(await findGiftIndices(onChain, 5), [0, 1, 2, 4, 9]);
  assert.deepEqual(await findGiftIndices(onChain, 3), [0, 1, 2, 4]);
  assert.deepEqual(await findGiftIndices(async () => false, 5), []);
});

const PINNED: Record<number, string> = {
  0: "guitar foster copy citizen guide grocery cool unfold soda absorb donor copy",
  1: "rail spread gift essence grass awful satisfy book giraffe squeeze travel ten",
  1000: "wisdom receive list tumble piece nothing soda wonder turn axis only gate",
};
