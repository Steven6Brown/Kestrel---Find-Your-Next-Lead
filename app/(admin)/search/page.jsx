import Link from "next/link";
import { requireUser } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { searchEverything } from "@/lib/store";
import { cleanQuery } from "@/lib/bulk";
import { dealStageLabel } from "@/lib/deals";
import { stageLabel } from "@/lib/crm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search" };

function Group({ id, title, count, children }) {
  return (
    <section aria-labelledby={id} className="card mt-6 p-5">
      <h2 id={id} className="text-xl font-semibold">{title} <span className="text-base font-normal text-muted">({count})</span></h2>
      <ul className="mt-3 divide-y divide-line">{children}</ul>
    </section>
  );
}

export default async function Search({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const raw = typeof sp.q === "string" ? sp.q : "";
  const q = cleanQuery(raw);
  const r = q ? await searchEverything(DEFAULT_BRAND_ID, q) : null;
  const none = r && !r.leads.length && !r.clients.length && !r.deals.length;

  return (
    <div className="reveal">
      <PageHeader title="Search" subtitle="Finds contacts, clients, and deals by name, email, phone, city, notes, website, or tag." />
      <form action="/search" method="get" role="search" className="flex max-w-xl flex-wrap gap-3">
        <label htmlFor="page-q" className="sr-only">Search</label>
        <input id="page-q" name="q" type="search" defaultValue={q || raw.slice(0, 80)} maxLength={80} autoComplete="off" className="field min-w-0 flex-1" />
        <button type="submit" className="btn btn-primary">Search</button>
      </form>

      {!q ? (
        <p className="mt-6 text-muted">Type at least two characters.</p>
      ) : none ? (
        <p className="card mt-6 p-5 text-muted">Nothing matches &quot;{q}&quot;. Try fewer letters, or part of a name or email.</p>
      ) : (
        <>
          {r.leads.length > 0 && (
            <Group id="leads-h" title="Contacts" count={r.leads.length}>
              {r.leads.map((l) => (
                <li key={l.id} className="py-3">
                  <Link href={`/leads/${l.id}`} className="font-semibold text-ink underline underline-offset-4 hover:text-brand-hover">{l.name}</Link>
                  <span className="block text-sm text-muted">
                    {[[l.city, l.region].filter(Boolean).join(", "), l.contact_email, l.phone].filter(Boolean).join(" · ") || "No other details"} · {stageLabel(l.stage)}{l.closed_at ? " · Closed" : ""}
                  </span>
                </li>
              ))}
            </Group>
          )}
          {r.clients.length > 0 && (
            <Group id="clients-h" title="Clients" count={r.clients.length}>
              {r.clients.map((c) => (
                <li key={c.id} className="py-3">
                  <Link href={`/clients/${c.id}`} className="font-semibold text-ink underline underline-offset-4 hover:text-brand-hover">{c.name}</Link>
                  <span className="block text-sm text-muted">{[c.email, c.phone].filter(Boolean).join(" · ") || "No other details"}</span>
                </li>
              ))}
            </Group>
          )}
          {r.deals.length > 0 && (
            <Group id="deals-h" title="Deals" count={r.deals.length}>
              {r.deals.map((d) => (
                <li key={d.id} className="py-3">
                  <Link href={`/deals/${d.id}`} className="font-semibold text-ink underline underline-offset-4 hover:text-brand-hover">{d.title}</Link>
                  <span className="block text-sm text-muted">{d.lead_name} · {dealStageLabel(d.stage)}</span>
                </li>
              ))}
            </Group>
          )}
        </>
      )}
    </div>
  );
}
