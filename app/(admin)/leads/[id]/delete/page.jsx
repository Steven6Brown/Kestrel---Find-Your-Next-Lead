import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND, requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import PageHeader from "@/components/PageHeader";
import { getLead } from "@/lib/store";
import { deleteBlocker, deleteSummary } from "@/lib/privacy";
import { deleteContactAction } from "../../../privacy-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delete contact" };

export default async function DeleteContact({ params, searchParams }) {
  await requireUser({ roles: ["owner", "admin"] });
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const leadId = Number(id);
  const lead = Number.isInteger(leadId) && leadId > 0 ? await getLead(BRAND, leadId) : null;
  if (!lead) notFound();
  const [blocker, sum] = await Promise.all([deleteBlocker(BRAND, leadId), deleteSummary(BRAND, leadId)]);

  return (
    <div className="reveal">
      <p><Link href={`/leads/${lead.id}`} className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back to {lead.name}</Link></p>
      <PageHeader title={`Delete ${lead.name}?`} subtitle="Use this when someone asks to be removed. It cannot be undone." />
      <div className="mb-4"><Flash sp={sp} /></div>

      {blocker ? (
        <section aria-labelledby="blocked-h" className="border border-warn bg-warn-bg p-5 text-warn">
          <h2 id="blocked-h" className="text-xl font-semibold !text-warn">This contact cannot be deleted</h2>
          <p className="mt-2">{blocker}</p>
          <p className="mt-4"><a className="btn" href={`/leads/${lead.id}/export`} download>Export their data</a></p>
        </section>
      ) : (
        <>
          <section aria-labelledby="gone-h" className="card p-5">
            <h2 id="gone-h" className="text-xl font-semibold">What will be deleted</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>The contact: name, phone, email, notes, and address</li>
              <li>{sum.drafts} email draft(s)</li>
              <li>{sum.activities} timeline entr{sum.activities === 1 ? "y" : "ies"}</li>
              <li>{sum.tasks} follow-up(s), {sum.meetings} meeting(s), and {sum.deals} deal(s)</li>
              <li>Their concept page, which stops working</li>
            </ul>
          </section>
          <section aria-labelledby="kept-h" className="card mt-4 p-5">
            <h2 id="kept-h" className="text-xl font-semibold">What is kept, on purpose</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>{lead.contact_email ? "Their email address, on the do not contact list only, so nobody emails them again." : "Nothing about them. There is no email address on file."}</li>
              <li>The public listing id of the business, so a later scan does not add it back.</li>
              <li>A line in the audit log saying who deleted a contact and when, without their details.</li>
              <li>Backup files made before today still hold them until newer backups replace those. Kestrel keeps the newest 30.</li>
            </ul>
            <p className="mt-3"><a className="btn" href={`/leads/${lead.id}/export`} download>Export their data first</a></p>
          </section>
          <form action={deleteContactAction} className="card mt-4 p-5">
            <input type="hidden" name="leadId" value={lead.id} />
            <div className="flex min-h-[44px] items-center gap-3">
              <input id="confirm" name="confirm" type="checkbox" value="yes" required className="h-6 w-6" />
              <label htmlFor="confirm">I understand this cannot be undone</label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="submit" className="btn btn-primary">Delete permanently</button>
              <Link href={`/leads/${lead.id}`} className="btn">Cancel</Link>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
