import Link from "next/link";
import { requireUser, BRAND, isManager } from "@/lib/auth";
import Flash from "@/components/Flash";
import { ChipRadio } from "@/components/Chips";
import { calendarItems, contactChoices } from "@/lib/store";
import { MEETING_LOCATIONS, MEETING_TITLES, isDateStr, todayStr } from "@/lib/crm";
import {
  TYPE_LABELS, WEEKDAYS, assembleCalendar, monthGrid, monthKey, monthOf, monthTitle, parseMonth, shiftMonth,
} from "@/lib/calendar";
import { scheduleFromCalendarAction } from "../clients-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar" };

const TYPE_STYLE = {
  meeting: "border-l-4 border-brand bg-surface",
  task: "border-l-4 border-edge bg-surface",
  invoice: "border-l-4 border-warn bg-surface",
  scan: "border-l-4 border-line bg-surface text-muted",
};

function Item({ item, compact = false }) {
  return (
    <Link href={item.href} className={`block rounded-sm px-2 py-1 text-xs leading-snug hover:text-brand-hover ${TYPE_STYLE[item.type]}`}>
      <span className="font-semibold text-ink"><span className="sr-only">{TYPE_LABELS[item.type]}: </span>{item.title}</span>
      {!compact && item.detail ? <span className="block text-muted">{item.detail}</span> : null}
    </Link>
  );
}

export default async function Calendar({ searchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const today = todayStr();
  const month = parseMonth(sp.month) || monthOf(isDateStr(sp.date) ? sp.date : today);
  const selected = isDateStr(sp.date) ? sp.date : monthOf(today).month === month.month && monthOf(today).year === month.year ? today : `${monthKey(month)}-01`;
  const weeks = monthGrid(month);
  const fromDay = weeks[0][0].date;
  const toDay = weeks[weeks.length - 1][6].date;
  const raw = await calendarItems(BRAND, { fromDay, toDay, includeMoney: isManager(user) });
  const byDay = assembleCalendar(raw, fromDay, toDay);
  const choices = await contactChoices(BRAND);
  const prev = monthKey(shiftMonth(month, -1));
  const next = monthKey(shiftMonth(month, 1));
  const here = monthKey(month);
  const dayItems = byDay[selected] || [];
  const agendaDays = Object.keys(byDay).filter((d) => monthKey(monthOf(d)) === here).sort();

  return (
    <div className="reveal">
      <p className="eyebrow">Calendar</p>
      <h1 className="mt-1 text-4xl font-semibold">{monthTitle(month)}</h1>
      <div className="mt-4"><Flash sp={sp} /></div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/calendar?month=${prev}`} className="btn" aria-label="Previous month">Previous</Link>
        <Link href={`/calendar?month=${monthKey(monthOf(today))}&date=${today}`} className="btn">Today</Link>
        <Link href={`/calendar?month=${next}`} className="btn" aria-label="Next month">Next</Link>
        <a href="/calendar/export" className="btn" download>Download meetings (.ics)</a>
      </div>
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted" aria-label="Key">
        <li><span className="mr-2 inline-block h-3 w-1 bg-brand align-middle" />Meeting</li>
        <li><span className="mr-2 inline-block h-3 w-1 bg-edge align-middle" />Follow-up due</li>
        {isManager(user) && <li><span className="mr-2 inline-block h-3 w-1 bg-warn align-middle" />Invoice due</li>}
        <li><span className="mr-2 inline-block h-3 w-1 bg-line align-middle" />Scheduled scan</li>
      </ul>

      {/* Month grid on larger screens */}
      <div className="card hidden overflow-hidden md:block">
        <table className="w-full table-fixed border-collapse">
          <caption className="sr-only">{monthTitle(month)}</caption>
          <thead>
            <tr>{WEEKDAYS.map((d) => <th key={d} scope="col" className="border-b border-line p-2 text-left eyebrow !text-muted">{d}</th>)}</tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0].date}>
                {week.map((day) => {
                  const items = byDay[day.date] || [];
                  const isToday = day.date === today;
                  const isSel = day.date === selected;
                  return (
                    <td key={day.date} className={`h-32 border-b border-r border-line align-top p-1 ${day.inMonth ? "" : "bg-paper opacity-60"} ${isSel ? "outline outline-2 -outline-offset-2 outline-[#c08a2e]" : ""}`}>
                      <Link
                        href={`/calendar?month=${here}&date=${day.date}`}
                        aria-current={isToday ? "date" : undefined}
                        aria-label={`${day.date}${items.length ? `, ${items.length} item${items.length === 1 ? "" : "s"}` : ""}`}
                        className={`inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded px-1 text-sm font-semibold ${isToday ? "bg-brand text-brand-ink" : "text-ink hover:text-brand-hover"}`}
                      >
                        {Number(day.date.slice(8))}
                      </Link>
                      <ul className="mt-1 space-y-1">
                        {items.slice(0, 3).map((it, i) => <li key={i}><Item item={it} compact /></li>)}
                        {items.length > 3 && <li><Link href={`/calendar?month=${here}&date=${day.date}`} className="px-2 text-xs text-muted underline underline-offset-2">+{items.length - 3} more</Link></li>}
                      </ul>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Agenda list on phones */}
      <section aria-labelledby="agenda-h" className="md:hidden">
        <h2 id="agenda-h" className="text-2xl font-semibold">This month</h2>
        {agendaDays.length === 0 ? <p className="mt-2 text-muted">Nothing scheduled this month.</p> : (
          <ol className="mt-3 space-y-4">
            {agendaDays.map((d) => (
              <li key={d}>
                <p className="font-semibold text-ink">{d}{d === today ? " (today)" : ""}</p>
                <ul className="mt-1 space-y-1">{byDay[d].map((it, i) => <li key={i}><Item item={it} /></li>)}</ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Selected day */}
      <section aria-labelledby="day-h" className="card mt-8 p-5">
        <h2 id="day-h" className="text-2xl font-semibold">{selected}{selected === today ? " (today)" : ""}</h2>
        {dayItems.length === 0 ? <p className="mt-2 text-muted">Nothing on this day.</p> : <ul className="mt-3 space-y-2">{dayItems.map((it, i) => <li key={i}><Item item={it} /></li>)}</ul>}

        <h3 className="mt-6 text-lg font-semibold">Schedule a meeting on this day</h3>
        {choices.length === 0 ? (
          <p className="mt-2 text-muted">Add a contact or client first. Then you can schedule a meeting with them here.</p>
        ) : (
          <form action={scheduleFromCalendarAction} className="mt-3 max-w-xl space-y-4">
            <input type="hidden" name="month" value={here} />
            <div>
              <label htmlFor="cal-target" className="block font-semibold text-ink">With</label>
              <select id="cal-target" name="target" required className="field mt-1" defaultValue="">
                <option value="" disabled>Choose a contact or client</option>
                {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <fieldset><legend className="font-semibold text-ink">Kind of meeting</legend>
              <div className="mt-2 flex flex-wrap gap-2">{MEETING_TITLES.map((t, i) => <ChipRadio key={t} name="title" value={t} label={t} defaultChecked={i === 0} />)}</div>
            </fieldset>
            <fieldset><legend className="font-semibold text-ink">Where</legend>
              <div className="mt-2 flex flex-wrap gap-2">{MEETING_LOCATIONS.map(([k, l], i) => <ChipRadio key={k} name="location" value={k} label={l} defaultChecked={i === 0} />)}</div>
            </fieldset>
            <div>
              <label htmlFor="cal-when" className="block font-semibold text-ink">Date and time</label>
              <input id="cal-when" name="startsAt" type="datetime-local" required defaultValue={`${selected}T10:00`} className="field mt-1 max-w-xs" />
            </div>
            <button type="submit" className="btn btn-primary">Schedule meeting</button>
          </form>
        )}
      </section>
    </div>
  );
}
