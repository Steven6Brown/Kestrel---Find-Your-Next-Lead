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
  const sp = await searchParams;
  const bucket = sp.bucket === "has_website" ? "has_website" : "no_website";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const leads = await listLeads(DEFAULT_BRAND_ID, { bucket, q });

  return (
    <div className="reveal">
      <h1 className="text-4xl font-extrabold">{TITLES[bucket]}</h1>
      <div className="mt-4"><Flash sp={sp} /></div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="bucket" value={bucket} />
        <div>
          <label htmlFor="q" className="block font-semibold">Search name, city, or category</label>
          <input id="q" name="q" defaultValue={q} className="field mt-1 w-72 max-w-full" />
        </div>
        <button type="submit" className="btn">Search</button>
      </form>

      {leads.length === 0 ? (
        <p className="text-muted">No leads here yet. Run discovery from the dashboard.</p>
      ) : (
        <div className="overflow-x-auto border-2 border-ink bg-surface">
          <table className="w-full min-w-[720px] text-left">
            <caption className="sr-only">{TITLES[bucket]}</caption>
            <thead className="border-b-2 border-ink bg-paper">
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
                        {l.status === "do_not_contact" ? "Do not contact" : l.draft_status ? `Draft ${l.draft_status}` : "No draft yet"}
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
