import Link from "next/link";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import AutoRefresh from "@/components/AutoRefresh";
import { countLeadsFiltered, countUnverified, countWaitingForLookup, leadFacets, runningVerification, searchLeads } from "@/lib/store";
import { CHECK, PAGE_SIZE, PHONE, SITE, STAGE_FILTER, STATUS, hrefWith, parseFilters } from "@/lib/leadfilters";
import { draftFilteredAction, siteCheckAction, verifyWebsitesAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads" };

const BASE = "/leads";

function Chips({ label, options, value, f, field }) {
  return (
    <fieldset className="min-w-0">
      <legend className="eyebrow !text-muted">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(([k, l]) => (
          <Link
            key={k}
            href={hrefWith(BASE, f, { [field]: k })}
            aria-current={k === value ? "true" : undefined}
            className={`btn ${k === value ? "btn-primary" : ""}`}
          >
            {l}
          </Link>
        ))}
      </div>
    </fieldset>
  );
}

export default async function Leads({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const f = parseFilters(sp);
  const [unverified, waiting, running] = await Promise.all([countUnverified(DEFAULT_BRAND_ID), countWaitingForLookup(DEFAULT_BRAND_ID), runningVerification(DEFAULT_BRAND_ID)]);
  const [total, rows, facets] = await Promise.all([
    countLeadsFiltered(DEFAULT_BRAND_ID, f),
    searchLeads(DEFAULT_BRAND_ID, f, { limit: PAGE_SIZE, offset: (f.page - 1) * PAGE_SIZE }),
    leadFacets(DEFAULT_BRAND_ID, f),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const here = hrefWith(BASE, f, { page: f.page });
  const exportHref = hrefWith("/leads/export", f);

  return (
    <div className="reveal">
      <p className="eyebrow">Leads database</p>
      <h1 className="mt-1 text-4xl font-semibold">Every business Kestrel has found</h1>
      <p className="mt-2 max-w-2xl text-muted">Narrow the list with the buttons, then create outreach drafts or download the result. Nothing is emailed from here.</p>
      <div className="mt-4"><Flash sp={sp} /></div>

      <AutoRefresh active={!!running} />
      <section aria-labelledby="ver-h" className="card mb-6 p-5">
        <h2 id="ver-h" className="text-2xl font-semibold">Check who really has no website</h2>
        <p className="mt-1 text-muted">
          Businesses from OpenStreetMap often look website-less only because nobody added the website there. This looks each one up in Overture Maps, a free open business directory, and moves any that already have a website into the &quot;Has a website&quot; list. It is free and needs no account.
        </p>
        <p className="mt-2 text-ink">
          {running
            ? `Checking now: ${running.searches} of ${running.total_searches} areas done, ${running.found} businesses checked, ${running.has_website} found with a website so far.`
            : `${unverified.toLocaleString()} business(es) are still unverified. ${waiting.toLocaleString()} ${waiting === 1 ? "has" : "have"} not been looked up yet${unverified > waiting ? `; the other ${(unverified - waiting).toLocaleString()} were looked up and not found, so check those by hand below` : ""}.`}
        </p>
        <form action={verifyWebsitesAction} className="mt-3">
          <button type="submit" className="btn btn-primary" disabled={!!running || waiting === 0}>{running ? "Checking..." : "Check websites (free)"}</button>
        </form>
        <p className="mt-2 text-sm text-muted">Not finding a business there proves nothing, so it stays unverified until you check it yourself.</p>
      </section>

      <section aria-labelledby="filters-h" className="card space-y-5 p-5">
        <h2 id="filters-h" className="sr-only">Filters</h2>
        <Chips label="Website" options={SITE} value={f.site} f={f} field="site" />
        <div className="grid gap-5 md:grid-cols-2">
          <Chips label="Phone number" options={PHONE} value={f.phone} f={f} field="phone" />
          <Chips label="Website check" options={CHECK} value={f.check} f={f} field="check" />
        </div>
        <Chips label="Pipeline stage" options={STAGE_FILTER} value={f.stage} f={f} field="stage" />
        <Chips label="Status" options={STATUS} value={f.status} f={f} field="status" />
        <fieldset className="min-w-0">
          <legend className="eyebrow !text-muted">Ready for outreach</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={hrefWith(BASE, f, { ready: "" })} aria-current={!f.ready ? "true" : undefined} className={`btn ${!f.ready ? "btn-primary" : ""}`}>Everything</Link>
            <Link href={hrefWith(BASE, f, { ready: "1" })} aria-current={f.ready ? "true" : undefined} className={`btn ${f.ready ? "btn-primary" : ""}`}>Only leads ready to contact</Link>
          </div>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="eyebrow !text-muted">Business type</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={hrefWith(BASE, f, { category: "" })} aria-current={!f.category ? "true" : undefined} className={`btn ${!f.category ? "btn-primary" : ""}`}>All types</Link>
            {facets.categories.map((c) => (
              <Link key={c.value} href={hrefWith(BASE, f, { category: c.value })} aria-current={c.value === f.category ? "true" : undefined} className={`btn ${c.value === f.category ? "btn-primary" : ""}`}>
                {c.label} ({c.n})
              </Link>
            ))}
          </div>
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="eyebrow !text-muted">City</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link href={hrefWith(BASE, f, { city: "" })} aria-current={!f.city ? "true" : undefined} className={`btn ${!f.city ? "btn-primary" : ""}`}>All cities</Link>
            {facets.cities.map((c) => (
              <Link key={c.value} href={hrefWith(BASE, f, { city: c.value })} aria-current={c.value === f.city ? "true" : undefined} className={`btn ${c.value === f.city ? "btn-primary" : ""}`}>
                {c.value} ({c.n})
              </Link>
            ))}
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="res-h" className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="res-h" className="text-2xl font-semibold">{total.toLocaleString()} {total === 1 ? "business" : "businesses"}</h2>
          <div className="flex flex-wrap gap-2">
            <form action={draftFilteredAction}>
              {Object.entries({ site: f.site, phone: f.phone, check: f.check, status: f.status, stage: f.stage, ready: f.ready, category: f.category, city: f.city }).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <button type="submit" className="btn btn-primary">Create outreach drafts for ready leads here</button>
            </form>
            <a href={exportHref} className="btn" download>Download CSV</a>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted">Drafts are only created for leads with no website that are ready to contact (OpenStreetMap leads need their website check first), up to 200 at a time.</p>

        {rows.length === 0 ? (
          <p className="card mt-4 p-5 text-muted">Nothing matches these filters. Run a campaign from the Overview page, or loosen a filter.</p>
        ) : (
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left">
              <caption className="sr-only">Businesses matching the filters</caption>
              <thead className="border-b border-line">
                <tr>{["Business", "Type", "City", "Phone", "Website", "Next step"].map((h) => <th key={h} scope="col" className="p-3 eyebrow !text-muted">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const needsCheck = l.bucket === "no_website" && l.place_id?.startsWith("osm:") && l.site_check === "unchecked";
                  const q = new URLSearchParams({ q: [l.name, l.city, l.region].filter(Boolean).join(" ") });
                  return (
                    <tr key={l.id} className="border-b border-line align-top last:border-b-0">
                      <th scope="row" className="p-3 font-semibold">
                        <Link href={`/leads/${l.id}`} className="inline-flex min-h-[44px] items-center text-ink underline underline-offset-4 hover:text-brand-hover">{l.name}</Link>
                      </th>
                      <td className="p-3">{l.category_label || "Not listed"}</td>
                      <td className="p-3">{l.city || "Not listed"}</td>
                      <td className="p-3">{l.phone || "Not listed"}</td>
                      <td className="p-3 break-all">
                        {l.bucket === "no_website" ? (l.website_kind === "social" ? <>Social page only{l.website ? <><br /><span className="text-muted">{l.website}</span></> : null}</> : needsCheck ? "Not listed (unverified)" : "None listed") : <>{l.website}{l.website_source === "overture" ? <span className="block text-xs text-muted">Found in Overture Maps</span> : null}</>}
                      </td>
                      <td className="p-3">
                        {l.status === "do_not_contact" ? "Do not contact" : needsCheck ? (
                          <div className="flex flex-wrap gap-2">
                            <a className="btn" href={`https://www.google.com/search?${q}`} target="_blank" rel="noopener noreferrer">Search the web</a>
                            {["confirmed_none", "has_site"].map((v) => (
                              <form key={v} action={siteCheckAction}>
                                <input type="hidden" name="leadId" value={l.id} />
                                <input type="hidden" name="verdict" value={v} />
                                <input type="hidden" name="back" value={here} />
                                <button type="submit" className="btn">{v === "confirmed_none" ? "No website" : "Has website"}</button>
                              </form>
                            ))}
                          </div>
                        ) : l.draft_status ? `Draft ${l.draft_status}` : l.bucket === "no_website" ? "Ready" : "Redesign lead"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center gap-2">
            {f.page > 1 && <Link className="btn" href={hrefWith(BASE, f, { page: f.page - 1 })}>Previous</Link>}
            <span className="text-muted">Page {f.page} of {pages}</span>
            {f.page < pages && <Link className="btn" href={hrefWith(BASE, f, { page: f.page + 1 })}>Next</Link>}
          </nav>
        )}
      </section>
    </div>
  );
}
