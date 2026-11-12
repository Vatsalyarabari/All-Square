// Supabase Edge Function: the phone sends a receipt photo, this calls Azure with the secret key
// and returns Azure's answer. The Azure key lives only here, as a Supabase secret.
//
// Secrets to set (Supabase dashboard → Edge Functions → Secrets):
//   AZURE_KEY        KEY 1 from your Azure Document Intelligence resource
//   AZURE_ENDPOINT   e.g. https://splitfree-receipts-vr.cognitiveservices.azure.com/
//   ALLOWED_ORIGIN   optional, e.g. https://vatsalyarabari.github.io  (defaults to any origin)

const API_VERSION = "2024-11-30";
const MAX_BASE64 = 6_000_000; // about 4.5 MB of photo

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Send a POST with { image }." });

  const key = Deno.env.get("AZURE_KEY");
  const endpoint = (Deno.env.get("AZURE_ENDPOINT") ?? "").replace(/\/+$/, "");
  if (!key || !endpoint) return reply(500, { error: "The scanner isn't configured yet (missing Azure secrets)." });

  let image: unknown;
  try {
    ({ image } = await req.json());
  } catch {
    return reply(400, { error: "Expected JSON with an image." });
  }
  if (typeof image !== "string" || image.length < 100) return reply(400, { error: "No photo was sent." });
  if (image.length > MAX_BASE64) return reply(413, { error: "That photo is too large. Try again closer to the receipt." });

  const start = await fetch(`${endpoint}/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=${API_VERSION}`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Source: image }),
  });
  if (start.status === 429) return reply(429, { error: "Too many scans this minute. Wait a moment and try again." });
  if (start.status === 403) return reply(429, { error: "This month's free scans are used up. You can still type the items in." });
  if (start.status !== 202) return reply(502, { error: `Azure couldn't start reading the photo (${start.status}).` });

  const resultUrl = start.headers.get("Operation-Location");
  if (!resultUrl) return reply(502, { error: "Azure didn't return a result link." });

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(attempt === 0 ? 1500 : 1000);
    const poll = await fetch(resultUrl, { headers: { "Ocp-Apim-Subscription-Key": key } });
    if (poll.status === 429) continue;
    if (!poll.ok) return reply(502, { error: `Azure error while reading (${poll.status}).` });
    const data = await poll.json();
    if (data.status === "succeeded") {
      // Only the receipt fields go back to the phone: no raw text, so card numbers don't travel further.
      const doc = data.analyzeResult?.documents?.[0];
      return reply(200, { analyzeResult: { documents: doc ? [{ fields: doc.fields }] : [] } });
    }
    if (data.status === "failed") return reply(422, { error: "Azure couldn't read that photo. Try a flatter, brighter shot." });
  }
  return reply(504, { error: "Reading took too long. Try again." });
});
