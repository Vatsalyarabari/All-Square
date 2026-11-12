// Core receipt maths. All money is integer cents, so every split adds up exactly.

export type Item = {
  id: string;
  name: string;
  cents: number; // negative for a discount line
  qty?: number;
  taxes?: string[]; // tax codes on this line; ignored when taxMarking is "none"
  discountOf?: string; // id of the item this discount reduces
};

export type TaxLine = { code: string; rate?: number; cents: number };

export type Receipt = {
  id: string;
  store: string;
  items: Item[];
  subtotalCents?: number;
  taxLines: TaxLine[];
  totalCents: number;
  taxMarking: "per-item" | "none"; // "none": the receipt doesn't say which items were taxed
};

export type Issue = { level: "error" | "notice"; code: string; message: string };

const $ = (c: number) => `$${(c / 100).toFixed(2)}`;

export type Claims = Record<string, string[]>; // item id -> people who claimed it

export type SplitResult = {
  perPerson: Record<string, number>;
  unclaimedCents: number;
  unclaimedItems: string[];
  itemGross: Record<string, number>;
};

/** Divide `total` by weight using largest remainders. Ties go to the earlier entry. */
export function allocate(total: number, weights: number[]): number[] {
  if (!Number.isInteger(total)) throw new Error("total must be whole cents");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0 || sum <= 0) {
    if (total === 0) return weights.map(() => 0);
    throw new Error("cannot allocate an amount across zero weight");
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = weights.map((w) => (abs * w) / sum);
  const out = exact.map(Math.floor);
  let left = abs - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, rem: e - Math.floor(e) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  return out.map((v) => v * sign);
}

/** Merge discounts into the item they reduce and turn "2 x naan" into separate units. */
export function claimableItems(receipt: Receipt): (Item & { qty: 1 })[] {
  const merged = new Map<string, Item>();
  for (const item of receipt.items) {
    if (!item.discountOf) merged.set(item.id, { ...item });
  }
  for (const item of receipt.items) {
    if (!item.discountOf) continue;
    const target = merged.get(item.discountOf);
    if (!target) throw new Error(`discount ${item.id} points to a missing item`);
    target.cents += item.cents;
  }
  const units: (Item & { qty: 1 })[] = [];
  for (const item of merged.values()) {
    const qty = item.qty ?? 1;
    const prices = allocate(item.cents, Array(qty).fill(1));
    prices.forEach((cents, n) => {
      units.push({ ...item, id: qty > 1 ? `${item.id}#${n + 1}` : item.id, cents, qty: 1 });
    });
  }
  return units;
}

function taxedBy(receipt: Receipt, items: Item[], code: string): Item[] {
  if (receipt.taxMarking === "none") return items;
  return items.filter((i) => i.taxes?.includes(code));
}

/** Compare the items against the printed totals, so a misread line is caught. */
export function reconcile(receipt: Receipt): Issue[] {
  const issues: Issue[] = [];
  const itemSum = receipt.items.reduce((a, i) => a + i.cents, 0);
  const taxSum = receipt.taxLines.reduce((a, t) => a + t.cents, 0);

  if (receipt.subtotalCents !== undefined && itemSum !== receipt.subtotalCents) {
    issues.push({
      level: "error",
      code: "subtotal-mismatch",
      message: `Items add up to ${$(itemSum)}, but the receipt subtotal is ${$(receipt.subtotalCents)}. Check for a misread price or a missing line.`,
    });
  }
  if (itemSum + taxSum !== receipt.totalCents) {
    issues.push({
      level: "error",
      code: "total-mismatch",
      message: `Items plus tax come to ${$(itemSum + taxSum)}, but the receipt total is ${$(receipt.totalCents)}.`,
    });
  }
  if (receipt.taxMarking === "none" && taxSum > 0) {
    issues.push({
      level: "notice",
      code: "tax-unmarked",
      message: "This receipt doesn't mark which items were taxed, so the tax is shared across all items.",
    });
  }
  if (receipt.taxMarking === "per-item") {
    for (const tax of receipt.taxLines) {
      if (tax.cents === 0) continue;
      const base = taxedBy(receipt, receipt.items, tax.code).reduce((a, i) => a + i.cents, 0);
      if (base === 0) {
        issues.push({
          level: "error",
          code: "tax-without-items",
          message: `${tax.code} is charged, but no item is marked as taxed. Tap ${tax.code} on the taxed items.`,
        });
      } else if (tax.rate !== undefined && Math.abs(base * tax.rate - tax.cents) > 1) {
        issues.push({
          level: "error",
          code: "tax-rate-mismatch",
          message: `${tax.code} should be about ${$(Math.round(base * tax.rate))} on the marked items, but the receipt shows ${$(tax.cents)}. Check which items are marked.`,
        });
      }
    }
  }
  return issues;
}

/** What each item really costs once its own taxes are added. */
export function grossByItem(receipt: Receipt): Record<string, number> {
  const items = claimableItems(receipt);
  const gross: Record<string, number> = Object.fromEntries(items.map((i) => [i.id, i.cents]));
  for (const tax of receipt.taxLines) {
    if (tax.cents === 0) continue;
    const taxed = taxedBy(receipt, items, tax.code);
    const shares = allocate(tax.cents, taxed.map((i) => i.cents));
    taxed.forEach((item, n) => (gross[item.id] += shares[n]));
  }
  return gross;
}

/** Work out who pays what. Anything nobody claimed is reported, never hidden. */
export function splitReceipt(receipt: Receipt, claims: Claims, tipCents = 0): SplitResult {
  const itemGross = grossByItem(receipt);
  const perPerson: Record<string, number> = {};
  let unclaimedCents = 0;
  const unclaimedItems: string[] = [];

  for (const [itemId, gross] of Object.entries(itemGross)) {
    const people = claims[itemId] ?? [];
    if (people.length === 0) {
      unclaimedCents += gross;
      unclaimedItems.push(itemId);
      continue;
    }
    allocate(gross, people.map(() => 1)).forEach((share, n) => {
      perPerson[people[n]] = (perPerson[people[n]] ?? 0) + share;
    });
  }

  if (tipCents > 0) {
    const names = Object.keys(perPerson);
    const weights = [...names.map((p) => perPerson[p]), unclaimedCents];
    const tips = allocate(tipCents, weights);
    names.forEach((p, n) => (perPerson[p] += tips[n]));
    unclaimedCents += tips[names.length];
  }

  return { perPerson, unclaimedCents, unclaimedItems, itemGross };
}
