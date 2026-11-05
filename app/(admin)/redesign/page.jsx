import Link from "next/link";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import AutoRefresh from "@/components/AutoRefresh";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { auditCounts, countRedesignTargets, countUnaudited, redesignTargets, runningAudit } from "@/lib/store";
import { THRESHOLDS, parseThreshold } from "@/lib/redesign";
import { auditWebsitesAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Redesign targets" };

const PAGE = 50;

function reasonsOf(lead) {
  try {
    return JSON.parse(lead.audit_json || "{}").reasons || [];
  } catch {
    return [];
  }
}

export default async function Redesign({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const below = parseThreshold(sp.below);
  const page = Math.max(1, Number.parseInt(sp.page, 10) || 1);
  const [counts, unaudited, running, total] = await Promise.all([
    auditCounts(DEFAULT_BRAND_ID),
    countUnaudited(DEFAULT_BRAND_ID),
    runningAudit(DEFAULT_BRAND_ID),
    countRedesignTargets(DEFAULT_BRAND_ID, below),
  ]);
  const rows = await redesignTargets(DEFAULT_BRAND_ID, below, { limit: PAGE, offset: (page - 1) * PAGE });
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const hasKey = !!process.env.PAGESPEED_API_KEY;

  return (
    <div className="reveal">
      <p className="eyebrow">Redesign targets</p>
      <h1 className="mt-1 text-4xl font-semibold">Businesses with a website that needs work</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Kestrel scores each business website out of 100 against the things Aquila builds in: a secure connection, a phone friendly layout, clear page structure, image descriptions, current code, speed, and an easy way to contact the business. Pick a cutoff to see the sites that score below it.
      </p>
      <div className="mt-4"><Flash sp={sp} /></div>

      <AutoRefresh active={!!running} />
      <section aria-labelledby="audit-h" className="card mb-6 p-5">
        <h2 id="audit-h" className="text-2xl font-semibold">Check website quality</h2>
        <p className="mt-2 text-ink">
          {running
            ? `Checking now: ${running.searches} of ${running.total_searches} sites done, ${running.has_website} scored so far.`
            : `${counts.ok.toLocaleString()} scored, ${unaudited.toLocaleString()} waiting to be checked${counts.unreachable + counts.blocked ? `, ${(counts.unreachable + counts.blocked).toLocaleString()} could not be read` : ""}${counts.chain ? `, ${counts.chain.toLocaleString()} chains skipped` : ""}${counts.listing ? `, ${counts.listing.toLocaleString()} directory listings skipped` : ""}.`}
        </p>
        <form action={auditWebsitesAction} className="mt-3">
          <button type="submit" className="btn btn-primary" disabled={!!running || unaudited === 0}>{running ? "Checking..." : "Check website quality (free)"}</button>
        </form>
        <p className="mt-2 text-sm text-muted">
          It loads each home page once, the way a visitor would, and reads it. Nothing is changed on their site. {hasKey ? "Google PageSpeed measurements are included." : "Add a free PAGESPEED_API_KEY in .env.local to include Google's measured speed and accessibility scores."} Sites that block automated visitors, do not load, or are built entirely with scripts cannot be read, so they are not scored and need a look by hand. National chains and franchise pages are skipped because their websites are run by head office, and directory or booking pages are skipped because they are not the business&apos;s own website. Only the home page is read, so a site that shows its details on other pages can score lower than it deserves.
        </p>
      </section>

      <section aria-labelledby="cut-h" className="card p-5">
        <h2 id="cut-h" className="text-2xl font-semibold">Score cutoff</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Show sites scoring below">
          {THRESHOLDS.map((t) => (
            <Link key={t} href={`/redesign?below=${t}`} aria-current={t === below ? "true" : undefined} className={`btn ${t === below ? "btn-primary" : ""}`}>
              Below {t}
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="res-h" className="mt-6">
        <h2 id="res-h" className="text-2xl font-semibold">{total.toLocaleString()} {total === 1 ? "site scores" : "sites score"} below {below}</h2>
        {rows.length === 0 ? (
          <p className="card mt-4 p-5 text-muted">
            {counts.ok === 0 ? "Nothing has been scored yet. Run the website check on the Leads page first, then press Check website quality above." : "No scored site is below this cutoff. Try a higher one."}
          </p>
        ) : (
          <div className="card mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <caption className="sr-only">Websites scoring below {below} out of 100</caption>
              <thead className="border-b border-line">
                <tr>{["Business", "Score", "Website", "What is holding it back"].map((h) => <th key={h} scope="col" className="p-3 eyebrow !text-muted">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id} className="border-b border-line align-top last:border-b-0">
                    <th scope="row" className="p-3 font-semibold">
                      <Link href={`/leads/${l.id}`} className="inline-flex min-h-[44px] items-center text-ink underline underline-offset-4 hover:text-brand-hover">{l.name}</Link>
                      <span className="block text-sm font-normal text-muted">{[l.category_label, l.city].filter(Boolean).join(", ")}</span>
                    </th>
                    <td className="p-3 font-semibold">{l.audit_score} out of 100</td>
                    <td className="p-3 break-all"><a href={l.website} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{l.website}</a></td>
                    <td className="p-3">
                      <ul className="list-disc pl-5">
                        {reasonsOf(l).slice(0, 4).map((r) => <li key={r}>{r}</li>)}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center gap-2">
            {page > 1 && <Link className="btn" href={`/redesign?below=${below}&page=${page - 1}`}>Previous</Link>}
            <span className="text-muted">Page {page} of {pages}</span>
            {page < pages && <Link className="btn" href={`/redesign?below=${below}&page=${page + 1}`}>Next</Link>}
          </nav>
        )}
      </section>
    </div>
  );
}
