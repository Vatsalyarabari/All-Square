# Allsquare (free Splitwise replacement): build plan

Status: updated 2026-11-11. Live at https://vatsalyarabari.github.io/allsquare/ (GitHub Pages; scanning on through Supabase). Stage 3b (accounts, shared groups, invites, picking your own items, emails and texts) is built and tested against a stand-in server; it switches on when Vatsalya finishes the setup in setup-online.md and adds the `VITE_SUPABASE_URL` GitHub variable. Vatsalya pushes code to GitHub himself.

## Decisions
- Name: **Allsquare** (chosen 2026-11-09; "all square" = nobody owes anything). Searches found no bill-splitting app with this name; not a trademark clearance. Square (the payments company) is a possible conflict to check before a public launch.
- Audience: friends first, public later.
- Phone delivery: installable web app (PWA) added to the home screen. $0, iPhone and Android, one codebase. No App Store or Play listing for now.
- Hosting: GitHub Pages from the public repo `vatsalyarabari/allsquare`, deployed by GitHub Actions only when tests pass.
- Sign-in (2026-11-11): Google, or email with a link plus a 6-digit code. Invited friends can continue as a guest (Supabase anonymous sign-in) and add an email later.
- New accounts start empty, with a "Try the demo" button. Groups saved on a phone before accounts can be moved in once (the old sample group is left unticked).
- Emails: sent by the app through Resend from Vatsalya's own domain (he's buying one). Limit: one email of each kind per person per day.
- Texts: free for now, sent from the user's own phone (the app opens Messages with the words and link filled in). Automatic texts (Twilio) later; they cost money and need Canadian carrier registration.
- Item picking: each person taps their own items on their own phone through a link; taps show live; whoever scanned sets payer and tip and adds it. "I'll tap for everyone" stays as the quick option.
- Import: Splitwise group CSV export (one file per group), checked against Splitwise's own "Total balance" row.
- Receipt reader: Azure Document Intelligence, prebuilt-receipt model, Free F0 tier (500 pages a month, 20 calls a minute). Resource: splitfree-receipts-vr. Called only from a Supabase Edge Function that holds the key. With Stage 3b on, only signed-in people can scan.
- Design: SplitFree_Design_Spec.md (cream and ink, Instrument Serif numbers, glass only on floating chrome, swipe up to confirm money).
- Features chosen 2026-11-09: Splitwise Pro equivalents (search, categories, charts, default split, currency conversion), receipt scan and itemizing, % and shares splits, repeats, several payers, notes and photos, remembered grocery items, pay-back notes and reminders, join by link with no signup, trip summary and CSV export. Bank transaction import: not decided.

## Done
- Stage 1, 1.5: groups, balances, debt simplification, settle up; the design; all chosen Pro features.
- Stage 2: hosting on GitHub Pages (tests gate every publish).
- Stage 3a: scan server live on Supabase.
- Stage 3b code (2026-11-11):
  - Database tables and access rules (`001_shared_groups.sql`); 26 access checks pass on a real Postgres.
  - Sign-in screen, join-by-link sheet, account sheet (guest → keep account by email), demo mode with a banner.
  - Live updates across phones; invite link with reset; per-person email and phone.
  - Shared receipts: "Everyone picks their own", live claim screen, "Pick your items" on Home, finish → itemized expense.
  - Send sheet for invites, receipt links and reminders: Text (sms: link), Email (notify function), share sheet.
  - Leave group; delete only by the creator.
  - Tested end to end in a browser against a stand-in Supabase: a guest joins by a receipt link and picks items; the owner signs in by code, emails a friend, splits leftovers, adds a tip and saves (shares add up to the cent).
- Stage 4: receipt splitting, claiming, remembered items.
- Stage 5: Splitwise import with exact balance match.
- 38 automatic tests.

## Next
- Vatsalya: setup-online.md Stage 3b steps A–G (domain, Resend, SQL, Auth settings, functions and secrets, then the GitHub variable).
- Then test together on real phones: Google and email sign-in, guest join, live claiming between two phones, an email arriving, a text opening Messages.
- Later: automatic texts (Twilio), receipt photos stored online, automatic exchange rates.

## Receipt reader test (2026-11-09, 7 real receipts, 38 lines)
- Azure: name and price right on 37 of 38 lines; every total and tax amount right; 8 of 8 tax marks read; 5 of 7 receipts perfect. The app's checks catch the misses.
- Gemini free tier: 5 of 7 failed with "high demand" or timeouts. Ruled out for now.
- Plain Tesseract OCR: 23 of 38 lines usable. Ruled out.

## Rules the app must follow
- Store money as integer cents. Rounding uses largest remainders, so splits always add up exactly.
- Store inputs (expenses, payments), never balances.
- Anything that moves money is confirmed with a swipe up, never a single tap.
- Tax goes only on the items that were actually taxed. Each tax line is shared across its own items in proportion to price.
- If a receipt doesn't mark taxed items, share the tax across all items and show a notice.
- Discounts reduce one item before tax is shared.
- "2 x item" becomes separate claimable units.
- Tip is entered by hand and shared in proportion to what each person had.
- Unclaimed items are always shown; an expense can't be saved until everything is claimed.
- Every scanned line can be edited, split or deleted by hand.
- Keep only store, date, items and totals.
- Imported balances must match Splitwise's Total balance row.
- Keys: the publishable key may ship in the app; the `sb_secret_` key, the Azure key and the Resend key never do. Email links always use the server's APP_URL, never one sent by a phone.

## Open questions
- What happens to the Azure subscription when its free trial period ends, so scanning doesn't stop.
- Trademark check on "Allsquare" (CIPO) before any public launch.
- Phone showed a 404 on the Pages address while the laptop worked (unresolved; try the all-lowercase address in a private tab).

## Needed from Vatsalya
- Stage 3b setup (setup-online.md).
- A real Splitwise group CSV, to confirm the import on real data.
