import Link from "next/link";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import PageHeader from "@/components/PageHeader";
import ProspectTabs from "@/components/ProspectTabs";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { duplicateGroups } from "@/lib/store";
import { sourceLabel, stageLabel } from "@/lib/crm";
import { dismissDuplicatesAction, mergeDuplicatesAction } from "../../duplicates-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Duplicates" };

export default async function Duplicates({ searchParams }) {
  await requireUser({ roles: ["owner", "admin"] });
  const sp = await searchParams;
  const groups = await duplicateGroups(DEFAULT_BRAND_ID);

  return (
    <div className="reveal">
      <PageHeader
        title="Duplicates"
        subtitle="Contacts that look like the same business listed more than once. Pick the one to keep and everything from the others moves onto it. Nothing is merged until you press the button."
      />
      <ProspectTabs current="duplicates" />
      <div className="mb-4"><Flash sp={sp} /></div>

      {groups.length === 0 ? (
        <p className="card p-5 text-muted">No likely duplicates. Kestrel compares names, places, phone numbers, email addresses, and websites, and it treats two entries far apart on the map as different places.</p>
      ) : (
        <>
          <p className="mb-4 text-muted">{groups.length} group{groups.length === 1 ? "" : "s"} to look at.</p>
          <ul className="space-y-6">
            {groups.map((g) => (
              <li key={g.ids.join("-")}>
                <form action={mergeDuplicatesAction} className="card p-5">
                  {g.ids.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
                  <h2 className="text-xl font-semibold">{g.ids.length} contacts that look like one business</h2>
                  <p className="mt-1 text-sm text-muted">Why: {g.reasons.join(", ").toLowerCase() || "similar details"}.</p>
                  <fieldset className="mt-4">
                    <legend className="font-semibold text-ink">Keep which one?</legend>
                    <ul className="mt-2 divide-y divide-line">
                      {g.members.map((m) => (
                        <li key={m.id} className="flex items-start gap-3 py-3">
                          <input id={`k-${g.keep}-${m.id}`} type="radio" name="keep" value={m.id} defaultChecked={m.id === g.keep} className="mt-1 h-6 w-6 shrink-0" />
                          <label htmlFor={`k-${g.keep}-${m.id}`} className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                            <span className="block font-semibold text-ink">{m.name}{m.has_client ? " (client)" : ""}</span>
                            <span className="block text-sm text-muted">
                              {[m.city, m.phone, m.contact_email, m.website].filter(Boolean).join(" · ") || "No other details"}
                            </span>
                            <span className="block text-sm text-muted">
                              {sourceLabel(m.source)} · {stageLabel(m.stage)} · {m.activity_count} timeline entr{m.activity_count === 1 ? "y" : "ies"}{m.deal_count ? ` · ${m.deal_count} deal(s)` : ""}
                            </span>
                          </label>
                          <Link href={`/leads/${m.id}`} className="btn shrink-0" target="_blank" rel="noopener noreferrer" aria-label={`Open ${m.name} in a new tab`}>Open</Link>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="submit" className="btn btn-primary">Merge into the one I keep</button>
                    <button type="submit" formAction={dismissDuplicatesAction} className="btn">These are different</button>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
