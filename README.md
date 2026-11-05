# SiteScout

Finds local businesses that have no website, builds a concept mockup for each, and drafts a cold email for a human to review and send. Operated by Aquila Digital LLC, built so another brand can be white-labeled later.

Nothing is ever sent automatically. Sending is a manual click on an approved draft, behind hard guardrails.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run dev
```

Requires Node 20+. With no `DATABASE_URL`, local dev uses an embedded Postgres (PGlite) stored in `./data/pglite`; production needs `DATABASE_URL`. Open http://localhost:3000. If `ADMIN_PASSWORD` is set the dashboard asks for HTTP Basic Auth (user `ADMIN_USER`, default `admin`). In production the app refuses to serve the dashboard until `ADMIN_PASSWORD` is set.

Commands: `npm test` (unit tests), `npm run lint`, `npm run build`.

## What you must provide (see `.env.example`)

| Input | Variable |
|---|---|
| Google Cloud key with Places API (New) enabled and billing on | `GOOGLE_PLACES_API_KEY` |
| Resend API key (sender domain must be verified in Resend) | `RESEND_API_KEY` |
| Sender name and email, reply-to | `SENDER_NAME`, `SENDER_EMAIL`, `REPLY_TO_EMAIL` |
| Real physical mailing address (CAN-SPAM) | `MAILING_ADDRESS` |
| Postgres connection string (production) | `DATABASE_URL` |
| Public https URL of the deployed app | `APP_BASE_URL` |
| Random secret for signed opt-out links | `APP_SECRET` |

Target cities and categories are entered in the dashboard on each run.

## The three phases

1. **Discovery.** Places API (New) Text Search per category and city. `websiteUri` comes back in the same call, so no separate Place Details request is needed. Results dedupe on Google Place ID per brand. A listing whose only "website" is Facebook, Instagram, Linktree, Yelp and similar counts as no website and is flagged "social page only".
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

Docs: [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [PRIVACY.md](PRIVACY.md), [TESTING.md](TESTING.md), [CHANGELOG.md](CHANGELOG.md).
