import { requireUser } from "@/lib/auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import Flash from "@/components/Flash";
import { StatusPill } from "@/components/Chips";
import AutoRefresh from "@/components/AutoRefresh";
import { deleteCampaignAction, runCampaignAction, toggleCampaignAction } from "../../actions";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { getCampaign, listRuns } from "@/lib/store";
import { frequencyLabel, nextRun, registerCommand, timeLabel, titleCase } from "@/lib/campaigns";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign" };

const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never");

export default async function CampaignPage({ params, searchParams }) {
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const cid = Number(id);
  const c = Number.isInteger(cid) ? await getCampaign(DEFAULT_BRAND_ID, cid) : null;
  if (!c) notFound();
  const runs = await listRuns(DEFAULT_BRAND_ID, { campaignId: c.id, limit: 10 });
  const next = c.enabled ? nextRun(c.frequency, c.run_time) : null;
  const cmd = registerCommand(c.id, c.frequency, c.run_time);
  const secretSet = (process.env.CRON_SECRET || "").length >= 16;

  return (
    <div className="reveal">
      <AutoRefresh active={runs.some((r) => r.status === "running")} />
      <p><Link href="/" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back to scan areas</Link></p>
      <p className="eyebrow mt-2">Campaign</p>
      <h1 className="mt-1 text-4xl font-semibold">{c.name}</h1>
      <div className="mt-4"><Flash sp={sp} /></div>

      <dl className="card grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
        <div>
          <dt className="eyebrow !text-muted">What it scans</dt>
          <dd className="mt-1">{c.categories[0] === "all" ? "Every business in the cities below, with or without a website" : c.categories.map(titleCase).join(", ")}</dd>
        </div>
        <div>
          <dt className="eyebrow !text-muted">Cities</dt>
          <dd className="mt-1">{c.locations.join(" · ")}</dd>
        </div>
        <div>
          <dt className="eyebrow !text-muted">Schedule</dt>
          <dd className="mt-1">{c.frequency === "manual" ? "Manual only" : `${frequencyLabel(c.frequency)}, ${timeLabel(c.run_time)}`}{!c.enabled ? " (paused)" : ""}</dd>
        </div>
        <div>
          <dt className="eyebrow !text-muted">Next run</dt>
          <dd className="mt-1">{next ? fmt(next.toISOString()) : "Not scheduled"}</dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-wrap gap-3">
        <form action={runCampaignAction}>
          <input type="hidden" name="campaignId" value={c.id} />
          <button type="submit" className="btn btn-primary">Run now</button>
        </form>
        <form action={toggleCampaignAction}>
          <input type="hidden" name="campaignId" value={c.id} />
          <input type="hidden" name="enabled" value={c.enabled ? "false" : "true"} />
          <button type="submit" className="btn">{c.enabled ? "Pause" : "Resume"}</button>
        </form>
        <form action={deleteCampaignAction}>
          <input type="hidden" name="campaignId" value={c.id} />
          <button type="submit" className="btn">Delete</button>
        </form>
      </div>

      {cmd && (
        <section aria-labelledby="sch-h" className="card mt-8 p-5">
          <h2 id="sch-h" className="text-2xl font-semibold">Run it automatically with Windows Task Scheduler</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted">
            <li>
              Add a long random <code className="text-ink">CRON_SECRET</code> to <code className="text-ink">.env.local</code> and restart the app.{" "}
              <strong className={secretSet ? "text-ok" : "text-warn"}>{secretSet ? "It is set." : "It is not set yet."}</strong>
            </li>
            <li>Open PowerShell in the project folder and run this once:</li>
          </ol>
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded border border-line bg-paper p-4 text-sm text-ink"><code>{cmd}</code></pre>
          <p className="mt-3 text-sm text-muted">
            The app has to be running at that time (for example <code className="text-ink">npm run start</code> left open or started at logon).
            Each scheduled call is logged to <code className="text-ink">data\scheduler.log</code>, and results appear below.
          </p>
        </section>
      )}

      <section aria-labelledby="hist-h" className="mt-10">
        <h2 id="hist-h" className="text-2xl font-semibold">Run history</h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-muted">No runs yet.</p>
        ) : (
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[600px] text-left">
              <caption className="sr-only">Run history</caption>
              <thead className="border-b border-line">
                <tr>{["Started", "How", "Result", "Found", "New", "No website"].map((h) => <th key={h} scope="col" className="p-3 eyebrow !text-muted">{h}</th>)}</tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                    <td className="p-3">{fmt(r.started_at)}</td>
                    <td className="p-3">{r.trigger === "schedule" ? "Scheduled" : "Manual"}</td>
                    <td className="p-3"><StatusPill status={r.status} />{r.status === "running" ? <span className="ml-2 text-sm text-muted">{r.searches} of {r.total_searches} searches, {r.found} found so far</span> : null}{r.error ? <p className="mt-1 text-sm text-muted">{r.error}</p> : null}</td>
                    <td className="p-3">{r.found}</td>
                    <td className="p-3">{r.created}</td>
                    <td className="p-3">{r.no_website}</td>
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
