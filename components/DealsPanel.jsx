import Link from "next/link";
import { BRAND } from "@/lib/auth";
import { listDeals } from "@/lib/store";
import { dealStageLabel } from "@/lib/deals";
import { formatCents } from "@/lib/crm";

/** The deals for one contact, with a way to add another. */
export default async function DealsPanel({ lead }) {
  const deals = await listDeals(BRAND, { leadId: lead.id });
  return (
    <section aria-labelledby="deals-h" className="card mt-8 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="deals-h" className="text-2xl font-semibold">Deals</h2>
        <Link href={`/deals/new?lead=${lead.id}`} className="btn btn-primary">Add a deal</Link>
      </div>
      {deals.length === 0 ? (
        <p className="mt-2 text-muted">No deals yet. Add one when there is something you could be paid for. Winning a deal creates the client and the project.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {deals.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <Link href={`/deals/${d.id}`} className="font-semibold text-ink underline underline-offset-4 hover:text-brand-hover">{d.title}</Link>
              <span className="text-sm text-muted">{dealStageLabel(d.stage)}, {formatCents(d.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
