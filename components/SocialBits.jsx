import Link from "next/link";

export const STATUS = {
  draft: ["Draft", "bg-line text-ink"],
  approved: ["Approved", "bg-ok-bg text-ok"],
  scheduled: ["Scheduled", "bg-warn-bg text-warn"],
  publishing: ["Posting", "bg-warn-bg text-warn"],
  published: ["Posted", "bg-ok-bg text-ok"],
  posted_manually: ["Posted by hand", "bg-ok-bg text-ok"],
  failed: ["Failed", "bg-bad-bg text-bad"],
  rejected: ["Rejected", "bg-line text-muted"],
};

export function StatusPill({ status }) {
  const [label, cls] = STATUS[status] || [status, "bg-line text-muted"];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

export const PLATFORM_SHORT = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", tiktok: "TikTok" };

/** Sub navigation for the Social module. Plain links, current page marked with aria-current. */
export function SocialTabs({ current, appId }) {
  const q = appId ? `?app=${appId}` : "";
  const tabs = [
    ["/social", "Calendar"],
    ["/social/queue", "Review queue"],
    ["/social/write", "AI writing"],
    ["/social/new", "New post"],
    ["/social/import", "Import drafts"],
    ["/social/apps", "Apps and accounts"],
  ];
  return (
    <nav aria-label="Social sections" className="mb-6 flex flex-wrap gap-2">
      {tabs.map(([href, label]) => (
        <Link key={href} href={href === "/social/apps" ? href : href + q} aria-current={current === href ? "page" : undefined}
          className={`btn ${current === href ? "btn-primary" : ""}`}>{label}</Link>
      ))}
    </nav>
  );
}

/** Which app the page is filtered to. Links, so it works without JavaScript. */
export function AppFilter({ apps, selected, path }) {
  if (apps.length < 2) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by app">
      <Link href={path} aria-current={!selected ? "true" : undefined} className={`btn ${!selected ? "btn-primary" : ""}`}>All apps</Link>
      {apps.map((a) => (
        <Link key={a.id} href={`${path}?app=${a.id}`} aria-current={selected === a.id ? "true" : undefined} className={`btn ${selected === a.id ? "btn-primary" : ""}`}>{a.name}</Link>
      ))}
    </div>
  );
}

export const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
