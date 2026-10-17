# Daura: setup

About 30 minutes, once. Everything here is free. You need a computer for steps 1–5; after that, everything is on the phone.

What goes where:

| Piece | Where | Holds |
|---|---|---|
| The app | GitHub Pages (public repo `daura`) | Code only. **No staff data, ever.** |
| Data, sign-in, photos | Supabase (Mumbai) | Staff list, places, visits, photos |
| "Sign in with Google" | Google Cloud project **Daura** (new, separate from Hazri) | Nothing, it only proves the Gmail |

Hazri is not touched: Daura uses no Firebase, a different Google Cloud project and a different repo.

You have two SQL files:

- `sql/01_schema.sql`: the database structure. It is in the repo and contains no data.
- `02_seed_PRIVATE.sql`: staff (with dates of birth), the 338 places and their allotments. **Keep it private.** Don't upload it to GitHub, don't forward it. Delete it after step 2.

---

## 1. Create the Supabase project

1. Go to **supabase.com** → **Start your project** → sign in (GitHub or Google is fine).
2. If asked, create an organization: any name, plan **Free**.
3. **New project**:
   - Name: `daura`
   - Database password: click **Generate a password** and save it somewhere safe (you rarely need it).
   - Region: **South Asia (Mumbai)**
   - Click **Create new project** and wait about 2 minutes.

## 2. Load the database

1. Left menu → **SQL Editor** → **New query**.
2. Open `sql/01_schema.sql`, copy everything, paste it in, click **Run**.
   - The result shows one empty column, `table_without_rls`. **Empty is correct**: it means every table is protected.
3. **New query** again. Open `02_seed_PRIVATE.sql`, copy everything, paste, **Run**.
   - The last result shows **160 staff · 338 places · 338 assigned visits**.
   - This step also makes **nkotwar@gmail.com** the admin, linked to Emp ID 139535.
4. Delete `02_seed_PRIVATE.sql` from your computer and Downloads.

Both files are safe to run again if something stops halfway.

## 3. Create the Google sign-in (new project, not Hazri's)

1. Go to **console.cloud.google.com**. In the project picker at the top, choose **New project**, name it `Daura`, then **Create**. Make sure **Daura** is selected at the top before going on.
2. Search for **Google Auth Platform** and open it → **Get started**:
   - App name: `Daura`. User support email: your Gmail.
   - Audience: **External**.
   - Contact email: your Gmail. Agree, then **Create**.
3. **Audience** (left menu) → **Publish app** → **Confirm**. The status becomes **In production**.
   - Daura only asks for name and email, so Google needs no review, there's no 100-user limit, and no weekly re-login.
4. **Clients** (left menu) → **Create client**:
   - Application type: **Web application**. Name: `Daura web`.
   - **Authorised JavaScript origins** → **Add URI** → enter exactly `https://nkotwar.github.io` (no `/daura`, no slash at the end).
   - Leave **Authorised redirect URIs** empty → **Create**.
5. Copy both the **Client ID** (ends in `.apps.googleusercontent.com`) and the **Client secret**.

## 4. Connect Google to Supabase, and turn off other sign-ins

In Supabase:

1. **Authentication → Sign In / Providers**.
2. **Google** → turn on **Enable Sign in with Google**:
   - **Client IDs**: paste the Client ID.
   - **Client Secret**: paste the secret.
   - Leave **Skip nonce checks** off → **Save**.
3. **Email** → turn **Enable Email provider** **off** → **Save**. Daura must only accept Google sign-in; that is part of how it knows who is who.
4. On the same page, check that **Allow new users to sign up** is **on**. Staff are created the first time they sign in with Google.
5. Copy two things:
   - **Project URL**: Project Settings → **Data API** (looks like `https://abcd1234.supabase.co`).
   - **Publishable key**: Project Settings → **API Keys** (starts with `sb_publishable_`). Never use the *secret* key anywhere.

Now open `config.js` and fill in the three values:

```js
const DAURA_CONFIG = {
  supabaseUrl: 'https://abcd1234.supabase.co',
  supabaseKey: 'sb_publishable_xxxxxxxx',
  googleClientId: '1234-abc.apps.googleusercontent.com'
};
```

These three are meant to be public. What protects the data is the database's access rules.

## 5. Put the app on GitHub Pages

1. On github.com, click **+ → New repository**. Name it `daura`, set it to **Public** → **Create repository**.
2. Click **uploading an existing file** and drag in everything from the Daura folder **except** the private SQL file:
   - `index.html`, `styles.css`, `config.js` (filled in), `version.js`
   - `core.js`, `auth.js`, `visits.js`, `profile.js`, `admin.js`, `main.js`, `sw.js`
   - `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`, `cbi-emblem.png`
   - `privacy.html`
   - the `sql` folder (only `01_schema.sql` is in it), `README.md`, `SETUP.md`, `.gitignore`
   - Then **Commit changes**.
3. **Settings → Pages**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)** → **Save**. After a minute or two the app is live at **`https://nkotwar.github.io/daura/`**.

## 6. Keep-alive (stops the free database from pausing)

Supabase pauses a free project after 7 days without use. A small GitHub job pings it every 5 days.

1. In the repo: **Add file → Create new file**.
2. For the name, type exactly `.github/workflows/keepalive.yml` (typing the `/` creates the folders).
3. Paste the contents of `keepalive.yml` from the Daura folder → **Commit changes**.
4. **Settings → Actions → General → Workflow permissions** → **Read and write permissions** → **Save**.
5. **Actions** tab → **Keep Daura awake** → **Run workflow**. In about 30 seconds it should show a green tick.

The job also writes the date into `.github/keepalive.txt`. That keeps the repo active, because GitHub switches off scheduled jobs after 60 days without activity. If GitHub ever emails that the workflow was disabled, open Actions and click **Enable workflow**.

## 7. On your phone

1. Open `https://nkotwar.github.io/daura/` in Chrome → menu ⋮ → **Add to Home screen / Install app**.
2. Open it from the home-screen icon → **Sign in with Google** → choose **nkotwar@gmail.com**. You land straight in, as admin.
3. **Admin → People**: everyone is listed, with who has signed up. Tap anyone for **Call** or **Invite on WhatsApp**.

## How staff get in

Share the link. On first sign-in with Google:

- **Their Gmail is in udairo.js**: they see their name, Emp ID, branch and date of birth, tap **Yes, this is me**, and they're in. About 121 of 160 staff can match this way.
- **Any other Gmail**: they pick their name, enter their date of birth, see their Emp ID, and confirm.

A person can link more than one Gmail. Every new link shows in **Admin → Activity**. You can unlink any Gmail, change roles (Field staff / Viewer / Admin), or **Block** someone, which cuts their access on every device at once. Staff can see and remove the Gmails linked to their own profile, and sign out on this phone or on all devices.

## Updating later

- **New udairo.js**: Admin → Staff list → **Upload udairo.js**. You see who is new, who moved and who left before you apply. Nobody's history is lost.
- **New app version**: upload the changed files and raise the number in `version.js`. Phones then show **Update now** in Profile.

## Moving photos to Drive

Admin → Staff list shows photo storage used, out of the free 1 GB. At **800 MB** it shows a warning. The step-by-step guide for moving photos to Google Drive comes with the photo update, and switching storage won't change anything else in the app.

## Version history

| Version | What changed | Database step |
|---|---|---|
| 1 | Sign-in, profiles, admin people & staff list | `sql/01_schema.sql` + private seed |
| 2 | Logging visits with photos, follow-ups, closures, places, branch-head and admin verification, requests | Run `sql/03_update_v2.sql` once |
| 3 | Fix: admins could not submit visits; Update now works | None |
| 4 | Dashboard for admin and viewers: progress, overdue ageing, business, verification pending, branches, types, officers, follow-ups, photos, WhatsApp nudges, summary image, Excel | None |
| 5 | Summary image lists every branch with totals and a due-tomorrow column; swipe between sections; back button steps back and asks before closing | None |
| 6 | Pull down refreshes the current tab in place; reopening or reloading keeps your tab and section | None |
| 7 | Sections slide as one continuous strip that follows your finger, with neighbours preloaded | None |
| 8 | Sections fill the screen (swipe anywhere); clear empty states with next steps | None |
| 10 | Rolled back version 9 (allotted-to list, staff summary panel, pull panels down to close). Same as version 8 | None |

---

Built by Nitin Kotwar (139535), via PDUDAIRO.
