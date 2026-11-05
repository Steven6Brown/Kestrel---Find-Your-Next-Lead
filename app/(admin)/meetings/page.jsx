import Link from "next/link";
import { requireUser, BRAND } from "@/lib/auth";
import Flash from "@/components/Flash";
import { listMeetings } from "@/lib/store";
import { MEETING_LOCATIONS, labelOf, meetingWhen } from "@/lib/crm";
import { setMeetingStatusAction } from "../clients-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meetings" };

function Row({ m }) {
  const who = m.lead_name || m.client_name || "Unknown";
  const href = m.lead_id ? `/leads/${m.lead_id}` : `/clients/${m.client_id}`;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="font-semibold text-ink">{m.title} <span className="font-normal text-muted">with</span> <Link href={href} className="underline underline-offset-4 hover:text-brand-hover">{who}</Link></p>
        <p className="text-sm text-muted">{meetingWhen(m.starts_at)} · {labelOf(MEETING_LOCATIONS, m.location)} · {m.status}</p>
        {m.notes && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{m.notes}</p>}
      </div>
      {m.status === "scheduled" && (
        <div className="flex flex-wrap gap-2">
          {[["done", "Mark done"], ["cancelled", "Cancel"]].map(([s, l]) => (
            <form key={s} action={setMeetingStatusAction}>
              <input type="hidden" name="meetingId" value={m.id} /><input type="hidden" name="status" value={s} />
              <button type="submit" className="btn">{l}</button>
            </form>
          ))}
        </div>
      )}
    </li>
  );
}

export default async function Meetings({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const nowIso = new Date().toISOString();
  const [upcoming, past] = await Promise.all([
    listMeetings(BRAND, { fromIso: nowIso, limit: 100 }),
    listMeetings(BRAND, { toIso: nowIso, limit: 25, order: "DESC" }),
  ]);
  return (
    <div className="reveal">
      <p className="eyebrow">Meetings</p>
      <p><Link href="/calendar" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back to calendar</Link></p>
      <h1 className="mt-1 text-4xl font-semibold">Upcoming and recent meetings</h1>
      <p className="mt-2 max-w-2xl text-muted">Log a meeting from a contact or client page. Times are shown in this computer&apos;s time zone. Calendar booking comes later, once Kestrel is hosted.</p>
      <div className="mt-4"><Flash sp={sp} /></div>
      <section aria-labelledby="up-h" className="mt-6">
        <h2 id="up-h" className="text-2xl font-semibold">Upcoming ({upcoming.length})</h2>
        {upcoming.length === 0 ? <p className="mt-2 text-muted">Nothing scheduled.</p> : <ul className="card mt-3 divide-y divide-line">{upcoming.map((m) => <Row key={m.id} m={m} />)}</ul>}
      </section>
      <section aria-labelledby="past-h" className="mt-8">
        <h2 id="past-h" className="text-2xl font-semibold">Recent</h2>
        {past.length === 0 ? <p className="mt-2 text-muted">No past meetings yet.</p> : <ul className="card mt-3 divide-y divide-line">{past.map((m) => <Row key={m.id} m={m} />)}</ul>}
      </section>
    </div>
  );
}
