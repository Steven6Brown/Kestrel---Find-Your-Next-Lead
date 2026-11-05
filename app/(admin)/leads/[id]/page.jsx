import { requireUser } from "@/lib/auth";
import CrmPanels from "@/components/CrmPanels";
import Link from "next/link";
import { notFound } from "next/navigation";
import Flash from "@/components/Flash";
import {
  createDraftAction, draftStatusAction, saveContactAction, saveDraftAction, sendAction, siteCheckAction,
} from "../../actions";
import { DEFAULT_BRAND_ID, getBrand } from "@/config/brands";
import { countSentToday, getDraftByLead, getLead, outreachReady } from "@/lib/store";
import { resolveBody, sendProblems } from "@/lib/email";
import { mockupUrl } from "@/lib/tokens";
import { auditOf, isRedesignLead, longDate } from "@/lib/redesign";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead" };

export default async function LeadPage({ params, searchParams }) {
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const leadId = Number(id);
  const lead = Number.isInteger(leadId) ? await getLead(DEFAULT_BRAND_ID, leadId) : null;
  if (!lead) notFound();
  const brand = getBrand(DEFAULT_BRAND_ID);
  const draft = await getDraftByLead(DEFAULT_BRAND_ID, leadId);
  const isNoSite = lead.bucket === "no_website";
  const redesign = isRedesignLead(lead);
  const audit = auditOf(lead);
  const needsCheck = isNoSite && !outreachReady(lead);
  const checkUrl = `https://www.google.com/search?${new URLSearchParams({ q: [lead.name, lead.city, lead.region].filter(Boolean).join(" ") })}`;
  const problems = draft ? await sendProblems({ lead, draft, brand, sentToday: await countSentToday(DEFAULT_BRAND_ID) }) : [];
  const preview = draft ? resolveBody(draft.body, { brand, email: lead.contact_email }) : "";

  return (
    <div className="reveal">
      <p><Link href={`/leads?bucket=${lead.bucket}`} className="inline-flex min-h-[44px] items-center underline underline-offset-4">Back to list</Link></p>
      <h1 className="mt-2 text-4xl font-semibold">{lead.name}</h1>
      <div className="mt-4"><Flash sp={sp} /></div>

      {needsCheck && (
        <section aria-labelledby="verify-h" className="mb-6 border border-warn bg-warn-bg p-5 text-warn">
          <h2 id="verify-h" className="text-xl font-semibold !text-warn">Check this lead first</h2>
          <p className="mt-2">This came from OpenStreetMap, where a missing website often just means nobody added it. Search for the business yourself, then record what you found.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a className="btn" href={checkUrl} target="_blank" rel="noopener noreferrer">Search the web for this business (opens a new tab)</a>
            <form action={siteCheckAction}>
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="verdict" value="confirmed_none" />
              <button type="submit" className="btn btn-primary">Confirmed: no website</button>
            </form>
            <form action={siteCheckAction}>
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="verdict" value="has_site" />
              <button type="submit" className="btn">They have a website</button>
            </form>
          </div>
        </section>
      )}

      <dl className="grid gap-x-8 gap-y-3 border border-line bg-surface p-5 sm:grid-cols-2">
        {[
          ["Category", lead.category_label],
          ["City", [lead.city, lead.region].filter(Boolean).join(", ")],
          ["Phone", lead.phone],
          ["Address", lead.address],
          ["Website in listing", lead.website || "None listed"],
          ["Bucket", lead.bucket === "unknown" ? "Not checked" : isNoSite ? `No website${lead.website_kind === "social" ? " (social page only)" : ""}` : "Has website"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-sm font-semibold text-muted">{k}</dt>
            <dd className="break-words text-lg">{v || "Not listed"}</dd>
          </div>
        ))}
        {lead.maps_url && (
          <div>
            <dt className="text-sm font-semibold text-muted">Google Maps</dt>
            <dd><a className="underline underline-offset-4" href={lead.maps_url} target="_blank" rel="noopener noreferrer">Open listing (opens in a new tab)</a></dd>
          </div>
        )}
      </dl>

      <CrmPanels lead={lead} />

      <section aria-labelledby="contact-h" className="mt-8 border border-line bg-surface p-5">
        <h2 id="contact-h" className="text-2xl font-semibold">Contact and notes</h2>
        <p className="mt-1 text-muted">Google does not provide email addresses. Add one you found yourself before sending.</p>
        <form action={saveContactAction} className="mt-4 space-y-4">
          <input type="hidden" name="leadId" value={lead.id} />
          <div>
            <label htmlFor="contact_email" className="block font-semibold">Recipient email</label>
            <input id="contact_email" name="contact_email" type="email" autoComplete="off" defaultValue={lead.contact_email || ""} className="field mt-1 max-w-md" />
          </div>
          <div>
            <label htmlFor="status" className="block font-semibold">Status</label>
            <select id="status" name="status" defaultValue={lead.status} className="field mt-1 max-w-xs">
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="skipped">Skipped</option>
              <option value="do_not_contact">Do not contact</option>
            </select>
          </div>
          <div>
            <label htmlFor="notes" className="block font-semibold">Notes</label>
            <textarea id="notes" name="notes" rows={3} defaultValue={lead.notes || ""} className="field mt-1" />
          </div>
          <button type="submit" className="btn">Save</button>
        </form>
      </section>

      {audit ? (
        <section aria-labelledby="audit-h" className="mt-8 border border-line bg-surface p-5">
          <h2 id="audit-h" className="text-2xl font-semibold">Website quality: {audit.score} out of 100</h2>
          <p className="mt-1 text-muted">An automated read of the home page of <a className="break-all underline underline-offset-4" href={audit.website} target="_blank" rel="noopener noreferrer">{audit.website}</a>{audit.checkedAt ? ` on ${longDate(audit.checkedAt)}` : ""}. It can miss things, so look at the site yourself before sending anything.</p>
          {audit.reasons.length ? <ul className="mt-3 list-disc pl-5">{audit.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="mt-3">No problems found by the check.</p>}
        </section>
      ) : null}

      {isNoSite || redesign ? (
        <>
          <section aria-labelledby="mock-h" className="mt-8 border border-line bg-surface p-5">
            <h2 id="mock-h" className="text-2xl font-semibold">{redesign ? "Redesign concept" : "Mockup"}</h2>
            <p className="mt-1 text-muted">{redesign ? "Generated from this lead's real listing data plus the quality check above. Nothing is copied from their site." : "Generated automatically from this lead's real listing data."}</p>
            <p className="mt-3 break-all"><a className="underline underline-offset-4" href={`/m/${lead.mockup_token}`} target="_blank" rel="noopener noreferrer">{mockupUrl(lead.mockup_token)}</a> (opens in a new tab)</p>
          </section>

          <section aria-labelledby="draft-h" className="mt-8 border border-line bg-surface p-5">
            <h2 id="draft-h" className="text-2xl font-semibold">Outreach draft</h2>
            {!draft && needsCheck ? (
              <p className="mt-3 text-muted">Confirm the business has no website above to unlock outreach.</p>
            ) : !draft ? (
              <form action={createDraftAction} className="mt-4">
                <input type="hidden" name="leadId" value={lead.id} />
                <button type="submit" className="btn btn-primary">Create draft</button>
              </form>
            ) : (
              <>
                <p className="mt-1"><strong>Status:</strong> {draft.status}{draft.sent_at ? ` to ${draft.sent_to} on ${draft.sent_at.slice(0, 10)}` : ""}</p>
                {draft.send_error && <p className="mt-1 text-bad" role="alert">Last send error: {draft.send_error}</p>}
                {draft.status !== "sent" && (
                  <form action={saveDraftAction} className="mt-4 space-y-4">
                    <input type="hidden" name="leadId" value={lead.id} />
                    <div>
                      <label htmlFor="subject" className="block font-semibold">Subject</label>
                      <input id="subject" name="subject" defaultValue={draft.subject} className="field mt-1" maxLength={200} />
                    </div>
                    <div>
                      <label htmlFor="body" className="block font-semibold">Body</label>
                      <textarea id="body" name="body" rows={18} defaultValue={draft.body} className="field mt-1 font-mono text-sm" aria-describedby="body-h" />
                      <p id="body-h" className="mt-1 text-sm text-muted">Keep the address line and the unsubscribe placeholder. Saving sends the draft back to review.</p>
                    </div>
                    <button type="submit" className="btn">Save changes</button>
                  </form>
                )}

                <h3 className="mt-6 text-xl font-bold">Exact text that will be sent</h3>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words border border-line bg-paper p-4 text-sm">{`Subject: ${draft.subject}\n\n${preview}`}</pre>

                {draft.status !== "sent" && (
                  <div className="mt-6 space-y-4">
                    <div className="flex flex-wrap gap-3">
                      <form action={createDraftAction}>
                        <input type="hidden" name="leadId" value={lead.id} />
                        <button type="submit" className="btn">Regenerate from template</button>
                      </form>
                      <form action={draftStatusAction}>
                        <input type="hidden" name="leadId" value={lead.id} />
                        <input type="hidden" name="status" value="approved" />
                        <button type="submit" className="btn btn-primary" disabled={draft.status === "approved"}>Approve</button>
                      </form>
                      <form action={draftStatusAction}>
                        <input type="hidden" name="leadId" value={lead.id} />
                        <input type="hidden" name="status" value="rejected" />
                        <button type="submit" className="btn">Reject</button>
                      </form>
                    </div>

                    <form action={sendAction} className="border-t border-line pt-4">
                      <input type="hidden" name="leadId" value={lead.id} />
                      <h3 className="text-xl font-bold">Send manually</h3>
                      {problems.length > 0 && (
                        <ul className="mt-2 list-disc pl-5 text-warn">
                          {problems.map((p) => <li key={p}>{p}</li>)}
                        </ul>
                      )}
                      <div className="mt-3 flex min-h-[44px] items-center gap-3">
                        <input id="reviewed" name="reviewed" type="checkbox" className="h-6 w-6" />
                        <label htmlFor="reviewed">I reviewed this exact email and the recipient</label>
                      </div>
                      <button type="submit" className="btn btn-primary mt-3" disabled={problems.length > 0}>Send this email now</button>
                    </form>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      ) : lead.bucket === "unknown" ? null : (
        <p className="mt-8 text-muted">This business already lists a website, so no mockup or outreach is created. It stays here as a future redesign lead.</p>
      )}
    </div>
  );
}
