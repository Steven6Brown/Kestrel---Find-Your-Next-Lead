import Link from "next/link";
import { isManager, requireUser, BRAND } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import StatTiles from "@/components/StatTiles";
import { BarChart, FunnelBars } from "@/components/Charts";
import { insightsRows } from "@/lib/store";
import { DRAFT_KINDS, RANGES, computeInsights, parseRange, rateText } from "@/lib/insights";
import { PROJECT_TYPES, formatCents, labelOf, sourceLabel, todayStr } from "@/lib/crm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights" };

function Section({ id, title, note, children }) {
  return (
    <section aria-labelledby={id} className="card mt-6 p-5">
      <h2 id={id} className="text-xl font-semibold">{title}</h2>
      {note ? <p className="mt-1 max-w-3xl text-sm text-muted">{note}</p> : null}
      {children}
    </section>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-paper p-3">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-semibold text-ink">{value}</p>
      {sub ? <p className="text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

/** One ranking table. Win rates always show the counts behind them. */
function WhereTable({ caption, first, rows, labelFor = (k) => k }) {
  if (!rows.length) return <p className="mt-3 text-muted">Nothing in this period yet.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[480px] text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-line">
          <tr>{[first, "Leads", "Contacted", "Replied", "Won", "Win rate"].map((h) => <th key={h} scope="col" className="p-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line last:border-b-0">
              <th scope="row" className="p-2 font-normal text-ink">{labelFor(r.key)}</th>
              <td className="p-2">{r.leads}</td>
              <td className="p-2">{r.contacted}</td>
              <td className="p-2">{r.replied}</td>
              <td className="p-2">{r.won}</td>
              <td className="p-2 text-sm">{rateText(r.winRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function Insights({ searchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const manager = isManager(user);
  const today = todayStr();
  const rows = await insightsRows(BRAND, { includeMoney: manager });
  const d = computeInsights(rows, { range, includeMoney: manager, todayStr: today });
  const rangeLabel = RANGES.find(([k]) => k === range)[1].toLowerCase();
  const { funnel, outreach, speed, where, money } = d;
  const sent = funnel[2];
  const replied = funnel[3];
  const won = funnel[6];

  const tiles = [
    { label: "Emails sent", value: outreach.totalSent, sub: rangeLabel, href: "/queue?status=sent", icon: "mail" },
    { label: "Replies", value: replied.count, sub: sent.count ? `of ${sent.count} contacted` : "Nobody contacted yet", href: "/pipeline", icon: "alert" },
    { label: "Won", value: won.count, sub: "Contacts first seen in this period", href: "/pipeline", icon: "target" },
    money
      ? { label: "Paid", value: formatCents(money.paidCents), sub: `${formatCents(money.billedCents)} billed`, href: "/invoices", icon: "money" }
      : { label: "Days to win", value: speed.medianDays === null ? "None yet" : speed.medianDays, sub: speed.wonCount ? `Median over ${speed.wonCount} won` : "Needs a first win", href: "/pipeline", icon: "calendar" },
  ];

  return (
    <div className="reveal">
      <PageHeader title="Insights" subtitle="How the business is doing, from what Kestrel has recorded. Every percentage shows the counts behind it." />

      <nav aria-label="Time period" className="mb-6 flex flex-wrap gap-2">
        {RANGES.map(([k, label]) => (
          <Link key={k} href={`/insights?range=${k}`} aria-current={k === range ? "page" : undefined} className={`btn ${k === range ? "btn-primary" : ""}`}>{label}</Link>
        ))}
      </nav>

      <StatTiles tiles={tiles} label="Headline numbers" />

      {money && (
        <Section id="money-h" title="Money" note={`Invoices made through Kestrel and PayPal, in US dollars, ${rangeLabel}. Cash or checks you have not entered are not included.`}>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Billed" value={formatCents(money.billedCents)} sub="Invoices sent" />
            <Stat label="Paid" value={formatCents(money.paidCents)} sub="Money received" />
            <Stat label="Still owed" value={formatCents(money.outstandingCents)} sub={`${money.outstandingCount} open invoice${money.outstandingCount === 1 ? "" : "s"}${money.overdueCount ? `, ${formatCents(money.overdueCents)} overdue` : ""}`} />
            <Stat label="Open proposals" value={formatCents(money.openProposalCents)} sub={`${money.openProposalCount} not yet accepted`} />
          </div>
          <BarChart
            buckets={money.buckets}
            series={[{ label: "Billed", color: "var(--k-muted)" }, { label: "Paid", color: "var(--k-brand)" }]}
            title={`Billed and paid per ${money.unit}`}
            summary={`Billed ${formatCents(money.billedCents)} and received ${formatCents(money.paidCents)}, ${rangeLabel}, per ${money.unit}.`}
            money
            unit={money.unit === "week" ? "Week of" : "Month"}
          />
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-base font-semibold">Money received by kind of work</h3>
              {money.revenueByType.length === 0 ? <p className="mt-2 text-muted">No payments in this period yet.</p> : (
                <ul className="mt-2 divide-y divide-line">
                  {money.revenueByType.map((r) => (
                    <li key={r.type} className="flex justify-between gap-3 py-2"><span>{labelOf(PROJECT_TYPES, r.type)}</span><span className="font-semibold text-ink">{formatCents(r.cents)}</span></li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="text-base font-semibold">Average project</h3>
              <p className="mt-2 text-2xl font-semibold text-ink">{money.avgProjectCents === null ? "None yet" : formatCents(money.avgProjectCents)}</p>
              <p className="text-sm text-muted">{money.projectCount ? `Quoted price, over ${money.projectCount} project${money.projectCount === 1 ? "" : "s"} started in this period.` : "Needs a project with a quoted price."}</p>
            </div>
          </div>
          {money.skippedOtherCurrency > 0 && <p className="mt-3 text-sm text-warn">{money.skippedOtherCurrency} record(s) in another currency are left out so dollars are never mixed with something else.</p>}
        </Section>
      )}

      <Section id="funnel-h" title="Where contacts get to" note={`Contacts first seen ${rangeLabel}, and how many reached each step. A contact counts at every step it passed, including ones later lost.`}>
        <FunnelBars steps={funnel} />
      </Section>

      <Section id="outreach-h" title="Outreach" note="Emails you sent, and how each kind of email did. A reply, meeting or win counts when you moved that contact to that stage.">
        {outreach.totalSent === 0 ? (
          <p className="mt-3 text-muted">No emails were sent {rangeLabel}. Drafts are created from Prospects and sent from Review drafts.</p>
        ) : (
          <BarChart
            buckets={outreach.buckets}
            series={[{ label: "Emails sent", color: "var(--k-brand)" }]}
            title={`Emails sent per ${outreach.unit}`}
            summary={`${outreach.totalSent} emails sent ${rangeLabel}, per ${outreach.unit}.`}
            unit={outreach.unit === "week" ? "Week of" : "Month"}
          />
        )}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left">
            <caption className="sr-only">Results by kind of email</caption>
            <thead className="border-b border-line">
              <tr>{["Kind of email", "Sent", "Replied", "Meeting", "Won"].map((h) => <th key={h} scope="col" className="p-2 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {outreach.byKind.map((k) => (
                <tr key={k.key} className="border-b border-line align-top last:border-b-0">
                  <th scope="row" className="p-2 font-normal text-ink">{DRAFT_KINDS.find(([key]) => key === k.key)[1]}</th>
                  <td className="p-2">{k.sent}</td>
                  <td className="p-2 text-sm">{rateText(k.replied)}</td>
                  <td className="p-2 text-sm">{rateText(k.meetings)}</td>
                  <td className="p-2 text-sm">{rateText(k.won)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="where-h" title="Where wins come from" note={`Contacts first seen ${rangeLabel}. Win rate is wins out of contacts you reached, so it only means something once there are about 20 of them.`}>
        <h3 className="mt-4 text-base font-semibold">By business type</h3>
        <WhereTable caption="Results by business type" first="Business type" rows={where.category} />
        <h3 className="mt-6 text-base font-semibold">By city</h3>
        <WhereTable caption="Results by city" first="City" rows={where.city} />
        <h3 className="mt-6 text-base font-semibold">By how they found you</h3>
        <WhereTable caption="Results by source" first="Source" rows={where.source} labelFor={sourceLabel} />
      </Section>

      <Section id="speed-h" title="Speed and follow through">
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Days from first contact to won" value={speed.medianDays === null ? "None yet" : speed.medianDays} sub={speed.wonCount ? `Median over ${speed.wonCount} won` : "Needs a first win"} />
          <Stat label="Overdue follow-ups" value={speed.overdueFollowups} sub="Right now, not just this period" />
          <Stat label="Meetings held" value={speed.meetingsHeld} sub={rangeLabel} />
        </div>
      </Section>

      <aside aria-labelledby="read-h" className="mt-6 text-sm text-muted">
        <h2 id="read-h" className="text-base font-semibold">How to read this page</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Kestrel cannot see your inbox, so replies, meetings and wins only count when you change a contact&apos;s stage.</li>
          <li>A percentage over fewer than 20 contacts is shown as a plain count, because small numbers swing wildly.</li>
          <li>Businesses marked closed are left out of every number.</li>
          <li>Emails sent before Kestrel recorded the kind of email are counted by the type of lead they went to.</li>
        </ul>
      </aside>
    </div>
  );
}
