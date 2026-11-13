// The words and links for invites, "pick your items" requests and reminders,
// plus the sms: link that opens the phone's own Messages app (free, sent from your number).

import { formatCents } from "./money.ts";
import type { Group } from "./types.ts";

export type Purpose =
  | { kind: "invite" }
  | { kind: "receipt"; receiptId: string; store: string }
  | { kind: "reminder"; cents: number };

/** Keeps a leading + and the digits; "(416) 555-0199" → "4165550199". */
export function cleanPhone(raw: string): string {
  const t = raw.trim();
  return (t.startsWith("+") ? "+" : "") + t.replace(/\D/g, "");
}

export const looksLikePhone = (raw: string) => cleanPhone(raw).replace("+", "").length >= 7;
export const looksLikeEmail = (raw: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());

/** iPhones want sms:NUMBER&body=…, everything else sms:NUMBER?body=… */
export function smsHref(phone: string, body: string, userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const apple = /iPhone|iPad|iPod|Macintosh/.test(userAgent);
  return `sms:${cleanPhone(phone)}${apple ? "&" : "?"}body=${encodeURIComponent(body)}`;
}

export function messageFor(p: Purpose, g: Group, toName: string, myName: string, link?: string): string {
  const tail = link ? ` ${link}` : "";
  switch (p.kind) {
    case "invite":
      return `Hi ${toName}! I added you to "${g.name}" on Allsquare so we can split costs. Join here:${tail || " (ask me for the link)"}`;
    case "receipt":
      return `Hi ${toName}, I scanned the ${p.store} receipt for "${g.name}". Tap what you had:${tail || " open Allsquare"}`;
    case "reminder":
      return `Hi ${toName}! Quick reminder from Allsquare: you owe ${myName} ${formatCents(p.cents, g.currency)} for ${g.name}.${link ? ` Details: ${link}` : ""} Thanks!`;
  }
}

export const purposeTitle = (p: Purpose, name: string) =>
  p.kind === "invite" ? `Invite ${name}` : p.kind === "receipt" ? `Ask ${name} to pick items` : `Remind ${name}`;
