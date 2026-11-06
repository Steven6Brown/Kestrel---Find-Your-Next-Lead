# Privacy and data

| Data | Source | Why | Where | Retention |
|---|---|---|---|---|
| Business name, category, address, city, phone, website, maps link | Google Places API or OpenStreetMap (externally sourced) | Find leads and build concept page | Postgres `leads` | Until you delete the rows; no delete UI yet |
| Recipient email, notes | Typed by the operator | Send one reviewed email | `leads` | Same |
| Email text and send status | Generated, then edited by the operator | Review and audit trail | `drafts` | Same |
| Staff accounts: name, email, password hash, two-factor secret (encrypted), sign-in IP and device, audit events | Typed by the user or generated | Sign in, security, accountability | Postgres `users`, `sessions`, `audit_log` | Sessions until they expire or are revoked; audit log kept until you delete it |
| CRM: contact name, email, phone, how they found you, pipeline stage, timeline entries, follow-up tasks, private notes | Typed by you, or sent to you by the contact | Remember who you are dealing with and when to follow up | Postgres `leads`, `activities`, `tasks` | Kept until you delete them; there is no contact export or delete screen yet (a known gap) |
| Clients and projects: client name, email, phone, status, notes; project name, type, status, quoted amount, dates; meeting titles, times and notes | Typed by you | Track paid work and meetings | Postgres `clients`, `projects`, `meetings` | Kept until you delete them; no delete screen yet (a known gap) |
| Invoices: PayPal invoice id and number, status, amount, currency, due and paid dates, the client's email | Created by you, status read from PayPal | Bill clients and see what is paid | Postgres `invoices`; PayPal hosts the invoice and payment page | Kept until you delete them; no card or bank details ever reach Kestrel |
| Website lookups: business name, area, and coordinates are compared with the open Overture Maps dataset; the website it lists is saved with the source | Public open data (Overture Maps), read in rectangles of map data from a public file bucket | Tell which scanned businesses already have a website | Postgres `leads` | Same as leads; nothing about your own contacts is sent anywhere |
| Website quality audit: score, status and reasons for a business's public website | Kestrel reads the public home page of each lead's own website once. With a PageSpeed key set, that website address is also sent to Google PageSpeed Insights | Judge whether a site needs a redesign | Postgres `leads` | Same as leads |
| Tags and saved views: short labels you add to a contact, and names for filter settings | Typed by you | Organize contacts | Postgres `lead_tags`, `saved_views` | Tags are deleted with the contact and included in its export |
| Merged and imported contacts: the map ids of businesses merged into another contact; an uploaded CSV while you review it | Made when you merge or import | Stop a scan adding a merged business back; preview an import | Postgres `lead_aliases`, `import_batches` | Map ids deleted with the contact (and remembered as removed if the contact is deleted); an uploaded file is cleared once imported or cancelled, or after a day, and is not included in backups |
| Deals: name, kind of work, amount, chance to win, expected close date, stage, lost reason | Typed by you | Forecast the money side of a contact | Postgres `deals` | Deleted with the contact; included in the contact export |
| Backups: a full copy of every table above except sign in sessions and one time links | Made by you or by the scheduled task | Recover from a failed computer | A file in the backup folder (the Kestrel data folder, or BACKUP_DIR) | The newest 30 are kept |
| Deleted contacts: the public listing id of the business only | Kept when you delete a contact | Stop a later scan adding it back | Postgres `deleted_places` | Kept indefinitely on purpose |
| Opted-out addresses | Unsubscribe link or manual entry | Never contact again | `suppressions` | Kept indefinitely on purpose |

The light or dark choice is saved in a cookie named ks_theme (the single word light or dark, one year, no personal data). It is a preference cookie, not tracking.

Processors: Google (Places), Resend (delivery), hosting provider. No analytics, no cookies besides HTTP Basic Auth. Data is not used for any other purpose.

**Requests from a person.** On a contact's page, owners and admins can **Export this contact's data** (a JSON file of everything held about them) and **Delete this contact**. Deleting removes the contact with its drafts, timeline, follow-ups and meetings, and the concept page stops working. Kept on purpose: their email address on the do not contact list only, the public listing id of the business (so a scan does not add it back), and an audit log line with the date and who deleted it, never their details. A contact who is a client with projects or invoices cannot be deleted, because those are financial records you may need to keep; export their data instead. Every export and deletion is logged.

**Backups.** Backup files hold a full copy of the database (including password hashes and, for local use, the app secret that two factor sign in depends on), so treat them as sensitive: set BACKUP_PASSPHRASE to encrypt them before copying them anywhere. Kestrel keeps the newest 30 backups, so a deleted contact remains in older backups until newer ones replace them. There are no automatic retention rules for old leads yet.


## Social module
| Data | Source | Why | Where | Retention |
|---|---|---|---|---|
| App brand kit: name, description, colors, tone, never say list, hashtags, allowed link sites | Typed by you | Keep each app's posts on brand | `social_apps` | Until you delete or archive the app |
| Account ids and encrypted access tokens for Facebook, Instagram, LinkedIn | Pasted by you from the platform | Post for you after you approve | `social_accounts` (token encrypted) | Until you press Disconnect, which erases the token |
| Post text, hashtags, scripts, schedule, approval (who and when), result and link | Templates, typed by you, or pasted from an AI chat you ran yourself | Plan, approve and track posts | `social_posts`, `social_variants` | Until you delete the post |
| Graphics and uploaded images | Made by Kestrel, or uploaded by you (metadata stripped) | Attach to posts | `social_assets` | Kept with the app; not removed when a post is deleted (known gap) |
| Short link clicks and inquiries | Visits to your tracked links; inquiries you count | See which posts bring people in | `short_links`, totals only | Until the app is deleted. No address, browser or visitor identity is stored. |
Sent to platforms: post text and images you approved, to the platform you chose. Nothing from your contacts or CRM is used. Only if you use AI writing: that app's brand kit and the idea and facts you type are sent to a remote model API (Anthropic) (remote processing) to write drafts. Nothing from contacts, clients or the CRM is ever sent. Do not paste client or contact details into a chat when asking the AI for drafts.