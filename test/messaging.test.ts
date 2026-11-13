import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPhone, looksLikeEmail, looksLikePhone, messageFor, smsHref } from "../src/lib/messaging.ts";
import type { Group } from "../src/lib/types.ts";

const g = { id: "g", name: "Cottage", currency: "CAD", members: [], meId: "a", expenses: [], settlements: [], recurring: [], createdAt: 0 } as unknown as Group;

test("phone numbers are cleaned but keep a leading +", () => {
  assert.equal(cleanPhone("(416) 555-0199"), "4165550199");
  assert.equal(cleanPhone(" +1 416 555 0199 "), "+14165550199");
  assert.ok(looksLikePhone("416-555-0199"));
  assert.ok(!looksLikePhone("12345"));
});

test("emails are checked loosely", () => {
  assert.ok(looksLikeEmail("sam@example.com"));
  assert.ok(!looksLikeEmail("sam@example"));
  assert.ok(!looksLikeEmail("sam example.com"));
});

test("sms links use & on iPhone and ? elsewhere, with the body encoded", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
  const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9)";
  assert.equal(smsHref("416 555 0199", "Hi & bye", iphone), "sms:4165550199&body=Hi%20%26%20bye");
  assert.equal(smsHref("416 555 0199", "Hi & bye", android), "sms:4165550199?body=Hi%20%26%20bye");
});

test("messages carry the link and the amount", () => {
  const link = "https://allsquare.app/?join=abc&receipt=r1";
  assert.match(messageFor({ kind: "receipt", receiptId: "r1", store: "Costco" }, g, "Sam", "Vee", link), /Costco.*join=abc&receipt=r1/);
  assert.match(messageFor({ kind: "reminder", cents: 4250 }, g, "Sam", "Vee"), /owe Vee \$42\.50 for Cottage/);
  assert.match(messageFor({ kind: "invite" }, g, "Sam", "Vee", "https://x/?join=abc"), /Join here: https:\/\/x\/\?join=abc/);
});
