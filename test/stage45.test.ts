import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanName, parseAzureReceipt } from "../src/lib/azureReceipt.ts";
import { netBalances } from "../src/lib/balances.ts";
import { groupToCsv } from "../src/lib/export.ts";
import { itemKey, learn, suggest } from "../src/lib/itemMemory.ts";
import { reconcile, splitReceipt, claimableItems } from "../src/lib/split.ts";
import { seedState } from "../src/lib/store.ts";
import { buildGroup, checkAgainstSplitwise, parseCsv, parseSplitwise } from "../src/lib/splitwiseImport.ts";

const cur = (n: number) => ({ valueCurrency: { amount: n } });
const line = (desc: string, price: number, content: string) => ({ content, valueObject: { Description: { valueString: desc }, TotalPrice: cur(price) } });

// Shaped like Azure's prebuilt-receipt answer for the real Costco receipt.
const costcoAzure = { documents: [{ fields: {
  MerchantName: { valueString: "Costco Wholesale" },
  TransactionDate: { valueDate: "2026-10-17" },
  Items: { valueArray: [
    line("1121 BASMATI", 19.99, "1836266 1121 BASMATI 19.99"),
    line("POTATOES", 8.99, "36155 POTATOES 8.99"),
    line("PEANUT OIL", 17.49, "1713240 PEANUT OIL 17.49"),
    line("PEANUT OIL", 17.49, "1713240 PEANUT OIL 17.49"),
    line("CETAPHIL", 19.99, "120902 CETAPHIL 19.99 GP"),
    line("KS WALNUTS", 13.49, "36285 KS WALNUTS 13.49"),
    line("PROTEIN BREA", 8.99, "1993586 PROTEIN BREA 8.99"),
    line("LOLE FZIP", 29.99, "2040561 LOLE FZIP 29.99 GP"),
    line("/MULTIPLE", 7.00, "0000390266 /MULTIPLE 7.00-GP"),
  ] },
  Subtotal: cur(129.42), TotalTax: cur(5.16), Total: cur(134.58),
} }] };

test("Azure Costco answer becomes a receipt that reconciles", () => {
  const r = parseAzureReceipt(costcoAzure);
  assert.equal(r.items.length, 9);
  assert.equal(r.items[8].cents, -700, "trailing minus = discount");
  assert.equal(r.items[8].discountOf, r.items[7].id, "discount goes to the taxed jacket above");
  assert.deepEqual(r.items[4].taxes, ["TAX"]);
  assert.deepEqual(r.items[0].taxes, []);
  assert.deepEqual(reconcile(r).filter((i) => i.level === "error"), []);
  assert.equal(r.store, "Costco Wholesale");
});

test("Azure Dollarama answer: F = GST only, FP = GST + PST", () => {
  const r = parseAzureReceipt({ documents: [{ fields: {
    Items: { valueArray: [
      line("DISH CLOTHS", 2.5, "DISH CLOTHS 667888159581 2.50 FP"),
      line("LAY'S CHIPS", 2.5, "LAY'S CHIPS 060410076750 2.50 F"),
    ] },
    TaxDetails: { valueArray: [
      { content: "GST 5% $0.25", valueObject: { Amount: cur(0.25), Description: { valueString: "GST 5%" } } },
      { content: "PST 7% $0.18", valueObject: { Amount: cur(0.18), Description: { valueString: "PST 7%" } } },
    ] },
    Total: cur(5.43),
  } }] });
  assert.deepEqual(r.items[0].taxes, ["GST", "PST"]);
  assert.deepEqual(r.items[1].taxes, ["GST"]);
  assert.deepEqual(reconcile(r).filter((i) => i.level === "error"), []);
});

test("item numbers are dropped from names", () => {
  assert.equal(cleanName("1713240 PEANUT OIL"), "PEANUT OIL");
  assert.equal(cleanName("3 IN ONE PURI"), "3 IN ONE PURI");
});

test("remembered items: sizes and codes don't matter, latest choice wins", () => {
  assert.equal(itemKey("1713240 Peanut Oil 2L"), "PEANUT OIL");
  assert.equal(itemKey("NANAK DAHI 750 GM"), "NANAK DAHI");
  let m = learn(undefined, [{ name: "DORITOS", who: ["r"] }, { name: "MILK 4 LTRS", who: ["v", "r", "p"] }, { name: "SALT", who: [] }]);
  assert.deepEqual(suggest(m, "Doritos", ["v", "r", "p"]), ["r"]);
  assert.deepEqual(suggest(m, "DAIRY MILK 4L", ["v"]), [], "different item");
  assert.deepEqual(suggest(m, "MILK", ["v", "r"]), ["v", "r"], "people who left the group are dropped");
  assert.deepEqual(suggest(m, "SALT", ["v"]), []);
  m = learn(m, [{ name: "doritos", who: ["p"] }]);
  assert.deepEqual(suggest(m, "DORITOS", ["v", "r", "p"]), ["p"]);
});

test("claiming a scanned receipt adds up to the total plus tip", () => {
  const r = parseAzureReceipt(costcoAzure);
  const units = claimableItems(r);
  const claims = Object.fromEntries(units.map((u, i) => [u.id, i % 2 ? ["v"] : ["v", "r"]]));
  const out = splitReceipt(r, claims, 500);
  assert.equal(out.unclaimedCents, 0);
  assert.equal(Object.values(out.perPerson).reduce((a, b) => a + b, 0), 13458 + 500);
});

const SPLITWISE = `Date,Description,Category,Cost,Currency,Vatsalya Rabari,Rahul,Priya

2026-10-17,Costco,Groceries,134.58,CAD,89.72,-44.86,-44.86
2026-11-07,Masala Boyz,Dining out,60.00,CAD,-25.00,40.00,-15.00
2026-11-08,Rahul paid Vatsalya Rabari,Payment,4.86,CAD,-4.86,4.86,0.00
2026-11-08,"Dinner, two payers",Dining out,90.00,CAD,30.00,30.00,-60.00
2026-11-09,Gift for myself,General,20.00,CAD,0.00,0.00,0.00

2026-11-09,Total balance, , ,CAD,89.86,30.00,-119.86
`;

test("Splitwise import reproduces Splitwise's balances exactly", () => {
  const parsed = parseSplitwise(SPLITWISE);
  assert.deepEqual(parsed.people, ["Vatsalya Rabari", "Rahul", "Priya"]);
  assert.equal(parsed.rows.length, 4);
  assert.equal(parsed.skipped, 1);
  let n = 0;
  const g = buildGroup(parsed, { name: "Flat", meIndex: 0, rates: {}, makeId: () => `id${n++}` });
  assert.equal(g.settlements.length, 1);
  assert.equal(g.expenses.length, 3);
  const costco = g.expenses.find((e) => e.description === "Costco")!;
  assert.equal(costco.totalCents, 13458);
  assert.equal(costco.category, "Groceries");
  assert.equal(Object.keys(costco.payers).length, 1);
  assert.deepEqual(checkAgainstSplitwise(g, parsed), []);
  const net = netBalances(g);
  assert.deepEqual(g.members.map((m) => net[m.id]), [8986, 3000, -11986]);
});

test("our own CSV export imports back to the same balances", () => {
  const seed = seedState().groups[0];
  const parsed = parseSplitwise(groupToCsv(seed));
  let n = 0;
  const g = buildGroup(parsed, { name: "Again", meIndex: 0, rates: {}, makeId: () => `x${n++}` });
  assert.deepEqual(checkAgainstSplitwise(g, parsed), []);
});

test("a file that isn't a Splitwise export is rejected clearly", () => {
  assert.throws(() => parseSplitwise("Name,Amount\nA,1"), /Splitwise export/);
  assert.deepEqual(parseCsv('a,"b,""c"""\n1,2'), [["a", 'b,"c"'], ["1", "2"]]);
});

test("the real receipts fixture still loads", () => {
  assert.equal(JSON.parse(readFileSync(new URL("../fixtures/receipts.json", import.meta.url), "utf8")).length, 7);
});
