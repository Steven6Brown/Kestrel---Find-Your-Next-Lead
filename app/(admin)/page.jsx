import Flash from "@/components/Flash";
import { discoverAction, draftAllAction } from "./actions";
import { DEFAULT_BRAND_ID, getBrand, brandReadiness } from "@/config/brands";
import { product } from "@/config/product";
import { listSearches, stats } from "@/lib/store";
import { MAX_COMBOS_PER_RUN, provider } from "@/lib/discovery";
import { supportedCategories } from "@/lib/overpass";
import { baseUrl, isPublicHttps } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }) {
  const sp = await searchParams;
  const s = await stats(DEFAULT_BRAND_ID);
  const searches = await listSearches(DEFAULT_BRAND_ID);
  const brand = getBrand(DEFAULT_BRAND_ID);
  const setup = [
    ...(provider() === "google"
      ? (process.env.GOOGLE_PLACES_API_KEY ? [] : ["DISCOVERY_PROVIDER is google but GOOGLE_PLACES_API_KEY is not set."])
      : (process.env.OSM_CONTACT || process.env.SENDER_EMAIL ? [] : ["OSM_CONTACT is not set. OpenStreetMap requires an identifying contact (an email or URL) on requests."])),
    ...brandReadiness(brand),
    ...(process.env.RESEND_API_KEY ? [] : ["RESEND_API_KEY is not set, so sending is disabled."]),
    ...(isPublicHttps(baseUrl()) ? [] : ["APP_BASE_URL is not a public https URL. Mockup links in emails will not work for recipients and sending stays blocked."]),
  ];
  const strip = [
    ["No website", s.noWebsite],
    ["Has website", s.hasWebsite],
    ["Awaiting review", s.awaitingReview],
    ["Approved", s.approved],
    ["Sent", s.sent],
    ["Opted out", s.optOuts],
  ];

  return (
    <div className="reveal">
      <h1 className="text-4xl font-extrabold">{product.name}</h1>
      <p className="mt-2 max-w-2xl text-lg text-muted">{product.tagline} Nothing is ever sent automatically.</p>
      <div className="mt-6"><Flash sp={sp} /></div>

      <dl className="mt-6 grid grid-cols-2 border-2 border-ink bg-surface sm:grid-cols-3 lg:grid-cols-6">
        {strip.map(([label, n]) => (
          <div key={label} className="border-b border-r border-line p-4">
            <dt className="text-sm font-semibold text-muted">{label}</dt>
            <dd className="font-[family-name:var(--font-archivo)] text-3xl font-extrabold">{n}</dd>
          </div>
        ))}
      </dl>

      {setup.length > 0 && (
        <section aria-labelledby="setup-h" className="mt-8 border-2 border-warn bg-warn-bg p-4 text-warn">
          <h2 id="setup-h" className="text-xl font-bold">Setup still needed</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {setup.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </section>
      )}

      <section aria-labelledby="disc-h" className="mt-10 grid gap-8 lg:grid-cols-[2fr_1fr]">
        <form action={discoverAction} className="space-y-5 border-2 border-ink bg-surface p-5">
          <h2 id="disc-h" className="text-2xl font-extrabold">Find leads</h2>
          <p className="text-muted">
            Each category is searched in each location (up to {MAX_COMBOS_PER_RUN} searches per run). Source: {provider() === "google" ? "Google Places (billed per request)" : "OpenStreetMap (free; a missing website there can just mean nobody added it, so verify before outreach)"}.
          </p>
          <div>
            <label htmlFor="locations" className="block font-semibold">Locations (one per line)</label>
            <textarea id="locations" name="locations" rows={4} required className="field mt-1" aria-describedby="loc-h" />
            <p id="loc-h" className="mt-1 text-sm text-muted">Use the format &quot;City, ST&quot;.</p>
          </div>
          <div>
            <label htmlFor="categories" className="block font-semibold">Business categories (one per line)</label>
            <textarea id="categories" name="categories" rows={4} required className="field mt-1" aria-describedby="cat-h" />
            <p id="cat-h" className="mt-1 text-sm text-muted">{provider() === "google" ? "Any business type." : `Supported: ${supportedCategories().join(", ")}.`}</p>
          </div>
          <div>
            <label htmlFor="maxPages" className="block font-semibold">Pages per search</label>
            <select id="maxPages" name="maxPages" defaultValue={process.env.PLACES_MAX_PAGES || "1"} className="field mt-1 max-w-xs">
              <option value="1">1 (up to 20 results)</option>
              <option value="2">2 (up to 40 results)</option>
              <option value="3">3 (up to 60 results)</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary">Run discovery</button>
        </form>

        <div className="space-y-6">
          <section aria-labelledby="next-h" className="border-2 border-ink bg-surface p-5">
            <h2 id="next-h" className="text-2xl font-extrabold">Outreach drafts</h2>
            <p className="mt-2 text-muted">Create a draft for every no-website lead that does not have one yet. They go to the review queue.</p>
            <form action={draftAllAction} className="mt-4">
              <button type="submit" className="btn">Draft all new leads</button>
            </form>
          </section>
          <section aria-labelledby="hist-h">
            <h2 id="hist-h" className="text-xl font-extrabold">Recent searches</h2>
            {searches.length === 0 ? (
              <p className="mt-2 text-muted">No searches yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {searches.map((r) => (
                  <li key={r.id} className="py-2 text-sm">
                    <span className="font-semibold">{r.query}</span>
                    <br />
                    <span className="text-muted">
                      {r.error ? `Failed: ${r.error}` : `${r.results} found, ${r.new_leads} new`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
