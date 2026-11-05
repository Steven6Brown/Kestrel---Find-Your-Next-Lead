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
| Opted-out addresses | Unsubscribe link or manual entry | Never contact again | `suppressions` | Kept indefinitely on purpose |

Processors: Google (Places), Resend (delivery), hosting provider. No analytics, no cookies besides HTTP Basic Auth. Data is not used for any other purpose.

Known gap: no per-lead delete or export control yet; delete rows directly in the database when someone requests removal (keep their address on the suppression list).
