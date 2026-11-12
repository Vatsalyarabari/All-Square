// Sends a receipt photo to our scan server (a Supabase function that holds the Azure key).
// The key never reaches the phone. Until the server exists, scanning reports "not set up".

import { parseAzureReceipt, receiptDate } from "./azureReceipt.ts";
import type { Receipt } from "./split.ts";

const SCAN_URL = import.meta.env.VITE_SCAN_URL as string | undefined;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const scanAvailable = Boolean(SCAN_URL);

/** Shrinks a photo in the browser before it's saved or sent. */
export function shrinkImage(file: Blob, maxSide = 900, quality = 0.6): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("That file isn't a photo the browser can read."));
    img.src = URL.createObjectURL(file);
  });
}

export async function scanPhoto(file: File): Promise<{ receipt: Receipt; date?: string }> {
  if (!SCAN_URL) throw new Error("Scanning isn't set up yet.");
  // Big enough for small print, small enough to upload quickly on mobile data.
  const dataUrl = await shrinkImage(file, 2200, 0.85);
  const res = await fetch(SCAN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // New Supabase keys go in the apikey header only, never as a Bearer token.
      ...(PUBLISHABLE_KEY ? { apikey: PUBLISHABLE_KEY } : {}),
    },
    body: JSON.stringify({ image: dataUrl.split(",")[1] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The scanner answered ${res.status}. Try again, or type the items in.`);
  return { receipt: parseAzureReceipt(body.analyzeResult, `scan-${Date.now()}`), date: receiptDate(body.analyzeResult) };
}