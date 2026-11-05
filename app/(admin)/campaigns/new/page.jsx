import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import SelectAll from "@/components/SelectAll";
import { ChipCheckbox, ChipGroup, ChipRadio } from "@/components/Chips";
import { createCampaignAction } from "../../actions";
import { FREQUENCIES, MAX_AREA_LOCATIONS, RUN_TIMES, STATES } from "@/lib/campaigns";
import { citiesForState } from "@/lib/geo";

export const dynamic = "force-dynamic";
export const metadata = { title: "New campaign" };

async function CityChips({ code }) {
  let cities = [];
  let failed = null;
  try {
    cities = await citiesForState(code);
  } catch (err) {
    failed = err.message;
  }
  if (failed || cities.length === 0) {
    return (
      <p role="alert" className="border border-bad bg-bad-bg p-3 text-bad">
        Could not load cities right now{failed ? ` (${failed})` : ""}. The free map server is sometimes busy.{" "}
        <Link href={`/campaigns/new?state=${code}`} className="underline underline-offset-4">Try again</Link>.
      </p>
    );
  }
  return (
    <>
      <SelectAll name="locations" form="campaign-form" label="cities" />
      <ChipGroup legend="Cities" hint={`Largest first. Pick up to ${MAX_AREA_LOCATIONS}. Every business in each city is scanned.`}>
        {cities.map((c) => (
          <ChipCheckbox key={c.name} name="locations" value={`${c.name}, ${code}`} label={c.name} form="campaign-form" />
        ))}
      </ChipGroup>
    </>
  );
}

export default async function NewCampaign({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const code = STATES.some(([c]) => c === sp.state) ? sp.state : null;
  const stateName = STATES.find(([c]) => c === code)?.[1];

  return (
    <div className="reveal">
      <p><Link href="/" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back to scan areas</Link></p>
      <p className="eyebrow mt-2">New campaign</p>
      <h1 className="mt-1 text-4xl font-semibold">Where should Kestrel scan?</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Pick the cities. Kestrel collects every business it can find there, with or without a website, into your Leads database.
        You filter and choose the leads afterwards, so there is no business type to decide up front.
      </p>
      <div className="mt-4"><Flash sp={sp} /></div>

      <section aria-labelledby="st-h" className="mt-6">
        <h2 id="st-h" className="text-lg font-semibold">1. State</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {STATES.map(([c, n]) => (
            <li key={c}>
              <Link
                href={`/campaigns/new?state=${c}`}
                aria-current={c === code ? "true" : undefined}
                title={n}
                className={`btn !min-w-[52px] !px-3 ${c === code ? "btn-primary" : ""}`}
              >
                {c}
              </Link>
            </li>
          ))}
        </ul>
        {code && <p className="mt-2 text-sm text-muted">Selected: {stateName}</p>}
      </section>

      {code ? (
        <form id="campaign-form" action={createCampaignAction} className="mt-8 space-y-8">
          <input type="hidden" name="state" value={code} />
          <div>
            <h2 className="mb-3 text-lg font-semibold">2. Cities</h2>
            <Suspense fallback={<p role="status" className="text-muted">Loading cities for {stateName}. The first load can take up to a minute.</p>}>
              <CityChips code={code} />
            </Suspense>
          </div>

          <div className="space-y-6">
            <h2 className="text-lg font-semibold">3. Schedule</h2>
            <ChipGroup legend="How often" hint="Scheduled runs use Windows Task Scheduler. You get a one-line command to set that up after saving. Rescans skip areas done in the last 7 days.">
              {FREQUENCIES.map(([k, l], i) => <ChipRadio key={k} name="frequency" value={k} label={l} defaultChecked={i === 0} />)}
            </ChipGroup>
            <ChipGroup legend="Time of day">
              {RUN_TIMES.map(([k, l], i) => <ChipRadio key={k} name="run_time" value={k} label={l} defaultChecked={i === 1} />)}
            </ChipGroup>
          </div>

          <button type="submit" className="btn btn-primary">Save campaign</button>
        </form>
      ) : (
        <p className="mt-6 text-muted">Choose a state to continue.</p>
      )}
    </div>
  );
}
