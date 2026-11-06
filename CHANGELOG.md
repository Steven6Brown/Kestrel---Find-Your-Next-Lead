# Changelog

## 2.3.0 (branch crm-core)
- Deals (under Follow up, between Pipeline and Calendar): the money side of a contact. A deal has an amount, a stage (Discovery, Proposal, Negotiation), a chance to win that starts from the stage but can be changed, and an expected close date. The Deals page shows open pipeline, forecast (amount times chance), won in the last 90 days, win rate with counts, a forecast chart by month, a board by stage with a Move button, and recently closed deals.
- Winning a deal turns the contact into a client and creates a project at the deal's amount, ready for invoicing. Losing needs a reason, and the contact is marked lost only when it has no other open deal. A lost deal can be reopened. Moving a deal to Proposal marks the contact Proposal sent.
- Deals appear on the contact page, in the contact export, in what a delete removes, and in backups. Overdue deals are a Needs attention step.

## 2.4.0 (branch crm-core): AI writing
- Social, AI writing: tell the AI what to promote and the real facts, and it writes drafts for each platform (model claude-opus-5-5, SOCIAL_AI_MODEL changes it). Drafts go through the same approval as everything else. Owner and admin only.
- Monthly spending cap (default 5 USD, SOCIAL_AI_MONTHLY_CAP_USD) with an estimate shown on the page; a call is refused before any money is spent if it could pass the cap. New dependency: @anthropic-ai/sdk. New table: ai_usage.
## 2.3.0 (branch crm-core): Social module
- New Social section (menu: Reach out, Social posts). One entry per app, each with its own brand kit (colors, tone, never say list, calls to action, hashtags, allowed link websites) and its own Facebook Page, Instagram, LinkedIn (personal profile) accounts. TikTok is assisted posting only.
- Make a post from a fill in the blank format (app promo, new version, tip, seminar, project showcase, question and answer), write your own, or paste drafts made by the AI in a chat (Import drafts shows a ready made request). The AI drafting was added afterwards (see below).
- Every post gets one draft per platform plus a template graphic at that platform's size. Each draft shows exactly what will be posted, with length, hashtag, image and never say checks. Approval needs a three item checklist and records who and when. Editing after approval undoes it.
- Scheduling and publishing: a scheduled approved post goes out via the cron endpoint `/api/cron/social` (or Post now). The publisher re-checks everything, honors a per account daily cap, never posts twice, and marks failures with a Retry.
- Tracked short links (`/l/code`): totals of clicks, plus a button to count an inquiry. Public images for Instagram and Facebook are served only through signed, expiring links (`/sm/token`).
- New dependency declared: sharp (already installed through Next.js) renders graphics and strips image metadata.
- Menu cap raised from 9 to 10 items.
## 2.2.0 (branch crm-core)
- Backups (Settings, Backups): one click saves a full, checked copy of the database. Optional encryption with BACKUP_PASSPHRASE, an optional BACKUP_DIR (another drive or synced folder), newest 30 kept, a Check button, downloads, a nightly Windows task (scripts/register-backup-task.ps1), and a Needs attention reminder after 7 days without one. scripts/restore-backup.mjs restores into a new empty folder and never overwrites.
- Contact export and delete (contact page, owners and admins): export everything held about a contact as a JSON file, or delete them after a confirmation. The email stays on the do not contact list, a later scan cannot add the business back, clients with projects are protected, and everything is logged.

## 2.1.0 (branch crm-core)
- Insights page (under Today in the menu): headline numbers, Money (owners and admins only: billed and paid per week or month, still owed, open proposals, average project, money by kind of work), where contacts get to (funnel), outreach (emails per week, results for no website and redesign emails), where wins come from (business type, city, source), and speed (days to win, overdue follow-ups, meetings held). Periods: 30 days, 90 days, 12 months, all time.
- Every percentage shows the counts behind it, and a rate over fewer than 20 items is shown as a plain count marked "too few to judge". Charts are plain SVG that follow light and dark, each with a table of the same numbers.
- Drafts now record which template made them (no website or redesign); existing drafts are filled in from the lead type.

## 2.0.0 (branch crm-core)
- New look and flow. Aquila navy sidebar with the menu in the order the work happens (Today, 1 Find, 2 Reach out, 3 Follow up, 4 Deliver, Admin), light page with white cards by default, and a light and dark toggle that is remembered in a cookie (no flash on load). On phones the menu opens from a Menu button.
- Fewer places to look: Leads and Redesign targets are one Prospects area with tabs; Meetings sit under Calendar; Opt-outs, Connections, Users, Audit and Account are under Settings, which also holds the email setup checklist; the scanner page no longer repeats the draft button or a second pipeline.
- Today is the home page: clickable summary tiles, a Needs attention list, and a Next step line on Scan areas, Prospects, Redesign targets, and Review drafts that links each step to the next.
- Contrast checked on 16 pages in both themes (no failures); phone layout checked.

## 1.4.1 (branch crm-core)
- Business is closed: mark a lead closed (button on the lead page and on unverified rows, undo with Reopen). Closed businesses leave lead lists, website checks, redesign targets, overview counts and outreach, any unsent draft is rejected, sending is blocked, and a rescan does not reopen them. Find them under Business status, Closed businesses.

## 1.4.0 (branch crm-core)
- Redesign concepts: a scored site gets a concept page (public link, never indexed) that adds a plain "what an automated check noticed" section, dated, with the limits of the check stated. Nothing is copied from their site.
- Redesign email: a separate template that says what was looked at, lists at most three measured findings, links the concept, and keeps the same unsubscribe, address and review rules. Create drafts one at a time or for every site below a cutoff from Redesign targets. Nothing is sent automatically.
- Fixed: headings on every concept page were white on a light background (invisible); the audit's wording is now safe to quote to a business owner, with a test.

## 1.3.0 (branch crm-core)
- Redesign targets page: a free quality check scores each lead's own website out of 100 (HTTPS, phone layout, page structure, image descriptions, current code, speed, contact links, freshness, search and sharing tags) and lists sites below a cutoff you pick (50, 60, 70 or 80) with plain reasons. Optional free PageSpeed key adds Google's measured scores.
- Sites that block automated visitors, do not load, or are built entirely with scripts are not scored. National chains, franchise pages and directory or booking listings are skipped.
- The Leads page now counts how many leads a website check would actually look up.

## 1.2.0 (branch crm-core)
- Free website check: looks each unverified OpenStreetMap lead up in Overture Maps (open data, no account or billing) and moves leads that already have a website out of the no-website list. Social-only pages stay as "Social page only". Leads stay unverified when nothing is found. Leads now store coordinates.

## 1.1.0 (branch crm-core)
- Calendar page with month grid, day panel, scheduling, and an .ics download for Google Calendar. GUIDE.md added.

## 1.0.1 (branch crm-core)
- A connection made before the schema grew now repairs itself (missing table or column triggers a one-time schema update and a retry) instead of showing an error page after a hot reload.
- Recovery tool for scan results left in the old in-project database folder.

## 1.0.0 (branch crm-core)
- PayPal invoicing: create draft, send with confirmation, reconcile payments, outstanding money on Today, Invoices page. Tested against a stand-in PayPal.

## 0.9.0 (branch crm-core)
- Connections page and connector layer (booking link, PayPal test, Resend status, Google Calendar placeholder). Booking link added to outreach drafts and concept pages.

## 0.8.0 (branch crm-core)
- Clients and projects, manual meetings with a Meetings page and Today list, CSV exports of contacts, clients and projects.

## 0.7.0 (branch crm-core)
- CRM core: pipeline stages, append-only timeline, follow-up tasks, a Today screen, a Pipeline board, manual contacts, and stage filtering in the Leads database.

## 0.6.0
- Campaigns now scan every business in the chosen cities (no business types). New filterable Leads database with counts, CSV download, bulk outreach drafts from a filter, and inline website checks. Resumable scans.

## 0.5.0
- Fixed the database being treated as damaged after every unclean stop (stale lock file), which made the app ask to create an account again. Data moves to the app data folder outside OneDrive and existing data is migrated automatically.
- Scan progress shown live, 25 minute limit, early stop after repeated server failures, cut-off scans marked interrupted.

## 0.4.0
- Campaigns picked with buttons only, scheduled through Windows Task Scheduler scripts and a bearer-protected endpoint; run history; retries across Overpass mirrors; verify-before-outreach for OpenStreetMap leads.
- Aquila Digital branding (colors, fonts, logo) across the app.
- Full sign-in system: sessions, logout, password reset, invitations, roles, lockout, two-factor with recovery codes, session management, audit log. Replaces the shared Basic Auth password.

## 0.3.0
- Free OpenStreetMap discovery source (default); Google Places now optional. Source-neutral email and mockup wording, OSM attribution, verify-first warning.

## 0.2.0
- Replaced SQLite with Postgres: `pg` for production (`DATABASE_URL`), PGlite for local dev and tests. Data layer is now async.

## 0.1.0
- Phase 1 discovery with dedupe and no-website / has-website split.
- Phase 2 hosted mockup per no-website lead.
- Phase 3 draft queue, guarded manual send via Resend, signed unsubscribe and suppression list.
- Brand config layer and per-brand data scoping.
