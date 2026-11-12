// "Remember grocery items": after a receipt is split, remember who took each item,
// so next time "DORITOS" is suggested for Rahul and "MILK" for everyone.

export type ItemMemory = Record<string, string[]>; // normalised item name -> member ids

/** "1713240 Peanut Oil 2L" and "PEANUT OIL" both become "PEANUT OIL". */
export function itemKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/^\s*\d{4,}\s+/, "")
    .replace(/\b\d+(\.\d+)?\s*(G|GM|KG|ML|L|LTRS?|LB|OZ|PK)\b/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function suggest(memory: ItemMemory | undefined, name: string, memberIds: string[]): string[] {
  const hit = memory?.[itemKey(name)];
  return hit ? hit.filter((id) => memberIds.includes(id)) : [];
}

/** Latest choice wins; empty claims are not remembered. Keeps the 300 most recent items. */
export function learn(memory: ItemMemory | undefined, lines: { name: string; who: string[] }[]): ItemMemory {
  const next: ItemMemory = { ...(memory ?? {}) };
  for (const l of lines) {
    const key = itemKey(l.name);
    if (!key || l.who.length === 0) continue;
    delete next[key];
    next[key] = [...l.who];
  }
  const keys = Object.keys(next);
  return keys.length > 300 ? Object.fromEntries(keys.slice(-300).map((k) => [k, next[k]])) : next;
}
