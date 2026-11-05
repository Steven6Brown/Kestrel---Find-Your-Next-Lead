import Link from "next/link";
import { requireUser, isManager } from "@/lib/auth";
import Flash from "@/components/Flash";
import { BRAND } from "@/lib/auth";
import { dueTasks, listMeetings, needsFollowUp, outstandingSummary, stageCounts } from "@/lib/store";
import { CLOSED_STAGES, MEETING_LOCATIONS, QUICK_DUE, nextDaysWindow, STAGES, addDays, dueLabel, labelOf, meetingWhen, stageLabel, todayStr } from "@/lib/crm";
import { completeTaskAction, snoozeTaskAction } from "../crm-actions";
import { reconcileAllAction } from "../invoices/actions";
import { formatCents } from "@/lib/crm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Today" };

function TaskRow({ t, today }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="font-semibold text-ink">{t.title}</p>
        <p className="text-sm text-muted">
          <Link href={`/leads/${t.lead_id}`} className="underline underline-offset-4 hover:text-brand-hover">{t.lead_name}</Link>
          {" · "}{stageLabel(t.lead_stage)}{" · "}{dueLabel(t.due_on, today)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <form action={completeTaskAction}>
          <input type="hidden" name="taskId" value={t.id} />
          <input type="hidden" name="back" value="/today" />
          <button type="submit" className="btn btn-primary">Done</button>
        </form>
        {QUICK_DUE.slice(0, 3).map(([label, days]) => (
          <form key={days} action={snoozeTaskAction}>
            <input type="hidden" name="taskId" value={t.id} />
            <input type="hidden" name="days" value={days} />
            <input type="hidden" name="back" value="/today" />
            <button type="submit" className="btn" aria-label={`Move to ${label.toLowerCase()}`}>{label}</button>
          </form>
        ))}
      </div>
    </li>
  );
}

function Group({ id, title, tasks, today, empty }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="text-2xl font-semibold">{title} <span className="text-base font-normal text-muted">({tasks.length})</span></h2>
      {tasks.length === 0 ? (
        <p className="mt-2 text-muted">{empty}</p>
      ) : (
        <ul className="card mt-3 divide-y divide-line">{tasks.map((t) => <TaskRow key={t.id} t={t} today={today} />)}</ul>
      )}
    </section>
  );
}

export default async function Today({ searchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayStr();
  const win = nextDaysWindow(7);
  const [tasks, waiting, counts, meetings] = await Promise.all([
    dueTasks(BRAND, today, 7, addDays), needsFollowUp(BRAND, 15), stageCounts(BRAND),
    listMeetings(BRAND, { ...win, limit: 20 }),
  ]);
  const money = isManager(user) ? await outstandingSummary(BRAND, today) : null;
  const paypalReady = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  const open = STAGES.filter(([k]) => !CLOSED_STAGES.includes(k));

  return (
    <div className="reveal">
      <p className="eyebrow">{today}</p>
      <h1 className="mt-1 text-4xl font-semibold">Who to follow up with today</h1>
      <div className="mt-4"><Flash sp={sp} /></div>

      <ul className="card mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Open pipeline">
        {open.map(([k, label]) => (
          <li key={k} className="border-b border-r border-line p-4">
            <Link href={`/pipeline#stage-${k}`} className="block">
              <p className="eyebrow !text-muted">{label}</p>
              <p className="mt-1 text-3xl font-semibold text-ink">{counts[k] || 0}</p>
            </Link>
          </li>
        ))}
      </ul>

      {money && (
        <section aria-labelledby="money-h" className="mt-8">
          <h2 id="money-h" className="text-2xl font-semibold">Money waiting on you</h2>
          <div className="card mt-3 flex flex-wrap items-center justify-between gap-4 p-4">
            <p>
              <span className="text-3xl font-semibold text-ink">{formatCents(money.outstandingCents)}</span>{" "}
              <span className="text-muted">across {money.count} invoice(s)</span>
              {money.overdueCount > 0 && <span className="ml-2 font-semibold text-bad">{formatCents(money.overdueCents)} overdue</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/invoices" className="btn">Invoices</Link>
              {paypalReady && (
                <form action={reconcileAllAction}>
                  <input type="hidden" name="back" value="/today" />
                  <button type="submit" className="btn btn-primary">Reconcile with PayPal</button>
                </form>
              )}
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="meet-h" className="mt-8">
        <h2 id="meet-h" className="text-2xl font-semibold">Meetings in the next 7 days <span className="text-base font-normal text-muted">({meetings.length})</span></h2>
        {meetings.length === 0 ? <p className="mt-2 text-muted">No meetings scheduled.</p> : (
          <ul className="card mt-3 divide-y divide-line">
            {meetings.map((m) => (
              <li key={m.id} className="p-4">
                <p className="font-semibold text-ink">{m.title} <span className="font-normal text-muted">with</span>{" "}
                  <Link href={m.lead_id ? `/leads/${m.lead_id}` : `/clients/${m.client_id}`} className="underline underline-offset-4 hover:text-brand-hover">{m.lead_name || m.client_name}</Link></p>
                <p className="text-sm text-muted">{meetingWhen(m.starts_at)} · {labelOf(MEETING_LOCATIONS, m.location)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Group id="over-h" title="Overdue" tasks={tasks.overdue} today={today} empty="Nothing overdue." />
      <Group id="today-h" title="Due today" tasks={tasks.today} today={today} empty="Nothing due today." />
      <Group id="soon-h" title="Coming up this week" tasks={tasks.upcoming} today={today} empty="Nothing scheduled in the next 7 days." />

      <section aria-labelledby="wait-h" className="mt-8">
        <h2 id="wait-h" className="text-2xl font-semibold">Mid-conversation with no follow-up set <span className="text-base font-normal text-muted">({waiting.length})</span></h2>
        <p className="mt-1 text-muted">These people are in the pipeline but nothing will remind you to chase them. Open one and add a follow-up.</p>
        {waiting.length === 0 ? (
          <p className="mt-2 text-muted">Everyone in progress has a follow-up.</p>
        ) : (
          <ul className="card mt-3 divide-y divide-line">
            {waiting.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <p><span className="font-semibold text-ink">{w.name}</span> <span className="text-muted">· {stageLabel(w.stage)}</span></p>
                <Link href={`/leads/${w.id}`} className="btn">Open</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-10"><Link href="/leads/new" className="btn">Add a contact</Link></p>
    </div>
  );
}
