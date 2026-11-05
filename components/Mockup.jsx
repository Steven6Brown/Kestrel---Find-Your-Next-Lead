import { categoryCopy, telHref, readableOn } from "@/lib/mockupCopy";
import { longDate } from "@/lib/redesign";

// Phase 2 mockup. Takes `lead` (real retrieved data) and `brand` (who made it).
// Nothing here names a company or color; the accent color is the brand's flat primary.
// Layout rules: no gradients, no purple, no three-card row, no stock photos,
// no lorem ipsum, no invented facts. Unknowns are marked placeholders.

const HEX = /^#[0-9a-f]{6}$/i;

function Placeholder({ label, className = "" }) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`flex items-center justify-center border-2 border-dashed border-[#4b5560] bg-[#e9e6dc] p-6 text-center text-sm font-semibold text-[#2d343b] ${className}`}
    >
      {label}
    </div>
  );
}

function DraftTag() {
  return (
    <span className="ml-2 inline-block rounded border border-[#4b5560] px-2 py-0.5 align-middle text-xs font-semibold text-[#2d343b]">
      Draft copy
    </span>
  );
}

export default function Mockup({ lead, brand, bookingUrl = null, audit = null }) {
  const accent = HEX.test(brand.primaryColor || "") ? brand.primaryColor : "#0f6b63";
  const dark = HEX.test(brand.darkColor || "") ? brand.darkColor : "#1b1f23";
  const onAccent = readableOn(accent);
  const copy = categoryCopy(lead);
  const tel = telHref(lead.phone);
  const where = [lead.city, lead.region].filter(Boolean).join(", ");
  const category = lead.category_label || "Local business";

  return (
    <div className="concept-page min-h-screen bg-[#fbfaf6] text-[#1b1f23]">
      {/* The app's dark theme colors every heading white in a global rule that outranks utility classes.
          This page is light, so its headings are set dark here, scoped to this page only. */}
      <style>{".concept-page h1, .concept-page h2, .concept-page h3 { color: #1b1f23; }"}</style>
      {/* Concept banner: honest framing, always visible */}
      <div style={{ background: dark, color: "#ffffff", borderBottom: `3px solid ${accent}` }} className="px-4 py-3 text-sm">
        <p className="mx-auto flex max-w-5xl items-start gap-3">
          {brand.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logo} alt="" width={28} height={28} className="mt-0.5 h-7 w-7 shrink-0" />
          ) : null}
          <span><strong style={{ color: accent === "#C08A2E" ? "#E0AC4C" : accent }}>Concept preview.</strong> This is a quick idea of what {audit ? "a refreshed website" : "a website"} for {lead.name} could look
          like, made by {brand.name} from public business listing details{audit ? " and a quick automated read of the current site's home page" : ""}. It is not an official site and
          anything marked as a placeholder is not confirmed. Nothing was copied from any existing site.</span>
        </p>
      </div>

      <header className="border-b-2 border-[#1b1f23] bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <p className="font-[family-name:var(--font-space)] text-xl font-semibold">{lead.name}</p>
          <nav aria-label="Concept sections">
            <ul className="flex flex-wrap gap-1 text-sm font-semibold">
              {[...(audit ? [["Findings", "#findings"]] : []), ["About", "#about"], ["Services", "#services"], ["Visit", "#visit"]].map(([t, h]) => (
                <li key={h}>
                  <a href={h} className="inline-flex min-h-[44px] items-center px-3 underline-offset-4 hover:underline">
                    {t}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="main">
        {audit ? (
          <section id="findings" className="border-b-2 border-[#1b1f23] bg-white" aria-labelledby="findings-h">
            <div className="mx-auto max-w-5xl px-4 py-12">
              <h2 id="findings-h" className="font-[family-name:var(--font-space)] text-3xl font-semibold">
                What an automated check noticed
              </h2>
              <p className="mt-2 max-w-2xl text-[#2d343b]">
                A computer program read the home page of{" "}
                {audit.website ? <a href={audit.website} rel="noopener noreferrer" className="break-all underline underline-offset-4">{audit.website}</a> : "the current site"}
                {audit.checkedAt ? ` on ${longDate(audit.checkedAt)}` : ""}. It looks at the page code only, so it can miss things and it is not a full review.
              </p>
              {audit.reasons.length ? (
                <ol className="mt-6 divide-y-2 divide-[#1b1f23] border-y-2 border-[#1b1f23]">
                  {audit.reasons.slice(0, 5).map((r, i) => (
                    <li key={r} className="flex items-baseline gap-5 py-4">
                      <span className="font-[family-name:var(--font-space)] text-2xl font-semibold" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                      <span className="text-lg">{r}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
              <p className="mt-4 text-sm text-[#2d343b]">Quick check result: {audit.score} out of 100. This is our own simple measure, not an industry standard.</p>
            </div>
          </section>
        ) : null}
        <section className="mx-auto grid max-w-5xl gap-8 px-4 py-12 md:grid-cols-2 md:items-center md:py-16" aria-labelledby="hero-h">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-[#2d343b]">
              {category}
              {where ? `, ${where}` : ""}
            </p>
            <h1 id="hero-h" className="mt-3 font-[family-name:var(--font-space)] text-4xl font-semibold leading-tight md:text-5xl">
              {lead.name}
            </h1>
            <p className="mt-4 text-lg text-[#2d343b]">
              A one sentence welcome goes here, in the owner&apos;s own words.
              <DraftTag />
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {tel ? (
                <a
                  href={tel}
                  style={{ background: accent, color: onAccent }}
                  className="inline-flex min-h-[48px] items-center px-6 py-3 font-bold"
                >
                  Call {lead.phone}
                </a>
              ) : (
                <span className="inline-flex min-h-[48px] items-center border-2 border-dashed border-[#4b5560] px-6 py-3 font-bold">
                  Phone number to confirm
                </span>
              )}
            </div>
          </div>
          <Placeholder label="Photo placeholder: a real photo of the business goes here" className="min-h-[240px] md:min-h-[320px]" />
        </section>

        <section id="about" className="border-t-2 border-[#1b1f23] bg-white" aria-labelledby="about-h">
          <div className="mx-auto max-w-5xl px-4 py-12">
            <h2 id="about-h" className="font-[family-name:var(--font-space)] text-3xl font-semibold">
              About
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed">
              {copy.about}
              <DraftTag />
            </p>
          </div>
        </section>

        <section id="services" className="border-t-2 border-[#1b1f23]" aria-labelledby="svc-h">
          <div className="mx-auto max-w-5xl px-4 py-12">
            <h2 id="svc-h" className="font-[family-name:var(--font-space)] text-3xl font-semibold">
              Services
            </h2>
            <p className="mt-2 text-[#2d343b]">
              The real list comes from the owner. These rows only show how it would be laid out.
            </p>
            {/* Numbered list rows, intentionally not a card grid */}
            <ol className="mt-6 divide-y-2 divide-[#1b1f23] border-y-2 border-[#1b1f23]">
              {copy.items.map((item, i) => (
                <li key={item} className="flex items-baseline gap-5 py-5">
                  <span className="font-[family-name:var(--font-space)] text-3xl font-semibold" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-lg font-semibold">{item}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="visit" className="border-t-2 border-[#1b1f23] bg-white" aria-labelledby="visit-h">
          <div className="mx-auto grid max-w-5xl gap-8 px-4 py-12 md:grid-cols-2">
            <div>
              <h2 id="visit-h" className="font-[family-name:var(--font-space)] text-3xl font-semibold">
                Visit or contact
              </h2>
              <dl className="mt-6 space-y-4">
                <div>
                  <dt className="text-sm font-bold uppercase tracking-wide text-[#2d343b]">Phone</dt>
                  <dd className="text-lg">
                    {tel ? <a href={tel} className="underline underline-offset-4">{lead.phone}</a> : "To confirm"}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-bold uppercase tracking-wide text-[#2d343b]">Address (from public listing)</dt>
                  <dd className="text-lg">{lead.address || "To confirm"}</dd>
                </div>
                <div>
                  <dt className="text-sm font-bold uppercase tracking-wide text-[#2d343b]">Hours</dt>
                  <dd className="text-lg">To confirm with the owner</dd>
                </div>
              </dl>
            </div>
            <Placeholder label="Map placeholder: an embedded map would go here" className="min-h-[220px]" />
          </div>
        </section>
      </main>

      <footer style={{ background: dark, borderTop: `3px solid ${accent}` }} className="px-4 py-8 text-sm text-white">
        <div className="mx-auto max-w-5xl space-y-2">
          <p>
            Concept only, prepared by {brand.name}. Not affiliated with {lead.name}. Built from public
            business listing details; copy marked as draft is a suggestion, not a statement of fact.
          </p>
          {lead.place_id?.startsWith("osm:") ? <p>Listing data from OpenStreetMap, © OpenStreetMap contributors (ODbL).</p> : null}
          {bookingUrl ? (
            <p>
              Want to talk it through?{" "}
              <a href={bookingUrl} rel="noopener noreferrer" className="underline underline-offset-4">Pick a time with {brand.name}</a>.
            </p>
          ) : null}
          {brand.replyTo ? (
            <p>
              Questions or want this taken down? Email{" "}
              <a href={`mailto:${brand.replyTo}`} className="underline underline-offset-4">{brand.replyTo}</a>.
            </p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
