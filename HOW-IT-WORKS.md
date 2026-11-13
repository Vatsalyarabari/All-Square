# How Allsquare works (plain English)

This guide grows with each stage.
- Stage 1 (Nov 9): groups, expenses, who owes whom, settle up.
- Stage 1.5 (Nov 9): the design from `SplitFree_Design_Spec.md`, plus Splitwise Pro features and extras.
- Stages 4–5 (Nov 11): renamed to **Allsquare**; receipt splitting with item claiming and remembered items; Splitwise import; the scan server and hosting code for Stages 2–3.
- Stage 3b (Nov 11): sign-in, shared live groups, invite links, picking your own items on your own phone, emails and texts.

## 1. The big picture

Allsquare is a **web app**: a website that behaves like an app. On a phone you open its link and tap **Add to Home Screen**, and it gets its own icon and opens full-screen with no browser bar. One set of code works on iPhone, Android and laptops, and needs no App Store.

| Layer | Job | Files |
|---|---|---|
| Screens | What you see and tap | `src/App.tsx`, `src/screens/*`, `src/ui/*`, `src/index.css` |
| Rules | The maths and file reading: splitting, balances, rounding, repeats, export, receipts, import | `src/lib/*.ts` |
| Storage | Where data is saved (this phone, or your account online) | `src/lib/store.ts`, `src/lib/cloud.ts` |
| Database rules | Who may see and change what | `supabase/migrations/001_shared_groups.sql` |
| Server | Reads receipt photos (holds the Azure key); sends emails (holds the Resend key) | `supabase/functions/scan-receipt`, `supabase/functions/notify` |
| Hosting | Tests, builds and publishes on every change | `.github/workflows/deploy.yml` |

The rules layer knows nothing about screens or storage. That's why it can be tested on its own (38 automatic tests), and why it will work unchanged when storage moves online.

## 2. The tools

- **TypeScript**: JavaScript with types. If code tries to put a name where an amount should go, it refuses to build.
- **React**: builds screens from small pieces and redraws only what changed.
- **Vite**: `npm run dev` runs the app on your laptop; `npm run build` makes the `dist` folder any web host can serve.
- **Node's test runner**: `node --test test/*.test.ts` runs the tests.
- **Supabase Edge Functions** (Deno): small server code that runs on Supabase's servers, used to keep the Azure key secret.
- **GitHub Actions**: runs the tests and publishes the app whenever code is pushed.

## 3. What gets stored (`src/lib/types.ts`)

- **Group**: name, currency, members, which member is *you*, an optional default split, expenses, settlements, repeating expenses, and the remembered "who takes which item" list.
- **Member**: an id and a name. Ids are random codes, so two people named "Raj" never get mixed up.
- **Expense**: what for, date, category; who paid and how much each; the total; the original currency and rate if foreign; how it's split; an optional note and photo; and, for receipts, the itemized lines with who had each.
- **Settlement**: "Priya paid Vatsalya $59.86".
- **Repeating expense**: a template, how often, and the next due date.

The app stores *inputs*, not results. It never saves "Rahul owes $4.86"; it works balances out fresh every time, so editing an old expense can't leave a stale balance.

**Older saved data still works.** `migrate` in `store.ts` upgrades Stage 1 data, and data saved under the old name (SplitFree) is picked up automatically.

## 4. Money is stored in cents

Computers can't store 0.1 exactly (0.1 + 0.2 = 0.30000000000000004), so every amount is a whole number of cents: $134.58 is `13458`.

**Leftover cents.** $10.00 split three ways is 333.33… cents each. `allocate` hands the leftover cents to whoever was closest to rounding up: 334, 333, 333. Shares always add up exactly.

## 5. The four ways to split (`sharesFor` in `balances.ts`)

| Split | What you enter | Example: $90 |
|---|---|---|
| Equal | Who's in | 3 people → $30 each |
| Exact | Each person's amount | Must add up to $90 |
| Percent | Each person's % | 50 / 30 / 20 → $45, $27, $18 |
| Shares | A number per person | Couple 2, single 1 → $60 and $30 |

**Default split per group** (⚙ in the group): every new expense starts with it.

## 6. How balances work

- When you **pay**, your balance goes **up** by what you paid.
- Your **share** takes it **down**.
- A **settlement** moves money directly: the payer goes up, the receiver goes down.

Positive means the group owes you. All balances add up to zero; a test checks this on 300 random groups.

**Example: the demo group.** Costco $134.58 paid by Vatsalya, split 3 ways ($44.86 each), then dinner $60 paid by Rahul, shares 25 / 20 / 15. Result: Vatsalya **+64.72**, Rahul **−4.86**, Priya **−59.86**, which adds up to 0.

## 7. "Who owes whom": simplifying debts

`simplifyDebts` pairs the person who owes most with the person owed most, settles what it can, and repeats. Chains collapse (if B owes A and C owes B, C just pays A). N people never need more than N − 1 payments.

## 8. Other currencies

Pick another currency and type the rate (1 USD = 1.38 CAD). US$200 becomes $276.00 CAD and is split in CAD; per-person amounts are converted with `allocate` so they still add up exactly. The rate is typed by hand until the server exists.

## 9. Categories, search and the chart

- `guessCategory` reads the description: "Costco" means Groceries, "BC Hydro" means Utilities.
- **Search** covers descriptions, notes, categories, names and amounts.
- **Chart**: *your* share of spending by category, per month.

## 10. Repeating expenses (`recurring.ts`)

Choose Monthly or Weekly when adding rent or Wi-Fi. Each time the app opens, a copy is added for every due date that has passed. The 31st becomes the last day of shorter months, and nothing is ever added twice. The bell on Home shows what's coming up.

## 11. Paying back and reminders

In **Settle up**: "Copy e-Transfer note" if you owe, "Send a reminder" if you're owed. A reminder can go by text (from your phone), by email (sent by the app, once signed in), or any other app. Then tap **Settle** to record the payment.

## 12. Summary and export (`export.ts`)

The summary shows paid, share and balance per person. The CSV export has one column per person and a final "Total balance" row, the same layout as Splitwise's export, so Allsquare can read its own exports back.

## 13. Splitting a receipt (Stage 4)

Open a group, tap the black **+**, then **Scan receipt**. There are three ways in:
- **Scan a photo**: turns on once the scan server is set up (Stage 3a).
- **Type the items in**.
- **Try a sample receipt**: your 7 test receipts, already read.

**Step 1: check the receipt.** Every line is editable: name, price, and which taxes it carries (tap GST/PST/TAX). The app checks three things as you type:
- the items add up to the subtotal,
- items plus tax add up to the total,
- each tax matches its rate on the marked items.

If something is off, it says what in dollars. If the total itself was misread, one tap fixes it. You can't go on until everything adds up, which is what catches a misread price.

**Discounts.** A line with a minus price is a discount. It reduces one item (the taxable item above it, by default; you can pick another) *before* tax is shared, so the person who got the discount gets the benefit.

**Step 2: who had what.** Each item shows its price *including its own tax*. Tap everyone who shared it, and shared items split between them. "2 x naan" becomes two separate items. Anything unclaimed is shown in red, and there's a one-tap "split the unclaimed items between everyone". A tip is shared by what each person had. You can't save until everything is claimed, because otherwise money would go missing.

The split comes from `splitReceipt` in `split.ts`, the engine tested on your 7 real receipts.

**Saved as an itemized expense.** The expense keeps every line and who had it, so anyone can tap the expense and check.

**Remembered items (`itemMemory.ts`).** After saving, Allsquare remembers who took each item. Next time the same item appears, it's pre-filled and labelled "remembered". Names are matched loosely: "1713240 PEANUT OIL" and "Peanut Oil 2L" count as the same item, because store codes and sizes are dropped. The latest choice always wins, and suggestions are only a starting point you can change.

**Reading the photo (`azureReceipt.ts`).** Azure returns each line's name and price plus the raw text of the line. The app uses that raw text for two things:
- **Tax marks.** The letters after the price: "GP" at Costco, "F" or "FP" at Dollarama. Any mark means GST (or the single tax line); a "P" adds PST.
- **Discounts.** A trailing minus, as in "7.00-GP".

It also drops store item numbers from names.

## 14. Importing from Splitwise (Stage 5)

**New group → "Moving from Splitwise? Import a group instead"** (or on Home when there are no groups). In Splitwise on the web: open the group → settings → **Export as spreadsheet**, then pick that file.

Splitwise's file has one row per expense or payment, and one column per person showing how that row changed their balance. `splitwiseImport.ts` rebuilds each row:
- **Payments** become settlements.
- **One person ahead** on a row means they paid the whole cost, and everyone else's share is what they're behind by.
- **Several people ahead** means each paid what they're ahead by. The balances are exact, and the original cost goes in the note.
- **Rows that change nobody's balance** are left out, and the app tells you how many.
- **Other currencies** ask for a rate.
- **Categories** are mapped (Splitwise "Dining out" becomes Dining).

**The check.** Splitwise ends the file with a "Total balance" row. After building the group, Allsquare compares every person's balance with that row and shows "✓ Every balance matches Splitwise exactly", or lists any differences. Nothing leaves your phone.

## 15. The scan server (Stage 3a)

The Azure key must never be inside the app, because anyone could read it from there. So the phone sends the photo to a tiny **Supabase Edge Function**, which:
1. holds the Azure key as a secret,
2. sends the photo to Azure and waits for the answer,
3. returns only the receipt fields (store, items, totals), not the raw text of the whole receipt, so card numbers don't travel further,
4. gives plain-English errors ("This month's free scans are used up. You can still type the items in.").

The photo is shrunk to about 2200 px first, which is enough for small print and quick on mobile data. Tested end to end here against a fake Azure: the photo went in, items came out, and a deliberately dropped line was caught by the total check.

## 16. Hosting (Stage 2)

`.github/workflows/deploy.yml` runs on every push to GitHub. It runs all the tests, builds the app, and publishes it on GitHub Pages. **If any money test fails, nothing is published.** Setup steps are in `setup-online.md`.

## 17. The design (from `SplitFree_Design_Spec.md`)

- **Home**: one balance card per group, hidden until you tap the eye. Swipe sideways between groups.
- **Glass** is used only for floating things (tab bar, + button, round buttons, toasts).
- **Sheets** slide up and can be swiped down to close.
- **The + menu** fans out Scan receipt, Settle up and Add expense.
- **Swipe up to confirm** anything that moves money: the page flies off, the screen floods green, a dome rises, and a toast confirms it.
- **Demo**: "Try the demo" on the sign-in or empty Home screen. In the demo, long-press the wordmark to reset it.

## 18. Accounts, sharing and live updates (Stage 3b)

**Three modes** (`store.ts`): *cloud* (signed in, data in Supabase), *local* (no server set up, data stays in this browser), *demo* (sample data in memory, never saved). The screens are the same in all three; only where data goes changes. Every change shows on screen instantly, then is saved and re-read from the database so all phones agree.

**Signing in** (`Auth.tsx`): Google, or an email with a link *and* a 6-digit code (the code matters on iPhone, where a link opens Safari instead of the home-screen app). People opening an invite can also **continue as a guest** (a Supabase "anonymous" account). A guest can later add their email under Account to keep their groups.

**Who sees what** (`supabase/migrations/001_shared_groups.sql`): the database itself checks every read and write. You only see groups where one of the members is linked to you. A member row can only be linked to an account through an invite, and you can't move people between groups. This was tested with 26 checks on a real Postgres database.

**Invites**: every group has a secret code. The link is `…/allsquare/?join=CODE`. The friend picks their name from the list (so everything already added for "Rahul" becomes theirs) or adds themselves. **Make a new link** stops old links working.

**Picking your own items** (`ReceiptFlow.tsx`): after checking the receipt, choose **Everyone picks their own**. The receipt is saved as "open" and each person gets a link `…?join=CODE&receipt=ID`. Everyone taps **Me** on what they had; taps appear on every phone within a second. Whoever scanned it sets the payer and tip and swipes up to turn it into a normal expense. Open receipts show on Home under **Pick your items**.

**Emails** (`supabase/functions/notify`): the app asks the server to email someone an invite, a "pick your items" link, or a reminder. The server checks you're in the group, uses only the group's real link (never a link made up by a phone), sends through Resend, and allows one email of each kind per person per day.

**Texts** (`messaging.ts`): free, from your own number. The **Text** button opens your Messages app with the words and link already typed (`sms:` link; iPhones and Android need slightly different formats). **Share another way** opens WhatsApp, Instagram and so on.

**Moving old groups**: groups saved on a phone before accounts existed can be moved into your account once (Home banner → Review).

## 19. Stages

1. Groups, balances, settle up. **Done.**
1.5. Design + Pro features. **Done.**
2. Free hosting on GitHub Pages. **Done.**
3a. Scan server. **Done.**
3b. Accounts, shared live groups, invites, own-phone claiming, emails and texts. **Code done and tested against a stand-in server; needs the setup steps in `setup-online.md`, then a real test together.**
4. Receipt splitting, claiming, remembered items. **Done.**
5. Splitwise import. **Done; confirm with a real export.**
Later: automatic texts (Twilio), photos stored online, automatic exchange rates.

## 20. Running it on your laptop

1. Install Node.js (LTS) from nodejs.org.
2. In the project folder, run `npm install` once.
3. Run `npm run dev` and open the link it prints.
4. Run `node --test test/*.test.ts` to run the tests.
