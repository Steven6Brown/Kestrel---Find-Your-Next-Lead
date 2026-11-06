import Link from "next/link";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import PageHeader from "@/components/PageHeader";
import { ChipGroup, ChipRadio } from "@/components/Chips";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { dealContactChoices, getLead } from "@/lib/store";
import { DEAL_STAGES } from "@/lib/deals";
import { PROJECT_TYPES, stageLabel } from "@/lib/crm";
import { createDealAction } from "../../deals-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New deal" };

export default async function NewDeal({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const leadId = Number(sp.lead);
  const lead = Number.isInteger(leadId) && leadId > 0 ? await getLead(DEFAULT_BRAND_ID, leadId) : null;
  const choices = lead ? [] : await dealContactChoices(DEFAULT_BRAND_ID);

  return (
    <div className="reveal">
      <p><Link href={lead ? `/leads/${lead.id}` : "/deals"} className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back</Link></p>
      <PageHeader title="New deal" subtitle="Something you could be paid for. You can change every detail later." />
      <div className="mb-4"><Flash sp={sp} /></div>

      <form action={createDealAction} className="card max-w-2xl space-y-5 p-5">
        {lead ? (
          <>
            <input type="hidden" name="leadId" value={lead.id} />
            <p className="text-ink"><span className="font-semibold">Contact:</span> {lead.name}</p>
          </>
        ) : (
          <div>
            <label htmlFor="leadId" className="block font-semibold text-ink">Contact</label>
            <select id="leadId" name="leadId" required className="field mt-1" defaultValue="">
              <option value="" disabled>Choose who this deal is with</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? `, ${c.city}` : ""} ({stageLabel(c.stage)})</option>)}
            </select>
            <p className="mt-1 text-sm text-muted">Contacts that are in your pipeline. To start a deal with someone else, open their page and choose Add a deal.</p>
          </div>
        )}
        <div>
          <label htmlFor="title" className="block font-semibold text-ink">What is the deal for?</label>
          <input id="title" name="title" required maxLength={120} defaultValue={lead ? `Website for ${lead.name}` : ""} className="field mt-1" />
        </div>
        <ChipGroup legend="Kind of work">
          {PROJECT_TYPES.map(([k, l]) => <ChipRadio key={k} name="type" value={k} label={l} defaultChecked={k === "website"} />)}
        </ChipGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="amount" className="block font-semibold text-ink">Amount (US dollars)</label>
            <input id="amount" name="amount" inputMode="decimal" autoComplete="off" placeholder="2500" className="field mt-1" aria-describedby="amount-h" />
            <p id="amount-h" className="mt-1 text-sm text-muted">Optional. Leave blank if you have not priced it yet.</p>
          </div>
          <div>
            <label htmlFor="expectedCloseOn" className="block font-semibold text-ink">Expected close date</label>
            <input id="expectedCloseOn" name="expectedCloseOn" type="date" className="field mt-1" aria-describedby="date-h" />
            <p id="date-h" className="mt-1 text-sm text-muted">Optional, but a deal without one cannot appear on the forecast.</p>
          </div>
        </div>
        <ChipGroup legend="Stage" hint="Discovery means you are still learning what they need.">
          {DEAL_STAGES.map(([k, l, p]) => <ChipRadio key={k} name="stage" value={k} label={`${l} (${p}%)`} defaultChecked={k === "discovery"} />)}
        </ChipGroup>
        <div className="max-w-xs">
          <label htmlFor="probability" className="block font-semibold text-ink">Chance to win (percent)</label>
          <input id="probability" name="probability" inputMode="numeric" autoComplete="off" placeholder="Usual for the stage" className="field mt-1" aria-describedby="prob-h" />
          <p id="prob-h" className="mt-1 text-sm text-muted">Optional. Blank uses the percentage next to the stage.</p>
        </div>
        <button type="submit" className="btn btn-primary">Add deal</button>
      </form>
    </div>
  );
}
