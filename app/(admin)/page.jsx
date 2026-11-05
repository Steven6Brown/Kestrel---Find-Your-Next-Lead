import { requireUser } from "@/lib/auth";
import Link from "next/link";
import Flash from "@/components/Flash";
import { StatusPill } from "@/components/Chips";
import AutoRefresh from "@/components/AutoRefresh";
import PageHeader from "@/components/PageHeader";
import StatTiles from "@/components/StatTiles";
import NextStep from "@/components/NextStep";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { listCampaigns, listRuns, stats } from "@/lib/store";
import { frequencyLabel, nextRun, timeLabel } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scan areas" };

const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never");

export default async function Overview({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const [s, campaigns, runs] = await Promise.all([
    stats(DEFAULT_BRAND_ID), listCampaigns(DEFAULT_BRAND_ID), listRuns(DEFAULT_BRAND_ID, { limit: 8 }),
  ]);
  const tiles = [
    { label: "Found, no website", value: s.noWebsite, sub: "Check them, then draft", href: "/leads", icon: "list" },
    { label: "Already have a site", value: s.hasWebsite, sub: "Possible redesigns", href: "/redesign", icon: "target" },
    { label: "Drafts to review", value: s.awaitingReview, sub: `${s.approved} approved to send`, href: "/queue", icon: "mail" },
    { label: "Emails sent", value: s.sent, sub: "Contacted", href: "/queue?status=sent", icon: "mail" },
  ];

  return (
    <div className="reveal">
      <AutoRefresh active={runs.some((r) => r.status === "running")} />
      <PageHeader
        title="Scan areas"
        subtitle="Campaigns look for businesses on a schedule. Nothing is ever emailed automatically."
        actions={<Link href="/campaigns/new" className="btn btn-primary">New campaign</Link>}
      />
      <NextStep here="/" />
      <div className="mb-6"><Flash sp={sp} /></div>

      <StatTiles tiles={tiles} label="Scan results" />

      <section aria-labelledby="camp-h" className="mt-10">
        <h2 id="camp-h" className="text-2xl font-semibold">Campaigns</h2>
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
                    <td className="p-3">{r.trigger === "schedule" ? "Scheduled" : r.trigger === "verify" ? "Website check" : r.trigger === "audit" ? "Quality check" : "Manual"}</td>
                    <td className="p-3"><StatusPill status={r.status} />{r.status === "running" ? <span className="ml-2 text-sm text-muted">{r.searches} of {r.total_searches} {r.trigger === "verify" ? "areas" : r.trigger === "audit" ? "sites" : "searches"}, {r.found} {r.trigger === "verify" || r.trigger === "audit" ? "checked" : "found"} so far</span> : null}{r.error ? <p className="mt-1 text-sm text-muted">{r.error}</p> : null}</td>
                    <td className="p-3">{r.trigger === "audit" ? `${r.found} checked, ${r.has_website} scored` : r.trigger === "verify" ? `${r.found} checked, ${r.has_website} have a website` : `${r.created} of ${r.found} found`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </div>
  );
}
