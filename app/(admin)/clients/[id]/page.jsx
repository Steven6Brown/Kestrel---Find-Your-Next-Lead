import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, BRAND, isManager } from "@/lib/auth";
import InvoicePanel from "@/components/InvoicePanel";
import Flash from "@/components/Flash";
import { ChipRadio } from "@/components/Chips";
import MeetingForm from "@/components/MeetingForm";
import { getClient, listInvoices, listMeetings, listProjects } from "@/lib/store";
import {
  CLIENT_STATUSES, MEETING_LOCATIONS, PROJECT_STATUSES, PROJECT_TYPES, formatCents, labelOf, meetingWhen, todayStr,
} from "@/lib/crm";
import {
  createProjectAction, saveClientNotesAction, setClientStatusAction, setMeetingStatusAction, setProjectStatusAction,
} from "../../clients-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client" };

export default async function ClientPage({ params, searchParams }) {
  const user = await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const cid = Number(id);
  const client = Number.isInteger(cid) ? await getClient(BRAND, cid) : null;
  if (!client) notFound();
  const canBill = isManager(user);
  const invoices = canBill ? await listInvoices(BRAND, { clientId: cid }) : [];
  const today = todayStr();
  const paypalReady = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  const [projects, meetings] = await Promise.all([
    listProjects(BRAND, { clientId: cid }),
    listMeetings(BRAND, { limit: 500 }).then((all) => all.filter((m) => m.client_id === cid)),
  ]);

  return (
    <div className="reveal">
      <p><Link href="/clients" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back to clients</Link></p>
      <p className="eyebrow mt-2">Client</p>
      <h1 className="mt-1 text-4xl font-semibold">{client.name}</h1>
      <div className="mt-4"><Flash sp={sp} /></div>

      <dl className="card grid gap-4 p-5 sm:grid-cols-3">
        <div><dt className="eyebrow !text-muted">Email</dt><dd className="mt-1 break-all">{client.email || "Not saved"}</dd></div>
        <div><dt className="eyebrow !text-muted">Phone</dt><dd className="mt-1">{client.phone || "Not saved"}</dd></div>
        <div>
          <dt className="eyebrow !text-muted">Original contact</dt>
          <dd className="mt-1">{client.lead_id ? <Link className="underline underline-offset-4" href={`/leads/${client.lead_id}`}>Open the contact and timeline</Link> : "Added directly as a client"}</dd>
        </div>
      </dl>

      <section aria-labelledby="st-h" className="card mt-8 p-5">
        <h2 id="st-h" className="text-2xl font-semibold">Status</h2>
        <form action={setClientStatusAction} className="mt-3">
          <input type="hidden" name="clientId" value={client.id} />
          <div className="flex flex-wrap gap-2">{CLIENT_STATUSES.map(([k, l]) => <ChipRadio key={k} name="status" value={k} label={l} defaultChecked={client.status === k} />)}</div>
          <button type="submit" className="btn btn-primary mt-3">Save status</button>
        </form>
      </section>

      <section aria-labelledby="pr-h" className="card mt-8 p-5">
        <h2 id="pr-h" className="text-2xl font-semibold">Projects</h2>
        {projects.length === 0 ? <p className="mt-2 text-muted">No projects yet.</p> : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {projects.map((p) => (
              <li key={p.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-ink">{p.name} <span className="font-normal text-muted">· {labelOf(PROJECT_TYPES, p.type)}</span></p>
                  <p className="text-ink">{formatCents(p.quoted_amount_cents, p.currency)}</p>
                </div>
                <p className="text-sm text-muted">
                  {[p.start_on && `Starts ${p.start_on}`, p.target_on && `Target ${p.target_on}`].filter(Boolean).join(" · ") || "No dates set"}
                </p>
                {p.notes && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">{p.notes}</p>}
                {canBill && <InvoicePanel project={p} invoices={invoices.filter((i) => i.project_id === p.id)} paypalReady={paypalReady} today={today} back={`/clients/${client.id}`} />}
                <form action={setProjectStatusAction} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="projectId" value={p.id} />
                  <input type="hidden" name="clientId" value={client.id} />
                  <label htmlFor={`ps-${p.id}`} className="sr-only">Status for {p.name}</label>
                  <select id={`ps-${p.id}`} name="status" defaultValue={p.status} className="field !w-auto">
                    {PROJECT_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <button type="submit" className="btn">Update</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={createProjectAction} className="mt-5 space-y-4">
          <input type="hidden" name="clientId" value={client.id} />
          <h3 className="text-lg font-semibold">Add a project</h3>
          <div>
            <label htmlFor="pname" className="block font-semibold text-ink">Project name</label>
            <input id="pname" name="name" required minLength={2} maxLength={160} className="field mt-1 max-w-md" />
          </div>
          <fieldset><legend className="font-semibold text-ink">Type</legend>
            <div className="mt-2 flex flex-wrap gap-2">{PROJECT_TYPES.map(([k, l], i) => <ChipRadio key={k} name="type" value={k} label={l} defaultChecked={i === 0} />)}</div>
          </fieldset>
          <fieldset><legend className="font-semibold text-ink">Status</legend>
            <div className="mt-2 flex flex-wrap gap-2">{PROJECT_STATUSES.map(([k, l], i) => <ChipRadio key={k} name="status" value={k} label={l} defaultChecked={i === 0} />)}</div>
          </fieldset>
          <div>
            <label htmlFor="pamt" className="block font-semibold text-ink">Quoted amount in US dollars (optional)</label>
            <input id="pamt" name="amount" inputMode="decimal" maxLength={20} className="field mt-1 max-w-xs" />
          </div>
          <div className="flex flex-wrap gap-4">
            <div><label htmlFor="pstart" className="block font-semibold text-ink">Start date</label><input id="pstart" name="startOn" type="date" className="field mt-1" /></div>
            <div><label htmlFor="ptarget" className="block font-semibold text-ink">Target date</label><input id="ptarget" name="targetOn" type="date" className="field mt-1" /></div>
          </div>
          <div>
            <label htmlFor="pnotes" className="block font-semibold text-ink">Notes</label>
            <textarea id="pnotes" name="notes" rows={2} maxLength={4000} className="field mt-1" />
          </div>
          <button type="submit" className="btn btn-primary">Add project</button>
        </form>
      </section>

      <section aria-labelledby="mt-h" className="card mt-8 p-5">
        <h2 id="mt-h" className="text-2xl font-semibold">Meetings</h2>
        {meetings.length > 0 && (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {meetings.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <p><span className="font-semibold text-ink">{m.title}</span> <span className="text-muted">· {meetingWhen(m.starts_at)} · {labelOf(MEETING_LOCATIONS, m.location)} · {m.status}</span></p>
                {m.status === "scheduled" && (
                  <form action={setMeetingStatusAction}>
                    <input type="hidden" name="meetingId" value={m.id} /><input type="hidden" name="status" value="done" />
                    <button type="submit" className="btn">Mark done</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <MeetingForm clientId={client.id} />
      </section>

      <section aria-labelledby="cn-h" className="card mt-8 p-5">
        <h2 id="cn-h" className="text-2xl font-semibold">Notes</h2>
        <form action={saveClientNotesAction} className="mt-3">
          <input type="hidden" name="clientId" value={client.id} />
          <label htmlFor="cnotes" className="sr-only">Client notes</label>
          <textarea id="cnotes" name="notes" rows={4} maxLength={4000} defaultValue={client.notes || ""} className="field" />
          <button type="submit" className="btn mt-3">Save notes</button>
        </form>
      </section>
    </div>
  );
}
