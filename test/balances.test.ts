import { test } from "node:test";
import assert from "node:assert/strict";
import { involvement, netBalances, sharesFor, simplifyDebts, summary } from "../src/lib/balances.ts";
import { guessCategory } from "../src/lib/categories.ts";
import { groupToCsv } from "../src/lib/export.ts";
import { padInput, parseCents } from "../src/lib/money.ts";
import { nextDate, runRecurring } from "../src/lib/recurring.ts";
import { migrate, seedState } from "../src/lib/store.ts";
import type { Expense, Group, Split } from "../src/lib/types.ts";

const members = ["A", "B", "C", "D"].map((id) => ({ id, name: id }));
const group = (over: Partial<Group> = {}): Group => ({
  id: "g", name: "Flat", currency: "CAD", members, meId: "A", expenses: [], settlements: [], recurring: [], createdAt: 0, ...over,
});
const exp = (payers: Record<string, number>, split: Split, total?: number): Expense => ({
  id: Math.random().toString(), description: "x", date: "2026-11-09", payers,
  totalCents: total ?? Object.values(payers).reduce((a, b) => a + b, 0), split, category: "Other", createdAt: 0,
});
const equal = (...among: string[]): Split => ({ kind: "equal", among });
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

test("equal split of $10 among 3 adds up to the cent", () => {
  assert.deepEqual(Object.values(sharesFor(equal("A", "B", "C"), 1000)), [334, 333, 333]);
});

test("percent split 50/30/20 of $99.99", () => {
  const s = sharesFor({ kind: "percent", percents: { A: 5000, B: 3000, C: 2000 } }, 9999);
  assert.equal(sum(s), 9999);
  assert.deepEqual(s, { A: 4999, B: 3000, C: 2000 });
  assert.throws(() => sharesFor({ kind: "percent", percents: { A: 5000, B: 4000 } }, 100));
});

test("shares split: a couple (2) and a single person (1)", () => {
  assert.deepEqual(sharesFor({ kind: "shares", weights: { A: 2, B: 1 } }, 9000), { A: 6000, B: 3000 });
});

test("two people paid one bill", () => {
  const net = netBalances(group({ expenses: [exp({ A: 6000, B: 3000 }, equal("A", "B", "C"))] }));
  assert.deepEqual(net, { A: 3000, B: 0, C: -3000, D: 0 });
});

test("spec seed: V +64.72, R -4.86, P -59.86", () => {
  const g = seedState().groups[0];
  const [v, r, p] = g.members.map((m) => m.id);
  assert.deepEqual(netBalances(g), { [v]: 6472, [r]: -486, [p]: -5986 });
  assert.equal(involvement(g.expenses[0], v).kind, "owe");
  assert.equal(involvement(g.expenses[1], v).cents, 8972);
});

test("chains collapse and payments clear everyone", () => {
  const g = group({ expenses: [exp({ A: 1000 }, equal("B")), exp({ B: 1000 }, equal("C"))] });
  assert.deepEqual(simplifyDebts(netBalances(g)), [{ from: "C", to: "A", cents: 1000 }]);
});

test("random groups with mixed splits: zero-sum and N-1 payments", () => {
  let seed = 7;
  const rand = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  const ids = ["A", "B", "C", "D"];
  for (let round = 0; round < 300; round++) {
    const expenses = Array.from({ length: 1 + rand(8) }, () => {
      const total = 1 + rand(20000);
      const payer = ids[rand(4)];
      const kind = rand(3);
      const split: Split = kind === 0 ? equal(...ids.filter(() => rand(2)).concat("A"))
        : kind === 1 ? { kind: "shares", weights: { A: 1 + rand(3), B: rand(3), C: rand(2) } }
        : { kind: "percent", percents: { A: 2500, B: 2500, C: 5000 } };
      return exp({ [payer]: total }, split);
    });
    const net = netBalances(group({ expenses }));
    assert.equal(sum(net), 0);
    const after = { ...net };
    const transfers = simplifyDebts(net);
    assert.ok(transfers.length <= 3);
    for (const t of transfers) { after[t.from] += t.cents; after[t.to] -= t.cents; }
    assert.ok(Object.values(after).every((v) => v === 0));
  }
});

test("summary: paid minus share equals net", () => {
  const g = seedState().groups[0];
  for (const row of summary(g)) assert.equal(row.paid - row.share, row.net);
});

test("monthly rent repeats, the 31st becomes the 30th", () => {
  assert.equal(nextDate("2026-01-31", "month"), "2026-02-28");
  assert.equal(nextDate("2026-11-09", "week"), "2026-11-16");
  const g = group({
    recurring: [{ id: "r", every: "month", nextDate: "2026-09-01", template: exp({ A: 200000 }, equal("A", "B")) }],
  });
  let n = 0;
  const after = runRecurring(g, "2026-11-09", () => `id${n++}`);
  assert.deepEqual(after.expenses.map((e) => e.date), ["2026-11-01", "2026-10-01", "2026-09-01"]);
  assert.equal(after.recurring[0].nextDate, "2026-12-01");
  assert.equal(runRecurring(after, "2026-11-09", () => "x"), after, "nothing new is added twice");
});

test("Stage 1 data upgrades without losing balances", () => {
  const old = { version: 1, groups: [{ id: "g", name: "F", members, createdAt: 0, settlements: [],
    expenses: [{ id: "e", description: "Costco run", date: "2026-11-01", paidBy: "A", totalCents: 3000, split: equal("A", "B", "C"), createdAt: 0 }] }] };
  const g = migrate(old)!.groups[0];
  assert.equal(g.expenses[0].category, "Groceries");
  assert.deepEqual(netBalances(g), { A: 2000, B: -1000, C: -1000, D: 0 });
});

test("categories are guessed from the description", () => {
  assert.equal(guessCategory("Costco run"), "Groceries");
  assert.equal(guessCategory("Masala Boyz dinner"), "Dining");
  assert.equal(guessCategory("BC Hydro"), "Utilities");
  assert.equal(guessCategory("Birthday gift"), "Other");
});

test("CSV export: one column per person, last row is the balance", () => {
  const csv = groupToCsv(seedState().groups[0]).trim().split("\n");
  assert.equal(csv[0], "Date,Description,Category,Cost,Currency,Original,Vatsalya,Rahul,Priya");
  assert.equal(csv.at(-1), ",Total balance,,,CAD,,64.72,-4.86,-59.86");
});

test("number pad rules", () => {
  const type = (keys: string) => [...keys].reduce(padInput, "");
  assert.equal(type("0"), "0");
  assert.equal(type("05"), "5");
  assert.equal(type("12.345"), "12.34");
  assert.equal(type("..5"), "0.5");
  assert.equal(type("123456789"), "1234567");
  assert.equal(padInput("12", "⌫"), "1");
  assert.equal(parseCents("12.5"), 1250);
  assert.equal(parseCents("1.999"), null);
});
