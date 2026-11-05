import { requireUser } from "@/lib/auth";
import Link from "next/link";
import Flash from "@/components/Flash";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { listLeads } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads" };

const TITLES = {
  no_website: "No website (priority leads)",
  has_website: "Has a website (future redesign leads)",
};

export default async function Leads({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const bucket = sp.bucket === "has_website" ? "has_website" : "no_website";
  const status = ["new", "contacted", "skipped", "do_not_contact"].includes(sp.status) ? sp.status : "";
  const leads = await listLeads(DEFAULT_BRAND_ID, { bucket, status });

  return (
    <div className="reveal">
      <h1 className="text-4xl font-semibold">{TITLES[bucket]}</h1>
      <div className="mt-4"><Flash sp={sp} /></div>

      <nav aria-label="Filter leads" className="mb-6 flex flex-wrap gap-2">
        {[["no_website", "No website"], ["has_website", "Has website"]].map(([k, l]) => (
          <Link key={k} href={`/leads?bucket=${k}${status ? `&status=${status}` : ""}`} aria-current={k === bucket ? "true" : undefined} className={`btn ${k === bucket ? "btn-primary" : ""}`}>{l}</Link>
        ))}
        <span className="mx-1 self-center text-muted" aria-hidden="true">|</span>
        {[["", "Any status"], ["new", "New"], ["contacted", "Contacted"], ["skipped", "Skipped"], ["do_not_contact", "Do not contact"]].map(([k, l]) => (
          <Link key={k || "any"} href={`/leads?bucket=${bucket}${k ? `&status=${k}` : ""}`} aria-current={k === status ? "true" : undefined} className={`btn ${k === status ? "btn-primary" : ""}`}>{l}</Link>
        ))}
      </nav>

      {leads.length === 0 ? (
        <p className="text-muted">No leads here yet. Run discovery from the dashboard.</p>
      ) : (
        <div className="overflow-x-auto border border-line bg-surface">
          <table className="w-full min-w-[720px] text-left">
            <caption className="sr-only">{TITLES[bucket]}</caption>
            <thead className="border-b border-line bg-paper">
              <tr>
                <th scope="col" className="p-3">Business</th>
                <th scope="col" className="p-3">Category</th>
                <th scope="col" className="p-3">City</th>
                <th scope="col" className="p-3">Phone</th>
                <th scope="col" className="p-3">{bucket === "no_website" ? "Outreach" : "Website"}</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-line align-top">
                  <th scope="row" className="p-3 font-semibold">
                    <Link href={`/leads/${l.id}`} className="inline-flex min-h-[44px] items-center underline underline-offset-4">
                      {l.name}
                    </Link>
                  </th>
                  <td className="p-3">{l.category_label || "Not listed"}</td>
                  <td className="p-3">{l.city || "Not listed"}</td>
                  <td className="p-3">{l.phone || "Not listed"}</td>
                  <td className="p-3">
                    {bucket === "no_website" ? (
                      <>
                        {l.status === "do_not_contact" ? "Do not contact" : l.place_id.startsWith("osm:") && l.site_check === "unchecked" ? "Needs website check" : l.draft_status ? `Draft ${l.draft_status}` : "No draft yet"}
                        {l.website_kind === "social" ? " (social page only)" : ""}
                      </>
                    ) : (
                      <span className="break-all">{l.website}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
