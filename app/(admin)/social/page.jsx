import Link from "next/link";
import { requireUser, BRAND } from "@/lib/auth";
import * as ss from "@/lib/socialstore";
import PageHeader from "@/components/PageHeader";
import StatTiles from "@/components/StatTiles";
import Flash from "@/components/Flash";
import { AppFilter, PLATFORM_SHORT, SocialTabs, StatusPill } from "@/components/SocialBits";

export const dynamic = "force-dynamic";
export const metadata = { title: "Social" };

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function Social({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const apps = await ss.listApps(BRAND);
  const appId = apps.find((a) => String(a.id) === sp.app)?.id || null;
  const month = /^\d{4}-\d{2}$/.test(sp.m || "") ? sp.m : ymd(new Date()).slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const prev = ymd(new Date(y, m - 2, 1)).slice(0, 7);
  const next = ymd(new Date(y, m, 1)).slice(0, 7);
  const counts = await ss.statusCounts(BRAND, appId);
  const rows = await ss.listVariants(BRAND, { appId, limit: 500 });
  const stats = await ss.linkStats(BRAND, appId);
  const q = (extra) => `?${new URLSearchParams({ ...(appId ? { app: appId } : {}), ...extra })}`;

  const byDay = {};
  for (const r of rows) {
    const d = r.scheduled_at || r.published_at || r.created_at;
    (byDay[ymd(new Date(d))] ||= []).push(r);
  }
  const startPad = (first.getDay() + 6) % 7; // week starts Monday
  const daysIn = new Date(y, m, 0).getDate();
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: daysIn }, (_, i) => new Date(y, m - 1, i + 1))];
  const toReview = (counts.draft || 0) + (counts.failed || 0);

  return (
    <div className="reveal">
      <PageHeader title="Social" subtitle="Plan, approve and post for each of your apps. Nothing is posted until you approve it." actions={<Link href={`/social/new${q({})}`} className="btn btn-primary">New post</Link>} />
      <SocialTabs current="/social" appId={appId} />
      <Flash sp={sp} />
      {apps.length === 0 ? (
        <div className="card p-6">
          <h2 className="text-xl font-semibold">Start by adding your first app</h2>
          <p className="mt-1 text-muted">Each app gets its own look, its own rules and its own social accounts.</p>
          <Link href="/social/apps" className="btn btn-primary mt-4">Add an app</Link>
        </div>
      ) : (
        <>
          <AppFilter apps={apps} selected={appId} path="/social" />
          <StatTiles label="Social at a glance" tiles={[
            { label: "To review", value: toReview, sub: "drafts and failed posts", href: "/social/queue", icon: "list" },
            { label: "Approved", value: counts.approved || 0, sub: "waiting for a time", href: "/social/queue", icon: "mail" },
            { label: "Scheduled", value: counts.scheduled || 0, sub: "will post on their own", href: "/social/queue", icon: "calendar" },
            { label: "Posted", value: (counts.published || 0) + (counts.posted_manually || 0), sub: "all time", href: "/social", icon: "chart" },
          ]} />

          <section className="card mt-6 p-4" aria-labelledby="cal-h">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="cal-h" className="text-xl font-semibold">{first.toLocaleString([], { month: "long", year: "numeric" })}</h2>
              <div className="flex gap-2">
                <Link href={q({ m: prev })} className="btn">Previous</Link>
                <Link href={q({ m: ymd(new Date()).slice(0, 7) })} className="btn">This month</Link>
                <Link href={q({ m: next })} className="btn">Next</Link>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-1 text-xs font-semibold text-muted" aria-hidden="true">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-1">{d}</div>)}
            </div>
            <ol className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((d, i) => {
                const items = d ? byDay[ymd(d)] || [] : [];
                return (
                  <li key={i} className={`min-h-24 border border-line p-1 ${d ? "bg-surface" : "bg-paper"}`}>
                    {d && <span className="text-xs text-muted">{d.getDate()}</span>}
                    <ul className="mt-1 space-y-1">
                      {items.slice(0, 3).map((it) => (
                        <li key={it.id}>
                          <Link href={`/social/post/${it.post_id}`} className="block truncate rounded border border-line px-1 text-xs text-ink hover:border-brand" title={`${it.app_name}: ${it.topic}`}>
                            {PLATFORM_SHORT[it.platform]} <span className="text-muted">({it.status.replace("_", " ")})</span>
                          </Link>
                        </li>
                      ))}
                      {items.length > 3 && <li className="text-xs text-muted">+{items.length - 3} more</li>}
                    </ul>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="card mt-6 p-4" aria-labelledby="recent-h">
            <h2 id="recent-h" className="text-xl font-semibold">Latest posts</h2>
            {rows.length === 0 ? <p className="mt-2 text-muted">No posts yet. Press New post.</p> : (
              <ul className="mt-3 divide-y divide-line">
                {rows.slice(0, 12).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/social/post/${r.post_id}`} className="min-w-0 text-ink underline">{r.app_name}: {r.topic}</Link>
                    <span className="flex items-center gap-2 text-sm text-muted">{PLATFORM_SHORT[r.platform]} <StatusPill status={r.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card mt-6 p-4" aria-labelledby="leads-h">
            <h2 id="leads-h" className="text-xl font-semibold">Which posts bring people in</h2>
            <p className="mt-1 text-sm text-muted">Clicks on your tracked links, and inquiries you counted. These are totals only; no visitor is identified.</p>
            {stats.length === 0 ? <p className="mt-2 text-muted">No tracked links yet. Add a link to a post to start counting.</p> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Clicks and inquiries by app and platform</caption>
                  <thead><tr className="border-b border-line text-muted"><th scope="col" className="py-1 pr-3">App</th><th scope="col" className="pr-3">Platform</th><th scope="col" className="pr-3">Links</th><th scope="col" className="pr-3">Clicks</th><th scope="col">Inquiries</th></tr></thead>
                  <tbody>{stats.map((s) => (
                    <tr key={`${s.app_id}-${s.platform}`} className="border-b border-line"><td className="py-1 pr-3">{s.app_name}</td><td className="pr-3">{PLATFORM_SHORT[s.platform]}</td><td className="pr-3">{s.links}</td><td className="pr-3">{s.clicks}</td><td>{s.inquiries}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
