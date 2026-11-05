import Link from "next/link";
import { requireUser, BRAND } from "@/lib/auth";
import Flash from "@/components/Flash";
import { leadsByStage, stageCounts } from "@/lib/store";
import { STAGES, dueLabel, sourceLabel, todayStr } from "@/lib/crm";
import { setStageAction } from "../crm-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipeline" };

export default async function Pipeline({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const today = todayStr();
  const [counts, columns] = await Promise.all([
    stageCounts(BRAND),
    Promise.all(STAGES.map(async ([k]) => [k, await leadsByStage(BRAND, k, 25)])),
  ]);
  const byStage = Object.fromEntries(columns);

  return (
    <div className="reveal">
      <p className="eyebrow">Pipeline</p>
      <h1 className="mt-1 text-4xl font-semibold">Everyone you are dealing with</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Scanned businesses join the pipeline once you create an outreach draft for them. Contacts you add by hand and website inquiries start here too.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Flash sp={sp} />
      </div>
      <p className="mb-4"><Link href="/leads/new" className="btn btn-primary">Add a contact</Link></p>

      <div className="-mx-4 overflow-x-auto px-4 pb-4">
        <ol className="flex min-w-max gap-4">
          {STAGES.map(([k, label]) => (
            <li key={k} id={`stage-${k}`} className="w-72 shrink-0">
              <section aria-labelledby={`h-${k}`}>
                <h2 id={`h-${k}`} className="eyebrow !text-ink">{label} <span className="!text-muted">({counts[k] || 0})</span></h2>
                {byStage[k].length === 0 ? (
                  <p className="card mt-2 p-3 text-sm text-muted">Nobody here.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {byStage[k].map((l) => (
                      <li key={l.id} className="card p-3">
                        <Link href={`/leads/${l.id}`} className="font-semibold text-ink underline underline-offset-4 hover:text-brand-hover">{l.name}</Link>
                        <p className="mt-1 text-xs text-muted">{[l.city, sourceLabel(l.source)].filter(Boolean).join(" · ")}</p>
                        {l.next_due && <p className={`mt-1 text-xs ${l.next_due < today ? "text-bad" : "text-muted"}`}>{dueLabel(l.next_due, today)}</p>}
                        <form action={setStageAction} className="mt-2 flex items-center gap-2">
                          <input type="hidden" name="leadId" value={l.id} />
                          <input type="hidden" name="back" value="/pipeline" />
                          <label htmlFor={`mv-${l.id}`} className="sr-only">Move {l.name} to</label>
                          <select id={`mv-${l.id}`} name="stage" defaultValue={k} className="field !min-h-[44px] !py-1 text-sm">
                            {STAGES.map(([sk, sl]) => <option key={sk} value={sk}>{sl}</option>)}
                          </select>
                          <button type="submit" className="btn !px-3">Move</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
                {(counts[k] || 0) > byStage[k].length && (
                  <p className="mt-2 text-sm"><Link href={`/leads?stage=${k}&site=any`} className="underline underline-offset-4 text-muted hover:text-brand-hover">See all {counts[k]}</Link></p>
                )}
              </section>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
