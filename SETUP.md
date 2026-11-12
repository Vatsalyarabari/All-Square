# Allsquare: putting it online

## Stage 2: your own web address (GitHub Pages, free)

1. On GitHub, create a new **public** repository named `allsquare`. Leave every box unticked (no README).
2. Tell Claude it exists. Claude pushes this code to it.
   (Or upload the files yourself: "uploading an existing file", drag everything in this folder except `node_modules` and `dist`.)
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
2. **Edge Functions → Deploy a new function → Via editor.** Name it `scan-receipt`, replace the sample code with
   `supabase/functions/scan-receipt/index.ts` from this folder, and deploy.
   If your dashboard has no editor option, tell Claude and you'll get the two terminal commands instead.
3. **Edge Functions → Secrets**, add:
   - `AZURE_KEY`: KEY 1 from Azure (Keys and Endpoint page)
   - `AZURE_ENDPOINT`: `https://splitfree-receipts-vr.cognitiveservices.azure.com/`
   - `ALLOWED_ORIGIN`: `https://vatsalyarabari.github.io`
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
5. In the GitHub repository: **Settings → Secrets and variables → Actions → Variables → New variable**:
   - `VITE_SCAN_URL` = Project URL + `/functions/v1/scan-receipt`
   - `VITE_SUPABASE_ANON_KEY` = the anon public key
6. **Actions → Deploy Allsquare → Run workflow.** "Scan a photo" now works.

About the keys: the anon key is designed to be public (it ships inside the app). The Azure key stays secret in Supabase.
On Azure's Free F0 tier, going over 500 pages a month just stops scanning; it never charges.

## Stage 3b: shared groups (next)

Friends seeing the same group live, and joining by link without signing up, use the same Supabase project.
Claude builds that against your real project once steps 1 to 4 above are done, so it can be tested for real
rather than guessed.
