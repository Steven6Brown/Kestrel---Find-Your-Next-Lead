import Link from "next/link";
import { requireUser, BRAND } from "@/lib/auth";
import Flash from "@/components/Flash";
import { InvoiceRow } from "@/components/InvoicePanel";
import { listInvoices, outstandingSummary } from "@/lib/store";
import { formatCents, todayStr } from "@/lib/crm";
import { paypalMode } from "@/lib/connectors/paypal";
import { reconcileAllAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices" };

export default async function Invoices({ searchParams }) {
  await requireUser({ roles: ["owner", "admin"] });
  const sp = await searchParams;
  const today = todayStr();
  const [invoices, owed] = await Promise.all([listInvoices(BRAND, { limit: 200 }), outstandingSummary(BRAND, today)]);
  const ready = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  return (
    <div className="reveal">
      <p className="eyebrow">Invoices</p>
      <h1 className="mt-1 text-4xl font-semibold">Invoices and payments</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Invoices are created from a project on the client page and sent by PayPal, which also hosts the payment page.
        Kestrel never sees card or bank details.{ready ? ` Mode: ${paypalMode(process.env)}.` : ""}
      </p>
      <div className="mt-4"><Flash sp={sp} /></div>

      <dl className="card grid gap-4 p-5 sm:grid-cols-3">
        <div><dt className="eyebrow !text-muted">Waiting on</dt><dd className="mt-1 text-3xl font-semibold text-ink">{formatCents(owed.outstandingCents)}</dd><dd className="text-sm text-muted">{owed.count} invoice(s)</dd></div>
        <div><dt className="eyebrow !text-muted">Overdue</dt><dd className={`mt-1 text-3xl font-semibold ${owed.overdueCount ? "text-bad" : "text-ink"}`}>{formatCents(owed.overdueCents)}</dd><dd className="text-sm text-muted">{owed.overdueCount} invoice(s)</dd></div>
        <div className="flex items-end">
          {ready ? (
            <form action={reconcileAllAction}>
              <input type="hidden" name="back" value="/invoices" />
              <button type="submit" className="btn btn-primary">Reconcile with PayPal</button>
            </form>
          ) : <Link href="/connections" className="btn">Connect PayPal</Link>}
        </div>
      </dl>
      <p className="mt-2 text-sm text-muted">Reconcile asks PayPal for the latest status of every open invoice. It is how payments show up while Kestrel runs on your computer.</p>

      <section aria-labelledby="all-h" className="card mt-8 p-5">
        <h2 id="all-h" className="text-2xl font-semibold">All invoices</h2>
        {invoices.length === 0 ? <p className="mt-2 text-muted">No invoices yet. Open a client, then a project, to create one.</p> : (
          <ul className="mt-3 divide-y divide-line">{invoices.map((i) => <InvoiceRow key={i.id} inv={i} today={today} back="/invoices" />)}</ul>
        )}
      </section>
    </div>
  );
}
