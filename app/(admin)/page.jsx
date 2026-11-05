import { requireUser } from "@/lib/auth";
import Link from "next/link";
import Flash from "@/components/Flash";
import { StatusPill } from "@/components/Chips";
import AutoRefresh from "@/components/AutoRefresh";
import { draftAllAction } from "./actions";
import { DEFAULT_BRAND_ID, getBrand, brandReadiness } from "@/config/brands";
import { listCampaigns, listRuns, stats } from "@/lib/store";
import { baseUrl, isPublicHttps } from "@/lib/tokens";
import { frequencyLabel, nextRun, timeLabel } from "@/lib/campaigns";
import { provider } from "@/lib/discovery";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never");

export default async function Overview({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const [s, campaigns, runs] = await Promise.all([
    stats(DEFAULT_BRAND_ID), listCampaigns(DEFAULT_BRAND_ID), listRuns(DEFAULT_BRAND_ID, { limit: 8 }),
  ]);
  const brand = getBrand(DEFAULT_BRAND_ID);
  const scraperIssues = provider() === "google" && !process.env.GOOGLE_PLACES_API_KEY
    ? ["DISCOVERY_PROVIDER is google but GOOGLE_PLACES_API_KEY is not set."] : [];
  const emailSetup = [
    ...brandReadiness(brand),
    ...(process.env.RESEND_API_KEY ? [] : ["RESEND_API_KEY is not set, so sending is disabled."]),
    ...(isPublicHttps(baseUrl()) ? [] : ["APP_BASE_URL is not a public https URL, so emailed links would not work for recipients."]),
  ];
  // Pipeline order, left to right: how a lead moves through the system.
  const pipeline = [
    ["Found", s.noWebsite, "No website"],
    ["Drafted", s.awaitingReview, "Awaiting review"],
    ["Approved", s.approved, "Ready to send"],
    ["Sent", s.sent, "Contacted"],
  ];

  return (
    <div className="reveal">
      <AutoRefresh active={runs.some((r) => r.status === "running")} />
      <p className="eyebrow">Overview</p>
      <h1 className="mt-1 text-4xl font-semibold">Lead pipeline</h1>
      <p className="mt-2 max-w-2xl text-lg text-muted">
        Campaigns scan for businesses without a website on a schedule. Nothing is ever emailed automatically.
      </p>
      <div className="mt-6"><Flash sp={sp} /></div>

      <section aria-labelledby="pipe-h" className="mt-4">
        <h2 id="pipe-h" className="sr-only">Pipeline</h2>
        <ol className="card grid grid-cols-2 lg:grid-cols-4">
          {pipeline.map(([label, n, sub], i) => (
            <li key={label} className="border-b border-r border-line p-4 last:border-r-0">
              <p className="eyebrow !text-muted">{String(i + 1).padStart(2, "0")} {label}</p>
              <p className="mt-1 text-4xl font-semibold text-ink">{n}</p>
              <p className="text-sm text-muted">{sub}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-muted">
          Also tracked: {s.hasWebsite} businesses that already have a website (future redesign leads) and {s.optOuts} opt-outs.
        </p>
      </section>

      {scraperIssues.length > 0 && (
        <section aria-labelledby="setup-h" className="mt-8 border border-warn bg-warn-bg p-4 text-warn">
          <h2 id="setup-h" className="text-xl font-semibold !text-warn">Scraper setup needed</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">{scraperIssues.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      )}

      <section aria-labelledby="camp-h" className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="camp-h" className="text-2xl font-semibold">Campaigns</h2>
          <Link href="/campaigns/new" className="btn btn-primary">New campaign</Link>
        </div>
        {campaigns.length === 0 ? (
          <p className="card mt-4 p-5 text-muted">No campaigns yet. A campaign is a saved scan: pick business types and cities, choose a schedule, and it finds leads for you.</p>
        ) : (
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <caption className="sr-only">Campaigns</caption>
              <thead className="border-b border-line text-muted">
                <tr>
                  <th scope="col" className="p-3 eyebrow !text-muted">Campaign</th>
                  <th scope="col" className="p-3 eyebrow !text-muted">Schedule</th>
                  <th scope="col" className="p-3 eyebrow !text-muted">Next</th>
                  <th scope="col" className="p-3 eyebrow !text-muted">Last run</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const next = c.enabled ? nextRun(c.frequency, c.run_time) : null;
                  return (
                    <tr key={c.id} className="border-b border-line last:border-b-0">
                      <th scope="row" className="p-3 font-semibold">
                        <Link href={`/campaigns/${c.id}`} className="inline-flex min-h-[44px] items-center text-ink underline underline-offset-4 hover:text-brand-hover">{c.name}</Link>
                        {!c.enabled && <span className="ml-2 text-sm font-normal text-muted">(paused)</span>}
                      </th>
                      <td className="p-3">{c.frequency === "manual" ? "Manual only" : `${frequencyLabel(c.frequency)}, ${timeLabel(c.run_time)}`}</td>
                      <td className="p-3">{next ? fmt(next.toISOString()) : "Not scheduled"}</td>
                      <td className="p-3">{fmt(c.last_run_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="runs-h" className="mt-10">
        <h2 id="runs-h" className="text-2xl font-semibold">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-muted">No scans have run yet.</p>
        ) : (
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <caption className="sr-only">Recent scans</caption>
              <thead className="border-b border-line">
                <tr>
                  {["Started", "Campaign", "How", "Result", "New leads"].map((h) => (
                    <th key={h} scope="col" className="p-3 eyebrow !text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                    <td className="p-3">{fmt(r.started_at)}</td>
                    <td className="p-3">{r.campaign_name}</td>
                    <td className="p-3">{r.trigger === "schedule" ? "Scheduled" : r.trigger === "verify" ? "Website check" : "Manual"}</td>
                    <td className="p-3"><StatusPill status={r.status} />{r.status === "running" ? <span className="ml-2 text-sm text-muted">{r.searches} of {r.total_searches} {r.trigger === "verify" ? "areas" : "searches"}, {r.found} {r.trigger === "verify" ? "checked" : "found"} so far</span> : null}{r.error ? <p className="mt-1 text-sm text-muted">{r.error}</p> : null}</td>
                    <td className="p-3">{r.trigger === "verify" ? `${r.found} checked, ${r.has_website} have a website` : `${r.created} of ${r.found} found`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="out-h" className="card mt-10 p-5">
        <h2 id="out-h" className="text-2xl font-semibold">Outreach drafts</h2>
        <p className="mt-2 text-muted">Create a draft for every no-website lead that does not have one yet. They go to the review queue.</p>
        <form action={draftAllAction} className="mt-4"><button type="submit" className="btn">Draft all new leads</button></form>
        {emailSetup.length > 0 && (
          <details className="mt-4 text-sm text-muted">
            <summary className="cursor-pointer font-semibold text-ink">Email setup (only needed before sending, safe to skip while testing)</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">{emailSetup.map((t) => <li key={t}>{t}</li>)}</ul>
          </details>
        )}
      </section>
    </div>
  );
}
