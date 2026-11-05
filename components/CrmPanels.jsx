import { BRAND } from "@/lib/auth";
import { ChipRadio } from "@/components/Chips";
import { listActivities, tasksForLead } from "@/lib/store";
import { KIND_LABELS, LOGGABLE_KINDS, QUICK_DUE, STAGES, dueLabel, sourceLabel, todayStr } from "@/lib/crm";
import { addTaskAction, addTimelineAction, completeTaskAction, saveOwnerNotesAction, setStageAction } from "@/app/(admin)/crm-actions";

const when = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** Pipeline stage, follow-ups, notes and the timeline for one contact. */
export default async function CrmPanels({ lead }) {
  const [tasks, activities] = await Promise.all([tasksForLead(BRAND, lead.id), listActivities(BRAND, lead.id, 100)]);
  const today = todayStr();
  const open = tasks.filter((t) => !t.done_at);
  const done = tasks.filter((t) => t.done_at);
  const fromScan = lead.source === "kestrel";

  return (
    <>
      <section aria-labelledby="stage-h" className="card mt-8 p-5">
        <h2 id="stage-h" className="text-2xl font-semibold">Pipeline</h2>
        <p className="mt-1 text-sm text-muted">
          Source: {sourceLabel(lead.source)}.{" "}
          {fromScan ? "Business details above came from a public listing (externally sourced). Everything on this panel is your own notes." : "Everything here was entered by you or the contact."}
        </p>
        <form action={setStageAction} className="mt-4">
          <input type="hidden" name="leadId" value={lead.id} />
          <fieldset>
            <legend className="font-semibold text-ink">Stage</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {STAGES.map(([k, l]) => <ChipRadio key={k} name="stage" value={k} label={l} defaultChecked={lead.stage === k} />)}
            </div>
          </fieldset>
          <p className="mt-2 text-sm text-muted">Choosing &quot;Not interested&quot; also blocks any email to this person.</p>
          <button type="submit" className="btn btn-primary mt-3">Save stage</button>
        </form>
      </section>

      <section aria-labelledby="fu-h" className="card mt-8 p-5">
        <h2 id="fu-h" className="text-2xl font-semibold">Follow-ups</h2>
        {open.length === 0 ? (
          <p className="mt-2 text-muted">No open follow-ups.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {open.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold text-ink">{t.title}</p>
                  <p className={`text-sm ${t.due_on < today ? "text-bad" : "text-muted"}`}>{dueLabel(t.due_on, today)}</p>
                </div>
                <form action={completeTaskAction}>
                  <input type="hidden" name="taskId" value={t.id} />
                  <input type="hidden" name="back" value={`/leads/${lead.id}`} />
                  <button type="submit" className="btn">Done</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addTaskAction} className="mt-4 space-y-4">
          <input type="hidden" name="leadId" value={lead.id} />
          <div>
            <label htmlFor="task-title" className="block font-semibold text-ink">New follow-up</label>
            <input id="task-title" name="title" required minLength={2} maxLength={200} className="field mt-1 max-w-md" placeholder="For example: check in about the proposal" />
          </div>
          <fieldset>
            <legend className="font-semibold text-ink">Due</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_DUE.map(([l, d], i) => <ChipRadio key={d} name="quick" value={String(d)} label={l} defaultChecked={i === 1} />)}
            </div>
            <label htmlFor="task-date" className="mt-3 block text-sm text-muted">Or pick a date instead</label>
            <input id="task-date" name="dueOn" type="date" className="field mt-1 max-w-xs" />
          </fieldset>
          <button type="submit" className="btn btn-primary">Add follow-up</button>
        </form>
        {done.length > 0 && (
          <details className="mt-4 text-sm text-muted">
            <summary className="cursor-pointer font-semibold text-ink">Completed ({done.length})</summary>
            <ul className="mt-2 list-disc pl-5">{done.map((t) => <li key={t.id}>{t.title} (done {when(t.done_at)})</li>)}</ul>
          </details>
        )}
      </section>

      <section aria-labelledby="tl-h" className="card mt-8 p-5">
        <h2 id="tl-h" className="text-2xl font-semibold">Timeline</h2>
        <form action={addTimelineAction} className="mt-4 space-y-4">
          <input type="hidden" name="leadId" value={lead.id} />
          <fieldset>
            <legend className="font-semibold text-ink">Log</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {LOGGABLE_KINDS.map(([k, l], i) => <ChipRadio key={k} name="kind" value={k} label={l} defaultChecked={i === 0} />)}
            </div>
          </fieldset>
          <div>
            <label htmlFor="tl-body" className="block font-semibold text-ink">What happened</label>
            <textarea id="tl-body" name="body" required maxLength={4000} rows={3} className="field mt-1" />
          </div>
          <button type="submit" className="btn btn-primary">Add to timeline</button>
        </form>
        {activities.length === 0 ? (
          <p className="mt-4 text-muted">Nothing logged yet.</p>
        ) : (
          <ol className="mt-5 divide-y divide-line border-y border-line">
            {activities.map((a) => (
              <li key={a.id} className="py-3">
                <p className="text-sm text-muted">
                  <span className="eyebrow">{KIND_LABELS[a.kind] || a.kind}</span> · {when(a.created_at)}{a.user_name ? ` · ${a.user_name}` : ""}
                </p>
                {a.body && <p className="mt-1 whitespace-pre-wrap break-words text-ink">{a.body}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="own-h" className="card mt-8 p-5">
        <h2 id="own-h" className="text-2xl font-semibold">Private notes</h2>
        <form action={saveOwnerNotesAction} className="mt-3">
          <input type="hidden" name="leadId" value={lead.id} />
          <label htmlFor="own-notes" className="sr-only">Private notes</label>
          <textarea id="own-notes" name="notes" rows={4} maxLength={4000} defaultValue={lead.owner_notes || ""} className="field" />
          <button type="submit" className="btn mt-3">Save notes</button>
        </form>
      </section>
    </>
  );
}
