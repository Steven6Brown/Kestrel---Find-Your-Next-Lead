import Link from "next/link";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import PageHeader from "@/components/PageHeader";
import NextStep from "@/components/NextStep";
import ProspectTabs from "@/components/ProspectTabs";
import { tabFor } from "@/lib/prospecttabs";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import AutoRefresh from "@/components/AutoRefresh";
import { countLeadsFiltered, countUnverified, countWaitingForLookup, leadFacets, listViews, runningVerification, searchLeads, tagCounts } from "@/lib/store";
import { CHECK, PAGE_SIZE, PHONE, STAGE_FILTER, STATUS, hrefWith, parseFilters } from "@/lib/leadfilters";
import { draftFilteredAction, setClosedAction, siteCheckAction, verifyWebsitesAction } from "../actions";
import { deleteViewAction, saveViewAction } from "../views-actions";
import { bulkLeadsAction } from "../bulk-actions";
import { ChipGroup, ChipRadio } from "@/components/Chips";
import SelectAll from "@/components/SelectAll";
import { BULK_ACTIONS, BULK_STAGES } from "@/lib/bulk";

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
  const [tags, views] = await Promise.all([tagCounts(DEFAULT_BRAND_ID), listViews(DEFAULT_BRAND_ID)]);
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
      <PageHeader title="Prospects" subtitle="Every business Kestrel has found. Narrow the list with the buttons, then create outreach drafts or download the result. Nothing is emailed from here." actions={<Link href="/leads/import" className="btn">Import contacts</Link>} />
      <NextStep here="/leads" />
      <ProspectTabs current={tabFor(f)} />
      <div className="mb-4"><Flash sp={sp} /></div>

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

      <section aria-labelledby="views-h" className="card mb-6 p-5">
        <h2 id="views-h" className="text-xl font-semibold">Saved views</h2>
        {views.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Set the filters you use often below, then save them under a name to come back in one click.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-2">
            {views.map((v) => (
              <li key={v.id} className="flex">
                <Link href={v.href} className="btn !rounded-r-none">{v.name}</Link>
                <form action={deleteViewAction}>
                  <input type="hidden" name="id" value={v.id} />
                  <button type="submit" className="btn !rounded-l-none !border-l-0" aria-label={`Remove the saved view ${v.name}`}>Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={saveViewAction} className="mt-4 flex flex-wrap items-end gap-3">
          {Object.entries({ site: f.site, open: f.open, phone: f.phone, check: f.check, status: f.status, stage: f.stage, ready: f.ready, category: f.category, city: f.city, tag: f.tag }).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <div>
            <label htmlFor="viewName" className="block text-sm font-semibold text-ink">Save the filters below as</label>
            <input id="viewName" name="viewName" required maxLength={40} autoComplete="off" className="field mt-1 w-64" />
          </div>
          <button type="submit" className="btn">Save this view</button>
        </form>
      </section>

      <section aria-labelledby="filters-h" className="card space-y-5 p-5">
        <h2 id="filters-h" className="sr-only">Filters</h2>
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
        {tags.length > 0 && (
          <fieldset className="min-w-0">
            <legend className="eyebrow !text-muted">Tag</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={hrefWith(BASE, f, { tag: "" })} aria-current={!f.tag ? "true" : undefined} className={`btn ${!f.tag ? "btn-primary" : ""}`}>All tags</Link>
              {tags.map((x) => (
                <Link key={x.tag} href={hrefWith(BASE, f, { tag: x.tag })} aria-current={x.tag === f.tag ? "true" : undefined} className={`btn ${x.tag === f.tag ? "btn-primary" : ""}`}>{x.tag} ({x.n})</Link>
              ))}
            </div>
          </fieldset>
        )}
      </section>

      <section aria-labelledby="res-h" className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="res-h" className="text-2xl font-semibold">{total.toLocaleString()} {total === 1 ? "business" : "businesses"}</h2>
          <div className="flex flex-wrap gap-2">
            <form action={draftFilteredAction}>
              {Object.entries({ site: f.site, open: "open", phone: f.phone, check: f.check, status: f.status, stage: f.stage, ready: f.ready, category: f.category, city: f.city, tag: f.tag }).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <button type="submit" className="btn btn-primary">Create outreach drafts for ready leads here</button>
            </form>
            <a href={exportHref} className="btn" download>Download CSV</a>
          </div>
        </div>
        <p className="mt-2 text-sm text-muted">Drafts are only created for leads with no website that are ready to contact (OpenStreetMap leads need their website check first), up to 200 at a time.</p>

        {rows.length > 0 && (
          <form id="bulk-form" action={bulkLeadsAction} className="card mt-4 p-4">
            <input type="hidden" name="back" value={here} />
            <h3 className="text-lg font-semibold">Do something to several at once</h3>
            <p className="text-sm text-muted">Tick contacts in the list below, choose what to do, then apply. Up to 200 at a time.</p>
            <div className="mt-3"><SelectAll name="ids" form="bulk-form" label="on this page" /></div>
            <ChipGroup legend="What to do">
              {BULK_ACTIONS.map(([k, l]) => <ChipRadio key={k} name="action" value={k} label={l} />)}
            </ChipGroup>
            <div className="mt-4 flex flex-wrap items-end gap-4">
              <div>
                <label htmlFor="bulk-tag" className="block text-sm font-semibold text-ink">Tag to add</label>
                <input id="bulk-tag" name="tag" maxLength={100} autoComplete="off" className="field mt-1 w-56" />
              </div>
              <div>
                <label htmlFor="bulk-stage" className="block text-sm font-semibold text-ink">Stage to move to</label>
                <select id="bulk-stage" name="stage" defaultValue="" className="field mt-1 w-56">
                  <option value="">Choose a stage</option>
                  {BULK_STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <button type="submit" className="btn btn-primary">Apply to ticked contacts</button>
            </div>
          </form>
        )}

        {rows.length === 0 ? (
          <p className="card mt-4 p-5 text-muted">Nothing matches these filters. Run a campaign from the Overview page, or loosen a filter.</p>
        ) : (
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[920px] text-left">
              <caption className="sr-only">Businesses matching the filters</caption>
              <thead className="border-b border-line">
                <tr><th scope="col" className="w-12 p-3"><span className="sr-only">Select</span></th>{["Business", "Type", "City", "Phone", "Website", "Next step"].map((h) => <th key={h} scope="col" className="p-3 eyebrow !text-muted">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const needsCheck = l.bucket === "no_website" && l.place_id?.startsWith("osm:") && l.site_check === "unchecked";
                  const q = new URLSearchParams({ q: [l.name, l.city, l.region].filter(Boolean).join(" ") });
                  return (
                    <tr key={l.id} className="border-b border-line align-top last:border-b-0">
                      <td className="p-3"><input type="checkbox" name="ids" value={l.id} form="bulk-form" className="h-6 w-6" aria-label={`Select ${l.name}`} /></td>
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
                        {l.closed_at ? "Closed" : l.status === "do_not_contact" ? "Do not contact" : needsCheck ? (
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
                            <form action={setClosedAction}>
                              <input type="hidden" name="leadId" value={l.id} />
                              <input type="hidden" name="closed" value="1" />
                              <input type="hidden" name="back" value={here} />
                              <button type="submit" className="btn">Closed</button>
                            </form>
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
