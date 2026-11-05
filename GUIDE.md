# Kestrel: how to start it, test it, and use it

Every step says what you should see. If you do not see it, stop and tell me which step.

## 0. Start and stop

1. Open PowerShell in the `kestrel` folder.
2. Run `npm run dev`. Open the address it prints (for example http://localhost:3002). Other apps may hold 3000 and 3001; use the port it prints.
3. Stop it with **Ctrl+C**. Do not just close the window.
4. Optional safety check of the code: `npm test` (expect "pass 61, fail 0").

If a page ever says "Something went wrong", stop with Ctrl+C and run `npm run dev` again.

## 1. Sign in

1. First time only: the page says **Create the owner account**. Fill it in. Use a long password (a short phrase works).
2. You land signed in. Later visits show **Sign in**.
3. Click your name (top right) for **Account and security**. Turn on two-factor if you want it (scan the code with an authenticator app, save the recovery codes).
4. **Log out** is top right.

## 2. Find businesses (the scanner)

1. Click **Scanner** (the page at `/`), then **New campaign**.
2. Pick a **state**, wait for the cities to load (the first time can take a minute), tick a few cities (or **Select all cities**), choose **Manual only**, **Save campaign**.
3. Press **Run now**. You should see "Running: 2 of 6 searches, 70 found so far". It refreshes itself. The free map servers are slow, so give it 5 to 20 minutes per city.
4. When it says **Done**, businesses are saved. Running the same campaign again skips areas scanned in the last 7 days.

To run on a schedule: open the campaign and copy the one-line command it shows into PowerShell (add `CRON_SECRET` to `.env.local` first).

## 3. Turn businesses into leads

1. Click **Leads**. Use the buttons to narrow the list: website (No website is the default), phone, stage, business type, city.
2. First click **Check websites (free)** at the top of Leads. Kestrel looks each business up in a free open directory (Overture Maps) and moves the ones that already have a website to the "Has a website" list. It takes a minute or two and the page updates by itself. Businesses it cannot find stay "unverified", which proves nothing, so check those yourself in the next step. The first time may need `npm install` and a restart.
3. For businesses still unverified, click **Search the web**, check whether they really have no website, then click **No website** or **Has website** on that row.
4. **Only leads ready to contact** shows the ones you can email.
5. **Download CSV** saves the current list. **Create outreach drafts for ready leads here** makes drafts (nothing is sent).

## 3b. Find websites that need a redesign

1. Run **Check websites (free)** on Leads first, so businesses that already have a website are in the "Has a website" list.
2. Click **Redesign targets**, then **Check website quality (free)**. It reads each home page once and scores it out of 100. A hundred sites takes about a minute.
3. Press a cutoff button (**Below 50**, **60**, **70** or **80**). The list shows the worst sites first, with what is holding each one back.
4. Some sites cannot be scored: ones that block robots, do not load, or are built with scripts. National chains, franchise pages, and directory or booking pages are skipped on purpose. Look at the unscored ones by hand.
5. Treat a score as a starting point, not a verdict. Only the home page is read, so a site that is fine but keeps its details on other pages can score lower than it deserves.
6. Optional: add a free `PAGESPEED_API_KEY` to `.env.local` (see `.env.example`) and restart to include Google's measured speed and accessibility.

## 4. Outreach email (when you are ready to send for real)

Nothing sends until you do all of these. You can skip this section while testing.

1. Put `RESEND_API_KEY`, `SENDER_NAME`, `SENDER_EMAIL`, `MAILING_ADDRESS` and `APP_BASE_URL` (a public https address) in `.env.local`, then restart.
2. **Review queue**: open a draft, add the recipient's email, read it, **Approve**, tick the box, **Send**.
3. Every email has your address and an unsubscribe link. Opt-outs are blocked automatically. Add replies saying STOP under **Opt-outs**.

## 5. Daily use of the CRM

1. **Today**: your follow-ups (overdue, today, this week), meetings in the next 7 days, money waiting on you, and people with no follow-up set. Press **Done** or snooze.
2. **Pipeline**: everyone you are dealing with, by stage. Use the **Move** menu on a card.
3. **Add a contact**: Pipeline, then **Add a contact** (referrals, seminar people, anyone not from a scan).
4. Open any contact: set the **stage**, add a **follow-up**, log a **note, call or reply** on the **timeline**, and **Log a meeting**. Choosing **Not interested** blocks any email to them.
5. When someone says yes, press **Convert to client**.

## 6. Clients, projects, and money

1. **Clients**: open a client, **Add a project** (name, type, status, quoted amount, dates).
2. Make sure the client has an **email**.
3. Under the project, choose **Full amount**, **50% deposit** or **Remaining balance**, then **Create draft invoice in PayPal**. Nothing is emailed yet.
4. When ready: tick the box and **Send invoice by PayPal**.
5. To see payments: **Today** or **Invoices**, press **Reconcile with PayPal**. Paid invoices show on the contact's timeline and drop out of "Money waiting on you".

First-time PayPal setup (sandbox, test money only):
1. developer.paypal.com, **Apps & Credentials**, select **Sandbox**, **Create App**.
2. Copy the Client ID and Secret into `.env.local` as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Do not paste them anywhere else. Restart.
3. **Connections**, **PayPal**, **Test connection**: expect "Connected to PayPal sandbox".
4. Use a sandbox personal account's email as your test client's email.

## 7. Calendar and meetings

1. Click **Calendar**. The month shows meetings, follow-ups due, invoices due (owners and admins), and scheduled scans. Today is highlighted. Use **Previous**, **Next**, **Today**.
2. Click a day. In the panel below, pick the person, the kind of meeting, where, and the time, then **Schedule meeting**.
3. **Download meetings (.ics)**, then in Google Calendar choose Settings, **Import & export**, and import the file.
4. **Meetings** lists upcoming and recent meetings; mark them done or cancelled.

## 8. Connections

1. **Connections** (owners and admins): paste your Google Calendar appointment page link under **Booking link** and **Save link**.
2. It then appears in new outreach drafts, on the public concept pages, and on each contact's page to paste into replies. (Drafts made earlier need **Regenerate from template**.)

## 9. People who work with you

**Users** (owners and admins): **Invite someone** (email plus role). With no email set up, the invite link is shown on screen to copy. **Audit** lists sign-ins and changes.

## 10. Ten-minute test run

Do these in order. Each should work.

1. Start, create the account, see the overview.
2. **Pipeline**, **Add a contact** "Test Person" with an email. You land on their page.
3. Set stage **Replied**, add a follow-up for tomorrow. Open **Today**: it is listed under "Coming up this week".
4. On the contact, **Log a meeting** for tomorrow 10:00. **Calendar**: it shows tomorrow. Open the day: it is in the panel.
5. **Convert to client**. Add a project "Test site" quoted `1000`.
6. **Connections**: save a booking link such as `https://cal.com/test/intro`. A bad link like `http://localhost` is refused.
7. **Calendar**, **Download meetings (.ics)**: a file downloads.
8. **Clients**, **Download clients CSV**: a file downloads with your client.
9. **Account**: change the password, then **Log out** and sign back in.
10. Optional with PayPal sandbox credentials: create a deposit invoice, send it, **Reconcile**.

## 11. If something is wrong

- Error page after an update: Ctrl+C, then `npm run dev`.
- Missing old scan results: stop Kestrel, then `node scripts/recover-legacy-data.mjs` (a dry run) and `node scripts/recover-legacy-data.mjs --yes`.
- Locked out: **Forgot your password?** With no email set up, the reset link is written to `outbox.log` in `%LOCALAPPDATA%\Kestrel`.
- Your data lives in `%LOCALAPPDATA%\Kestrel` (not in the project folder, because OneDrive can damage databases).
