// Turn Azure Document Intelligence's prebuilt-receipt answer into our Receipt shape.
// Tested in the reader comparison: names and prices on 37/38 lines, tax marks 8/8.

import type { Item, Receipt, TaxLine } from "./split.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const money = (f: any): number | null => {
  if (!f) return null;
  const v = f.valueCurrency?.amount ?? f.valueNumber;
  return typeof v === "number" ? Math.round(v * 100) : null;
};

/** "1713240 PEANUT OIL" -> "PEANUT OIL": drop store item numbers at the start. */
export const cleanName = (s: string) => s.replace(/^\s*\d{4,}\s+/, "").replace(/\s+/g, " ").trim();

function taxCode(description: string): string {
  const d = description.toUpperCase();
  if (/HST/.test(d)) return "HST";
  if (/GST/.test(d)) return "GST";
  if (/PST|QST/.test(d)) return "PST";
  return "TAX";
}

export function parseAzureReceipt(analyzeResult: any, id = "scan"): Receipt {
  const doc = analyzeResult?.documents?.[0];
  const f = doc?.fields ?? {};
  const items: (Item & { flag: string })[] = [];

  (f.Items?.valueArray ?? []).forEach((entry: any, i: number) => {
    const o = entry.valueObject ?? {};
    const content: string = entry.content ?? "";
    const name = cleanName(o.Description?.valueString ?? o.Description?.content ?? content.split("\n")[0] ?? "Item");
    let cents = money(o.TotalPrice);
    if (cents === null) {
      const unit = money(o.Price);
      const qty = o.Quantity?.valueNumber ?? 1;
      cents = unit === null ? 0 : Math.round(unit * qty);
    }
    // A trailing minus after the price ("7.00-GP") marks a discount line.
    const flagMatch = content.match(/\d\.\d\d(-?)\s*([A-Z]{1,2})?\s*$/);
    if (flagMatch?.[1] === "-" && cents > 0) cents = -cents;
    const qty = Number.isInteger(o.Quantity?.valueNumber) && o.Quantity.valueNumber > 1 && /^\s*\d+\s*x/i.test(content) ? o.Quantity.valueNumber : undefined;
    items.push({ id: `i${i + 1}`, name, cents, qty, flag: flagMatch?.[2] ?? "" });
  });

  // Tax lines: separate GST/PST if Azure listed them, otherwise one combined line.
  let taxLines: TaxLine[] = [];
  const details = (f.TaxDetails?.valueArray ?? [])
    .map((d: any) => ({ cents: money(d.valueObject?.Amount) ?? 0, desc: `${d.valueObject?.Description?.valueString ?? ""} ${d.content ?? ""}`, rate: d.valueObject?.Rate?.valueNumber }))
    .filter((d: { cents: number }) => d.cents > 0);
  if (details.length > 1) {
    taxLines = details.map((d: any) => ({ code: taxCode(d.desc), cents: d.cents, rate: typeof d.rate === "number" ? (d.rate > 1 ? d.rate / 100 : d.rate) : undefined }));
  } else {
    const total = money(f.TotalTax) ?? details[0]?.cents ?? 0;
    if (total > 0) taxLines = [{ code: details[0] ? taxCode(details[0].desc) : "TAX", cents: total }];
  }

  const anyFlags = items.some((it) => it.flag);
  const codes = taxLines.map((t) => t.code);
  for (const it of items) {
    if (!anyFlags || !it.flag) it.taxes = [];
    else if (codes.length <= 1) it.taxes = codes;
    else it.taxes = codes.filter((c) => (c === "PST" ? it.flag.includes("P") : true)); // e.g. F = GST, FP = GST + PST
  }

  // A discount reduces the nearest taxable item above it (or the item right above).
  items.forEach((it, i) => {
    if (it.cents >= 0) return;
    const above = items.slice(0, i).reverse().filter((x) => x.cents > 0);
    const target = above.find((x) => x.taxes?.length && it.taxes?.length) ?? above[0];
    if (target) it.discountOf = target.id;
  });

  const totalCents = money(f.Total) ?? items.reduce((a, b) => a + b.cents, 0) + taxLines.reduce((a, t) => a + t.cents, 0);
  return {
    id,
    store: f.MerchantName?.valueString ?? "Receipt",
    items: items.map(({ flag: _f, ...rest }) => (void _f, rest)),
    subtotalCents: money(f.Subtotal) ?? undefined,
    taxLines,
    totalCents,
    taxMarking: anyFlags || taxLines.length === 0 ? "per-item" : "none",
  };
}

export const receiptDate = (analyzeResult: any): string | undefined =>
  analyzeResult?.documents?.[0]?.fields?.TransactionDate?.valueDate;
