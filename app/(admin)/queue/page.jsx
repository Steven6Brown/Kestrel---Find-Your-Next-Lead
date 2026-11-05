import { requireUser } from "@/lib/auth";
import Link from "next/link";
import Flash from "@/components/Flash";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { listDrafts } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review queue" };

const FILTERS = [["draft", "Awaiting review"], ["approved", "Approved"], ["rejected", "Rejected"], ["sent", "Sent"]];

export default async function Queue({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const status = FILTERS.some(([k]) => k === sp.status) ? sp.status : "draft";
  const drafts = await listDrafts(DEFAULT_BRAND_ID, status);
  return (
    <div className="reveal">
      <h1 className="text-4xl font-semibold">Review queue</h1>
      <p className="mt-2 text-muted">Open a draft to edit, approve, and send it yourself. Nothing is sent automatically.</p>
      <div className="mt-4"><Flash sp={sp} /></div>
      <nav aria-label="Draft status filter" className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map(([k, label]) => (
            <li key={k}>
              <Link
                href={`/queue?status=${k}`}
                aria-current={k === status ? "page" : undefined}
                className={`btn ${k === status ? "btn-primary" : ""}`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {drafts.length === 0 ? (
        <p className="text-muted">Nothing in this list.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {drafts.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-semibold">{d.lead_name}{d.lead_city ? `, ${d.lead_city}` : ""}</p>
                <p className="text-sm text-muted">{d.subject}</p>
                <p className="text-sm text-muted">{d.lead_email ? `To: ${d.lead_email}` : "No recipient email saved yet"}</p>
              </div>
              <Link href={`/leads/${d.lead_id}`} className="btn">Open</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
