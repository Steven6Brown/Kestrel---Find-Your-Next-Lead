import Link from "next/link";
import { requireUser, BRAND } from "@/lib/auth";
import * as ss from "@/lib/socialstore";
import PageHeader from "@/components/PageHeader";
import Flash from "@/components/Flash";
import { AppFilter, PLATFORM_SHORT, SocialTabs, StatusPill, fmtWhen } from "@/components/SocialBits";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review queue" };

const GROUPS = [
  ["failed", "Failed, needs you"],
  ["draft", "Waiting for your review"],
  ["approved", "Approved, no time set"],
  ["scheduled", "Scheduled"],
];

export default async function Queue({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const apps = await ss.listApps(BRAND);
  const appId = apps.find((a) => String(a.id) === sp.app)?.id || null;
  const rows = await ss.listVariants(BRAND, { appId, limit: 500 });
  return (
    <div className="reveal">
      <PageHeader title="Review queue" subtitle="Everything that still needs a decision or is waiting to go out." />
      <SocialTabs current="/social/queue" appId={appId} />
      <Flash sp={sp} />
      <AppFilter apps={apps} selected={appId} path="/social/queue" />
      {GROUPS.map(([status, title]) => {
        const items = rows.filter((r) => r.status === status);
        if (!items.length) return null;
        return (
          <section key={status} className="card mb-4 p-4" aria-labelledby={`g-${status}`}>
            <h2 id={`g-${status}`} className="text-xl font-semibold">{title} ({items.length})</h2>
            <ul className="mt-2 divide-y divide-line">
              {items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link href={`/social/post/${r.post_id}`} className="text-ink underline">{r.app_name}: {r.topic}</Link>
                    <p className="truncate text-sm text-muted">{r.caption}</p>
                    {r.error && <p className="text-sm text-bad">{r.error}</p>}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted">{PLATFORM_SHORT[r.platform]} <StatusPill status={r.status} />{r.scheduled_at && <span>{fmtWhen(r.scheduled_at)}</span>}</div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!rows.some((r) => GROUPS.some(([s]) => s === r.status)) && <p className="card p-5 text-muted">Nothing is waiting. Make a new post when you are ready.</p>}
    </div>
  );
}
