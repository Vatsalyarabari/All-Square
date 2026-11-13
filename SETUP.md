# Allsquare: putting it online

## Stage 2: your own web address (GitHub Pages, free)

1. On GitHub, create a new **public** repository named `allsquare`. Leave every box unticked (no README).
2. Push this folder to it: `git init`, `git add .`, `git commit -m "Allsquare: first version"`, `git branch -M main`,
   `git remote add origin https://github.com/vatsalyarabari/allsquare.git`, `git push -u origin main`.
3. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Open the **Actions** tab. The "Deploy Allsquare" run tests the money maths, builds, and publishes.
   When it's green, the app is at `https://vatsalyarabari.github.io/allsquare/`.
5. Install it on a phone:
   - iPhone (Safari): Share → **Add to Home Screen**.
   - Android (Chrome): ⋮ menu → **Install app** (or Add to Home screen).

Every later change pushed to `main` republishes automatically, and only if the tests pass.

## Stage 3a: turn on receipt scanning (Supabase, free)

The phone never holds your Azure key. A small Supabase function holds it and talks to Azure.

1. Sign up at supabase.com (free plan). **New project** → name `allsquare`, pick the region nearest you (Canada if offered), set a database password and save it somewhere private.
2. **Edge Functions → Deploy a new function → Via editor.** Name it `scan-receipt`. Delete all the sample code in
   `index.ts` and paste in `supabase/functions/scan-receipt/index.ts` from this folder. Deploy.
3. Open the function's **Details / Settings** and turn **off** "Verify JWT" (it may be called "Enforce JWT verification").
   The function checks the app's publishable key itself; with this left on, every scan is rejected with a 401.
4. **Edge Functions → Secrets**, add:
   - `AZURE_KEY`: KEY 1 from Azure (Keys and Endpoint page)
   - `AZURE_ENDPOINT`: `https://splitfree-receipts-vr.cognitiveservices.azure.com/`
   - `ALLOWED_ORIGIN`: `https://vatsalyarabari.github.io`
5. **Project Settings → API Keys**: copy the **publishable** key (starts with `sb_publishable_`).
   **Project Settings → Data API** (or the Connect button): copy the **Project URL**.
6. In the GitHub repository: **Settings → Secrets and variables → Actions → Variables → New variable**:
   - `VITE_SCAN_URL` = Project URL + `/functions/v1/scan-receipt`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = the publishable key
7. **Actions → Deploy Allsquare → Run workflow.** "Scan a photo" now works.

About the keys: the publishable key is designed to be public (it ships inside the app). Never use the
**secret** key (`sb_secret_`) in the app or in GitHub variables. The Azure key stays secret in Supabase.
On Azure's Free F0 tier, going over 500 pages a month just stops scanning; it never charges.

## Stage 3b: accounts, shared groups, invites, emails and texts

Do these **in this order**. The very last step (adding `VITE_SUPABASE_URL`) is the switch that turns on
sign-in, so until then the live app keeps working exactly as it does now.

### A. Buy a domain (about $10–20 a year)
Any registrar works (Cloudflare, Namecheap, Porkbun). It's only used to send email from, e.g.
`hello@yourdomain.com`. The app itself stays at `https://vatsalyarabari.github.io/allsquare/`.

### B. Resend (sends the emails; free for 3,000 a month, 100 a day)
1. Sign up at resend.com → **Domains → Add domain** → type your domain.
2. Resend shows 3–4 DNS records (TXT/MX). Add each one at your registrar's DNS page, exactly as shown.
   Wait until Resend says **Verified** (minutes to a few hours).
3. **API Keys → Create API key** (permission: Sending access). Copy it once; it starts with `re_`. Don't paste it into chat.

### C. Supabase database (one paste)
**SQL Editor → New query** → paste all of `supabase/migrations/001_shared_groups.sql` → **Run**.
It creates the tables and the rules that decide who can see what (only people in a group see that group).

### D. Supabase sign-in settings (Authentication section; menu names can differ slightly)
1. **Sign In / Providers → Email**: on. **Allow anonymous sign-ins**: on (this is "Continue as a guest").
2. **Emails → SMTP Settings → Enable custom SMTP**:
   host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key,
   sender email `hello@yourdomain.com`, sender name `Allsquare`.
   (Without this, Supabase only sends 2 sign-in emails an hour.)
3. **Emails → Templates**: in both **Magic Link** and **Confirm signup**, add this line to the message
   so people can type the code instead of tapping the link (needed when Allsquare is on the home screen):
   `Your code: {{ .Token }}`
4. **URL Configuration**: Site URL = `https://vatsalyarabari.github.io/allsquare/`.
   Redirect URLs → add `https://vatsalyarabari.github.io/allsquare/**`
5. **Google** (optional but nice):
   - console.cloud.google.com → new project → **Google Auth Platform** (older consoles: APIs & Services → OAuth consent screen):
     app name Allsquare, your email, audience **External**, then **Publish app** so anyone can sign in.
   - **Clients → Create client** (older: Credentials → Create credentials → OAuth client ID) → Web application.
     Authorized redirect URI: `https://ufubyzygcyepzrnmpufg.supabase.co/auth/v1/callback`
   - Copy the Client ID and Client secret into Supabase **Sign In / Providers → Google**, turn it on, save.

### E. Edge Functions
1. **Deploy a new function → Via editor**, name `notify`, paste `supabase/functions/notify/index.ts`, deploy.
   In its settings turn **off** "Verify JWT with legacy secret" (same as scan-receipt).
2. Open `scan-receipt` → replace its code with the new `supabase/functions/scan-receipt/index.ts` → deploy.
   (The new one only scans for signed-in people, so strangers can't use up your free scans.)
3. **Edge Functions → Secrets**, add:
   - `RESEND_API_KEY` = the `re_` key
   - `FROM_EMAIL` = `Allsquare <hello@yourdomain.com>`
   - `APP_URL` = `https://vatsalyarabari.github.io/allsquare/`
   - `ALLOWED_ORIGIN` stays `https://vatsalyarabari.github.io`

### F. The switch: GitHub variable
GitHub repo → **Settings → Secrets and variables → Actions → Variables → New variable**:
`VITE_SUPABASE_URL` = `https://ufubyzygcyepzrnmpufg.supabase.co` → then **Actions → Deploy Allsquare → Run workflow**.

### G. Try it
1. Open the app → sign in with Google or your email (link or 6-digit code).
2. If you had groups on that phone, a banner offers to move them into your account (the old sample group is left unticked).
3. Make a group → ⚙︎ → add a friend with their email or phone → **Invite** → Text (opens your Messages app) or Email.
4. Scan a receipt → **Everyone picks their own** → send the link. Your friend taps it, continues as a guest, picks their name,
   taps **Me** on their items. You see it live, add the tip, and swipe up to add it.

### Costs and limits
Everything above is free except the domain. Texts go from your own phone number (normal texting rates).
Automatic texts sent by the app (Twilio) would cost money and need Canadian carrier registration, so they're left for later.
