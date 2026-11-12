import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  allocate,
  claimableItems,
  grossByItem,
  reconcile,
  splitReceipt,
  type Receipt,
} from "../src/lib/split.ts";

const receipts: Receipt[] = JSON.parse(
  readFileSync(new URL("../fixtures/receipts.json", import.meta.url), "utf8"),
);
const get = (id: string) => {
  const r = receipts.find((x) => x.id.startsWith(id));
  if (!r) throw new Error(id);
  return structuredClone(r);
};
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

test("all 7 real receipts reconcile with no errors", () => {
  assert.equal(receipts.length, 7);
  for (const r of receipts) {
    const errors = reconcile(r).filter((i) => i.level === "error");
    assert.deepEqual(errors, [], r.id);
  }
});

test("a misread price is caught", () => {
  const r = get("costco");
  r.items[0].cents = 1899; // 19.99 misread as 18.99
  const codes = reconcile(r).map((i) => i.code);
  assert.ok(codes.includes("subtotal-mismatch"));
  assert.ok(codes.includes("total-mismatch"));
});

test("a wrong tax mark is caught", () => {
  const r = get("dollarama");
  r.items.find((i) => i.id === "lays")!.taxes = ["GST", "PST"]; // should be F only
  assert.ok(reconcile(r).some((i) => i.code === "tax-rate-mismatch"));
});

test("Costco: untaxed groceries carry no tax", () => {
  const gross = grossByItem(get("costco"));
  assert.equal(gross.rice, 1999);
  assert.equal(gross.oil1, 1749);
  assert.equal(gross.cetaphil + gross.lole, 1999 + 2299 + 516);
  assert.equal(sum(gross), 13458);
});

test("Dollarama: GST and PST land only on the right items", () => {
  const gross = grossByItem(get("dollarama"));
  assert.ok(gross.doritos - 300 <= 16, "Doritos pays GST only");
  assert.ok(gross.curtain - 325 >= 38, "Curtain pays GST and PST");
  assert.equal(sum(gross), 1502);
});

test("Acharya: unmarked tax is flagged and still adds up", () => {
  const r = get("acharya-2026-10-24");
  assert.ok(reconcile(r).some((i) => i.code === "tax-unmarked"));
  assert.equal(sum(grossByItem(r)), 2731);
});

test("Weighed item price agrees with weight x unit price", () => {
  const item = get("great-two-2026-11-02").items[1] as any;
  assert.equal(Math.round(item.weight.lb * item.weight.centsPerLb), item.cents);
});

test("Masala Boyz: '2 x naan' can be claimed one at a time", () => {
  const units = claimableItems(get("masala")).filter((u) => u.id.startsWith("cheddar2"));
  assert.deepEqual(units.map((u) => [u.id, u.cents]), [
    ["cheddar2#1", 800],
    ["cheddar2#2", 800],
  ]);
});

test("Masala Boyz: 4 people plus a tip adds up to the cent", () => {
  const r = get("masala");
  const people = ["A", "B", "C", "D"];
  const claims = Object.fromEntries(claimableItems(r).map((u) => [u.id, people]));
  const tip = 3098;
  const result = splitReceipt(r, claims, tip);
  assert.equal(sum(result.perPerson), 15488 + tip);
  assert.equal(result.unclaimedCents, 0);
  const shares = Object.values(result.perPerson);
  assert.ok(Math.max(...shares) - Math.min(...shares) <= 12, "equal claims stay near-equal");
});

test("unclaimed items are reported, not silently dropped", () => {
  const r = get("dollarama");
  const result = splitReceipt(r, { doritos: ["A"] });
  assert.equal(result.unclaimedItems.length, 4);
  assert.equal(result.perPerson.A + result.unclaimedCents, 1502);
});

test("any random claims add up exactly on every receipt", () => {
  let seed = 12345;
  const rand = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const people = ["A", "B", "C", "D", "E"];
  for (let round = 0; round < 500; round++) {
    for (const r of receipts) {
      const claims: Record<string, string[]> = {};
      for (const u of claimableItems(r)) {
        claims[u.id] = people.filter(() => rand(3) > 0);
      }
      const tip = rand(4000);
      const out = splitReceipt(r, claims, tip);
      assert.equal(sum(out.perPerson) + out.unclaimedCents, r.totalCents + tip, r.id);
    }
  }
});

test("allocate handles remainders and negatives", () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(allocate(-100, [1, 1, 1]), [-34, -33, -33]);
  assert.deepEqual(allocate(0, []), []);
  assert.throws(() => allocate(5, [0, 0]));
});
