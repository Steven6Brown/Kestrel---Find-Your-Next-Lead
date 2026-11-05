import Link from "next/link";
import { PROSPECT_TABS } from "@/lib/prospecttabs";

/** The views of the prospect list, so finding, checking and redesign leads read as one place. */
export default function ProspectTabs({ current }) {
  return (
    <nav aria-label="Prospect views" className="mb-6 flex flex-wrap gap-2">
      {PROSPECT_TABS.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined} className={`btn ${t.key === current ? "btn-primary" : ""}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
