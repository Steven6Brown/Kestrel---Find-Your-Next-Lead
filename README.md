# Kestrel

Finds local businesses that have no website, builds a concept mockup for each, and drafts a cold email for a human to review and send. Operated by Aquila Digital LLC, built so another brand can be white-labeled later.

Nothing is ever sent automatically. Sending is a manual click on an approved draft, behind hard guardrails.

New here? **GUIDE.md** is the short step-by-step guide to starting, testing and using everything.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run dev
```

Requires Node 20+. With no `DATABASE_URL`, local dev uses an embedded Postgres (PGlite) stored in `./data/pglite`; production needs `DATABASE_URL`. Open http://localhost:3000. The first visit shows a one-time **Create the owner account** page (on localhost nothing else is needed; on a hosted URL set `SETUP_TOKEN` and enter it there). After that everything is behind sign-in: email and password, optional two-factor codes, password reset by emailed link, invitations, roles, session management and an audit log (see SECURITY.md). With no email provider configured, reset and invite links are written to `data/outbox.log` so you can test locally.

Commands: `npm test` (unit tests), `npm run lint`, `npm run build`.

## What you must provide (see `.env.example`)

| Input | Variable |
|---|---|
| Contact for OpenStreetMap requests (free source) | `OSM_CONTACT` |
| Optional: Google Cloud key with Places API (New) and billing, only for `DISCOVERY_PROVIDER=google` | `GOOGLE_PLACES_API_KEY` |
| Resend API key (sender domain must be verified in Resend) | `RESEND_API_KEY` |
| Sender name and email, reply-to | `SENDER_NAME`, `SENDER_EMAIL`, `REPLY_TO_EMAIL` |
| Real physical mailing address (CAN-SPAM) | `MAILING_ADDRESS` |
| Postgres connection string (production) | `DATABASE_URL` |
| Public https URL of the deployed app | `APP_BASE_URL` |
| Random secret (required on Vercel; auto-generated locally) | `APP_SECRET` |
| Scheduler secret (32+ random characters) | `CRON_SECRET` |
| Hosted first-run claim code | `SETUP_TOKEN` |

Target cities and categories are entered in the dashboard on each run.

## The three phases

1. **Discovery.** Default source is **OpenStreetMap** (Nominatim plus Overpass): free, no key, no billing. Set `OSM_CONTACT` to your email or URL (their usage policy requires it). Categories are limited to a built-in list (plumber, restaurant, barber, dentist and about 35 more, see `lib/overpass.js`). OSM data is volunteer-maintained, so a missing website tag often just means nobody added it; the lead page warns you to verify by hand before outreach. Optional paid source: set `DISCOVERY_PROVIDER=google` to use the Places API (New), where `websiteUri` comes back in the same call. Results dedupe on Google Place ID per brand. A listing whose only "website" is Facebook, Instagram, Linktree, Yelp and similar counts as no website and is flagged "social page only".
2. **Mockup.** Each no-website lead gets an unguessable hosted page at `/m/<token>`, rendered from real data (name, category, city, phone, address). Unknowns are marked placeholders; copy is labeled draft; no stock photos, gradients, purple, or three-card rows. Pages are `noindex`.
3. **Outreach.** A draft is created per lead and lands in the review queue. You add a recipient email (Google does not provide one), edit, approve, tick "I reviewed this", and click send.

## Send guardrails (all enforced server side, `lib/email.js`)

Draft approved; valid recipient saved; address not opted out; brand sender and physical address set and present in the body; unsubscribe link present (signed per recipient, plus `List-Unsubscribe` one-click headers); no unfilled placeholders; `APP_BASE_URL` is public https; Resend key and secret set; daily cap (`SEND_DAILY_CAP`, default 10).

Opt-outs: link clicks are recorded instantly. For replies saying STOP, add the address on the Opt-outs page the same day (legal limit is 10 days).

## White-label design

Brand data lives in `config/brands.js` and is passed as a `brand` object to the mockup and email code. Every table row is scoped by `brand_id`. Adding a brand means adding a config entry; no core logic changes. Not built for v1: per-brand logins, billing, or a brand picker in the UI (the dashboard uses the default brand).

## Deploying to Vercel

1. Create a Neon (or Vercel Postgres) database and copy the pooled connection string.
2. `vercel link`, then add every variable from `.env.example` in the Vercel project settings (`DATABASE_URL`, `APP_BASE_URL` set to the production https URL, `ADMIN_PASSWORD`, `APP_SECRET`, and so on).
3. Deploy. Tables are created automatically on first use (`CREATE TABLE IF NOT EXISTS`).

Mockup and opt-out links must be publicly reachable, so the app has to be hosted before real email goes out. Note that the in-memory rate limiter and send lock are per serverless instance.

## Campaigns and the Leads database

A campaign is just where to scan: pick a state, tick the cities (or Select all), choose a schedule. Kestrel then collects **every named business** in those cities, with or without a website, into one database. There is no business type to decide up front.

The **Leads** page is where you decide who becomes a lead. Narrow the list with buttons: website (none, social page only, has one), phone number, website check, status, ready for outreach, business type and city (with counts). Then create outreach drafts for the ready leads in that view, or download the view as a CSV. A scan is split into six business families per city, remembers what it finished, and a rerun skips anything scanned in the last 7 days, so a scan that hit its time limit simply continues next time.

## PayPal invoicing (sandbox first)

1. Sign in at developer.paypal.com, open Apps & Credentials, make sure the **Sandbox** toggle is selected, and create an app. Copy its Client ID and Secret.
2. Put them in `.env.local` yourself (never paste them into chat): `PAYPAL_CLIENT_ID=...` and `PAYPAL_CLIENT_SECRET=...`. Leave `PAYPAL_ENV=sandbox`. Restart Kestrel.
3. Open **Connections** and press **Test connection** on PayPal.
4. On a client's page, give the project a quoted amount and make sure the client has an email. Choose Full amount, 50% deposit or Remaining balance and press **Create draft invoice in PayPal**. Nothing is emailed yet.
5. Review it, tick the confirmation box, and press **Send invoice by PayPal**. PayPal emails the client and hosts the payment page. For testing, use the email of a sandbox personal account as the client email.
6. Payments appear when you press **Reconcile with PayPal** (on Today or Invoices). Kestrel runs on your computer, so PayPal cannot call it; Reconcile asks PayPal instead.

Live money stays blocked until you deliberately set `PAYPAL_ALLOW_LIVE=1` and `PAYPAL_ENV=live` with live credentials. Cancelling a sent invoice is not built yet; do that in PayPal.

## If older scan results seem to be missing

Versions before 0.5 kept the database inside the project folder (`data`). Kestrel now keeps it in the app data folder and copies the old data over automatically the first time, but only if the new location does not exist yet. If it was created empty first (for example by a server that was already running), your old results stay in `data`. To bring them over without touching your current login:

```bash
node scripts/recover-legacy-data.mjs
node scripts/recover-legacy-data.mjs --yes
```

Stop Kestrel first. The first command is a dry run that only reports counts. The second backs up your current database, then adds the old leads, searches and runs, skipping anything that already exists.

## Where your data lives

The local database, generated secret and mail outbox are kept in %LOCALAPPDATA%\Kestrel (override with `KESTREL_DATA_DIR`), not in the project folder, because this project sits under OneDrive and cloud sync can damage a database's many small files. On the first start of a version that does this, existing data from the old `data\pglite` folder is copied over automatically and the old copy is left as a backup.

Stop the app with Ctrl+C (or close the terminal) as usual. If it is ever stopped abruptly, the next start clears the leftover lock and keeps your data, and any scan that was cut off is marked "Interrupted". Only one copy of the app can use the local database at a time.

Scans use the free OpenStreetMap servers, which are sometimes slow or busy (one search can take a minute or more). A running scan shows live progress (searches done, leads found), stops after 25 minutes, and gives up early if three searches in a row fail. Results found so far are always saved.

## Scheduled scans (Windows Task Scheduler)

Campaigns are picked with buttons only (state, cities, schedule). Open a campaign and the page shows the exact one-line command to register it, for example:

```powershell
.\scripts\register-task.ps1 -CampaignId 1 -Schedule Daily -Time 06:00
```

Add `CRON_SECRET` to `.env.local` first. The task calls the running app (`scripts/run-campaign.ps1`, logged to `data\scheduler.log`), so the app must be running at that time, for example `npm run build` then `npm run start` left open or started at logon. The result appears under Run history. Remove a job with `Unregister-ScheduledTask -TaskName "Kestrel campaign 1"`.

Docs: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), [TESTING.md](TESTING.md), [CHANGELOG.md](CHANGELOG.md).
