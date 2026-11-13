// Supabase Edge Function: sends Allsquare emails (invites, "tap your items", payment reminders) through Resend.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   from resend.com → API Keys
//   FROM_EMAIL       e.g.  Allsquare <hello@allsquare.ca>   (must be on the domain you verified in Resend)
//   ALLOWED_ORIGIN   e.g.  https://allsquare.ca
//   APP_URL          the app's address used in email links, e.g. https://allsquare.ca/
// Settings: turn OFF "Verify JWT with legacy secret". The function checks the person's session itself.
//
// Safety: only signed-in members of a group can email people in that group (the database rules
// enforce it, because every read below runs as the signed-in person), the message is always one
// of three fixed templates, and each person gets at most one email of each kind every 20 hours.

import { withSupabase } from "npm:@supabase/server@1";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(cents / 100);

type Kind = "invite" | "receipt" | "reminder";

function render(kind: Kind, v: { from: string; to: string; group: string; link: string; amount?: string; store?: string }) {
  const subject = {
    invite: `${v.from} added you to ${v.group} on Allsquare`,
    receipt: `${v.from} shared a receipt${v.store ? ` from ${v.store}` : ""}: tap what you had`,
    reminder: `Reminder: ${v.amount} to ${v.from} for ${v.group}`,
  }[kind];
  const line = {
    invite: `${v.from} is splitting costs for <b>${esc(v.group)}</b> on Allsquare, a free bill-splitting app. Tap below to join and see who owes what.`,
    receipt: `${esc(v.from)} scanned a receipt${v.store ? ` from <b>${esc(v.store)}</b>` : ""} in <b>${esc(v.group)}</b>. Tap below and pick the items you had; tax is worked out for you.`,
    reminder: `A friendly reminder that you owe <b>${esc(v.from)}</b> <b>${esc(v.amount ?? "")}</b> for <b>${esc(v.group)}</b>. Once you've sent it (e-Transfer or cash), mark it as paid in Allsquare.`,
  }[kind];
  const button = { invite: "Join the group", receipt: "Pick my items", reminder: "Open Allsquare" }[kind];
  const html = `<!doctype html><html><body style="margin:0;background:#F4F0E8;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#161513">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px">
    <div style="font-family:Georgia,serif;font-size:24px;color:#A39D90;margin-bottom:24px">Allsquare</div>
    <p style="font-size:16px;line-height:1.5;margin:0 0 8px">Hi ${esc(v.to)},</p>
    <p style="font-size:16px;line-height:1.5;margin:0 0 24px">${line}</p>
    <a href="${esc(v.link)}" style="display:inline-block;background:#161513;color:#F4F0E8;text-decoration:none;padding:14px 22px;border-radius:16px;font-weight:600">${button}</a>
    <p style="font-size:12px;color:#7D786D;margin-top:32px">Sent by Allsquare because ${esc(v.from)} asked. If this wasn't meant for you, ignore it.</p>
  </div></body></html>`;
  const text = `Hi ${v.to},\n\n${line.replace(/<[^>]+>/g, "")}\n\n${button}: ${v.link}\n`;
  return { subject, html, text };
}

async function handle(req: Request, ctx: { supabase: any; userClaims: { id: string } | null }): Promise<Response> {
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("FROM_EMAIL");
  if (!apiKey || !fromEmail) return reply(500, { error: "Email isn't set up yet (RESEND_API_KEY / FROM_EMAIL)." });

  const body = await req.json().catch(() => ({}));
  const { kind, groupId, memberId, receiptId, amountCents, appUrl } = body as Record<string, unknown>;
  if (!["invite", "receipt", "reminder"].includes(kind as string) || typeof groupId !== "string" || typeof memberId !== "string") {
    return reply(400, { error: "Bad request" });
  }
  const db = ctx.supabase; // runs as the signed-in person, so the database rules apply
  const uid = ctx.userClaims?.id;

  const { data: group } = await db.from("groups").select("id,name,currency,invite_code").eq("id", groupId).maybeSingle();
  if (!group) return reply(403, { error: "You're not in that group." });
  const { data: members } = await db.from("members").select("id,name,email,user_id").eq("group_id", groupId);
  const sender = members?.find((m: { user_id: string }) => m.user_id === uid);
  const target = members?.find((m: { id: string }) => m.id === memberId);
  if (!sender) return reply(403, { error: "You're not in that group." });
  if (!target) return reply(404, { error: "That person isn't in this group." });
  if (!target.email) return reply(400, { error: `Add an email for ${target.name} first.` });
  if (target.id === sender.id) return reply(400, { error: "That's you." });

  const since = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const { count } = await db.from("notifications").select("id", { count: "exact", head: true })
    .eq("member_id", memberId).eq("kind", kind).gte("sent_at", since);
  if ((count ?? 0) > 0) return reply(429, { error: `${target.name} already got this email today. Try again tomorrow, or send a text.` });

  // Links always point at the app's own address, never anything the caller made up.
  void appUrl; // the phone's idea of the address is ignored on purpose
  const base = (Deno.env.get("APP_URL") ?? "").replace(/[?#].*$/, "");
  if (!/^https:\/\//.test(base)) return reply(500, { error: "Email isn't set up yet (APP_URL)." });
  let link = `${base}?join=${group.invite_code}`;
  let store: string | undefined;
  if (kind === "receipt") {
    if (typeof receiptId !== "string") return reply(400, { error: "Which receipt?" });
    const { data: r } = await db.from("receipts").select("id,data").eq("id", receiptId).eq("group_id", groupId).maybeSingle();
    if (!r) return reply(404, { error: "That receipt isn't in this group." });
    store = r.data?.receipt?.store;
    link += `&receipt=${r.id}`;
  }
  const amount = kind === "reminder" && typeof amountCents === "number" && amountCents > 0 ? money(Math.round(amountCents), group.currency) : undefined;
  if (kind === "reminder" && !amount) return reply(400, { error: "Missing amount." });

  const msg = render(kind as Kind, { from: sender.name, to: target.name, group: group.name, link, amount, store });
  const sent = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromEmail, to: [target.email], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!sent.ok) {
    const detail = await sent.json().catch(() => ({}));
    return reply(502, { error: `The email service refused: ${detail.message ?? sent.status}` });
  }
  await db.from("notifications").insert({ group_id: groupId, member_id: memberId, kind });
  return reply(200, { sent: true });
}

const guarded = withSupabase({ auth: "user" }, (req: Request, ctx: any) => handle(req, ctx));

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const res = await guarded(req);
    if (res.status === 401) return reply(401, { error: "Sign in to send emails." });
    return res;
  },
};
