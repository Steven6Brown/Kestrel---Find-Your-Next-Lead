import Link from "next/link";
import { ChipRadio } from "@/components/Chips";
import { formatCents } from "@/lib/crm";
import { INVOICE_KINDS, STATUS_LABELS, amountForKind, isOverdue, statusGroup } from "@/lib/invoicestatus";
import { createInvoiceAction, refreshInvoiceAction, retryInvoiceAction, sendInvoiceAction } from "@/app/(admin)/invoices/actions";

const TONE = {
  paid: "bg-ok-bg text-ok", sent: "bg-warn-bg text-warn", partial: "bg-warn-bg text-warn", draft: "bg-line text-text",
  failed: "bg-bad-bg text-bad", cancelled: "bg-line text-muted", refunded: "bg-line text-muted", pending: "bg-line text-muted", unknown: "bg-line text-muted",
};

export function InvoiceRow({ inv, today, back }) {
  const group = statusGroup(inv.status);
  const late = isOverdue(inv, today);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-ink">
          {inv.invoice_number ? `Invoice ${inv.invoice_number}` : "Invoice"} <span className="font-normal text-muted">· {formatCents(inv.amount_cents, inv.currency)}</span>
          {inv.project_name ? <span className="font-normal text-muted"> · {inv.project_name}</span> : null}
        </p>
        <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${late ? "bg-bad-bg text-bad" : TONE[group]}`}>{late ? "Overdue" : STATUS_LABELS[group]}</span>
      </div>
      <p className="text-sm text-muted">
        To {inv.recipient_email}{inv.due_on && ["sent", "partial"].includes(group) ? ` · due ${inv.due_on}` : ""}
        {inv.view_url ? <> · <a href={inv.view_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">View on PayPal</a></> : null}
      </p>
      {inv.last_error && <p role="alert" className="mt-1 text-sm text-bad">{inv.last_error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {group === "failed" && (
          <form action={retryInvoiceAction}>
            <input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="back" value={back} />
            <button type="submit" className="btn btn-primary">Try again</button>
          </form>
        )}
        {inv.paypal_invoice_id && ["draft", "sent", "partial"].includes(group) && (
          <form action={refreshInvoiceAction}>
            <input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="back" value={back} />
            <button type="submit" className="btn">Refresh status</button>
          </form>
        )}
      </div>
      {group === "draft" && (
        <form action={sendInvoiceAction} className="mt-2 flex flex-wrap items-center gap-3">
          <input type="hidden" name="invoiceId" value={inv.id} /><input type="hidden" name="back" value={back} />
          <span className="flex min-h-[44px] items-center gap-2">
            <input id={`rv-${inv.id}`} name="reviewed" type="checkbox" className="h-5 w-5 accent-[#c08a2e]" />
            <label htmlFor={`rv-${inv.id}`} className="text-sm">I reviewed this invoice and {inv.recipient_email}</label>
          </span>
          <button type="submit" className="btn btn-primary">Send invoice by PayPal</button>
        </form>
      )}
    </li>
  );
}

/** Invoices for one project, plus a form to create the next one. Owner and administrator only. */
export default function InvoicePanel({ project, invoices, paypalReady, today, back }) {
  const billed = invoices.filter((i) => !["failed", "cancelled"].includes(statusGroup(i.status))).reduce((s, i) => s + i.amount_cents, 0);
  const options = INVOICE_KINDS.map(([k, l]) => [k, l, amountForKind(k, project.quoted_amount_cents, billed)]).filter(([, , a]) => a !== null);
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="eyebrow !text-muted">Invoices</p>
      {invoices.length > 0 && <ul className="divide-y divide-line">{invoices.map((i) => <InvoiceRow key={i.id} inv={i} today={today} back={back} />)}</ul>}
      {!project.quoted_amount_cents ? (
        <p className="mt-1 text-sm text-muted">Add a quoted amount to this project to invoice it.</p>
      ) : !paypalReady ? (
        <p className="mt-1 text-sm text-muted">Connect PayPal on the <Link href="/connections" className="underline underline-offset-4">Connections page</Link> to create invoices.</p>
      ) : options.length === 0 ? (
        <p className="mt-1 text-sm text-muted">Everything quoted has been invoiced.</p>
      ) : (
        <form action={createInvoiceAction} className="mt-2 space-y-2">
          <input type="hidden" name="projectId" value={project.id} />
          <fieldset>
            <legend className="sr-only">Kind of invoice for {project.name}</legend>
            <div className="flex flex-wrap gap-2">
              {options.map(([k, l, a], i) => <ChipRadio key={k} name="kind" value={k} label={`${l}: ${formatCents(a)}`} defaultChecked={i === 0} />)}
            </div>
          </fieldset>
          <button type="submit" className="btn">Create draft invoice in PayPal</button>
          <p className="text-sm text-muted">This only creates a draft. Nothing is emailed until you press Send.</p>
        </form>
      )}
    </div>
  );
}
