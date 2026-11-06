import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import PageHeader from "@/components/PageHeader";
import { ChipGroup, ChipRadio } from "@/components/Chips";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { getDeal } from "@/lib/store";
import { DEAL_STAGES, LOST_REASONS, dealStageLabel, isOpenStage, lostReasonLabel, weightedCents } from "@/lib/deals";
import { PROJECT_TYPES, formatCents, labelOf } from "@/lib/crm";
import { loseDealAction, moveDealAction, reopenDealAction, updateDealAction, winDealAction } from "../../deals-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deal" };

export default async function DealPage({ params, searchParams }) {
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const dealId = Number(id);
  const deal = Number.isInteger(dealId) && dealId > 0 ? await getDeal(DEFAULT_BRAND_ID, dealId) : null;
  if (!deal) notFound();
  const open = isOpenStage(deal.stage);
  const amountText = deal.amount_cents == null ? "" : (deal.amount_cents / 100).toFixed(2).replace(/\.00$/, "");

  return (
    <div className="reveal">
      <p><Link href="/deals" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back to deals</Link></p>
      <PageHeader
        title={deal.title}
        subtitle={`${dealStageLabel(deal.stage)}${deal.lost_reason ? `: ${lostReasonLabel(deal.lost_reason)}` : ""}. With ${deal.lead_name}.`}
        actions={<Link href={`/leads/${deal.lead_id}`} className="btn">Open {deal.lead_name}</Link>}
      />
      <div className="mb-4"><Flash sp={sp} /></div>

      <section aria-labelledby="sum-h" className="card p-5">
        <h2 id="sum-h" className="sr-only">Summary</h2>
        <dl className="grid gap-4 sm:grid-cols-4">
          {[
            ["Amount", formatCents(deal.amount_cents)],
            ["Chance to win", `${deal.probability}%`],
            ["Forecast value", open ? formatCents(weightedCents(deal)) : deal.stage === "won" ? formatCents(deal.amount_cents) : "$0.00"],
            ["Expected close", deal.expected_close_on || "Not set"],
          ].map(([k, v]) => (
            <div key={k}><dt className="text-sm text-muted">{k}</dt><dd className="text-xl font-semibold text-ink">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-muted">Kind of work: {labelOf(PROJECT_TYPES, deal.type)}. {deal.closed_at ? `Closed ${deal.closed_at.slice(0, 10)}.` : ""}</p>
      </section>

      {open ? (
        <>
          <form action={updateDealAction} className="card mt-6 max-w-2xl space-y-5 p-5">
            <h2 className="text-xl font-semibold">Edit this deal</h2>
            <input type="hidden" name="dealId" value={deal.id} />
            <div>
              <label htmlFor="title" className="block font-semibold text-ink">Name</label>
              <input id="title" name="title" required maxLength={120} defaultValue={deal.title} className="field mt-1" />
            </div>
            <ChipGroup legend="Kind of work">
              {PROJECT_TYPES.map(([k, l]) => <ChipRadio key={k} name="type" value={k} label={l} defaultChecked={deal.type === k} />)}
            </ChipGroup>
            <div className="grid gap-5 sm:grid-cols-3">
              <div>
                <label htmlFor="amount" className="block font-semibold text-ink">Amount</label>
                <input id="amount" name="amount" inputMode="decimal" autoComplete="off" defaultValue={amountText} className="field mt-1" />
              </div>
              <div>
                <label htmlFor="probability" className="block font-semibold text-ink">Chance to win (%)</label>
                <input id="probability" name="probability" inputMode="numeric" autoComplete="off" defaultValue={deal.probability} className="field mt-1" />
              </div>
              <div>
                <label htmlFor="expectedCloseOn" className="block font-semibold text-ink">Expected close</label>
                <input id="expectedCloseOn" name="expectedCloseOn" type="date" defaultValue={deal.expected_close_on || ""} className="field mt-1" />
              </div>
            </div>
            <button type="submit" className="btn btn-primary">Save changes</button>
          </form>

          <form action={moveDealAction} className="card mt-6 max-w-2xl p-5">
            <input type="hidden" name="dealId" value={deal.id} />
            <ChipGroup legend="Stage" hint="Moving a deal resets the chance to win to the usual figure for that stage. Moving to Proposal marks the contact as Proposal sent.">
              {DEAL_STAGES.map(([k, l, p]) => <ChipRadio key={k} name="stage" value={k} label={`${l} (${p}%)`} defaultChecked={deal.stage === k} />)}
            </ChipGroup>
            <button type="submit" className="btn mt-4">Move deal</button>
          </form>

          <section aria-labelledby="close-h" className="card mt-6 max-w-2xl p-5">
            <h2 id="close-h" className="text-xl font-semibold">Close this deal</h2>
            <form action={winDealAction} className="mt-3">
              <input type="hidden" name="dealId" value={deal.id} />
              <p className="text-muted">Winning turns {deal.lead_name} into a client and creates a project for {formatCents(deal.amount_cents)}, ready for invoicing.</p>
              <button type="submit" className="btn btn-primary mt-3">Mark as won</button>
            </form>
            <form action={loseDealAction} className="mt-6 border-t border-line pt-4">
              <input type="hidden" name="dealId" value={deal.id} />
              <ChipGroup legend="Or it was lost. Why?">
                {LOST_REASONS.map(([k, l]) => <ChipRadio key={k} name="reason" value={k} label={l} />)}
              </ChipGroup>
              <button type="submit" className="btn mt-3">Mark as lost</button>
            </form>
          </section>
        </>
      ) : deal.stage === "won" ? (
        <section className="card mt-6 max-w-2xl p-5">
          <h2 className="text-xl font-semibold">Won</h2>
          <p className="mt-2 text-muted">This deal became a project.</p>
          <p className="mt-3"><Link href={`/clients`} className="btn">Open clients and projects</Link></p>
        </section>
      ) : (
        <form action={reopenDealAction} className="card mt-6 max-w-2xl p-5">
          <input type="hidden" name="dealId" value={deal.id} />
          <h2 className="text-xl font-semibold">Changed their mind?</h2>
          <p className="mt-2 text-muted">Reopening puts the deal back in Discovery.</p>
          <button type="submit" className="btn mt-3">Reopen this deal</button>
        </form>
      )}
    </div>
  );
}
