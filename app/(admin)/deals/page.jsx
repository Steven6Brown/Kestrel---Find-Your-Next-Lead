import Link from "next/link";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import PageHeader from "@/components/PageHeader";
import StatTiles from "@/components/StatTiles";
import { BarChart } from "@/components/Charts";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { dealsForForecast, listDeals } from "@/lib/store";
import { DEAL_STAGES, computeForecast, dealStageLabel, lostReasonLabel, nextDealStage } from "@/lib/deals";
import { rateText } from "@/lib/insights";
import { formatCents, todayStr } from "@/lib/crm";
import { moveDealAction } from "../deals-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deals" };

const closeText = (d, today) => (!d.expected_close_on ? "No close date" : d.expected_close_on < today ? `Overdue since ${d.expected_close_on}` : `Closes ${d.expected_close_on}`);

export default async function Deals({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const today = todayStr();
  const [forecastRows, open, all] = await Promise.all([
    dealsForForecast(DEFAULT_BRAND_ID),
    listDeals(DEFAULT_BRAND_ID, { status: "open" }),
    listDeals(DEFAULT_BRAND_ID, { status: "all", limit: 500 }),
  ]);
  const f = computeForecast(forecastRows, { today });
  const closed = all.filter((d) => d.stage === "won" || d.stage === "lost").slice(0, 15);
  const winText = f.winRate.pct === null || f.winRate.small ? "Too few to judge" : `${f.winRate.pct}%`;
  const tiles = [
    { label: "Open pipeline", value: formatCents(f.open.cents), sub: `${f.open.count} open deal${f.open.count === 1 ? "" : "s"}`, href: "/deals", icon: "money" },
    { label: "Forecast", value: formatCents(f.open.weightedCents), sub: "Amount times chance to win", href: "/deals", icon: "chart" },
    { label: "Won, last 90 days", value: f.won.count, sub: formatCents(f.won.cents), href: "/deals", icon: "target" },
    { label: "Win rate", value: winText, sub: rateText(f.winRate), href: "/deals", icon: "columns" },
  ];

  return (
    <div className="reveal">
      <PageHeader
        title="Deals"
        subtitle="The money side of every contact. A deal has an amount, a chance to win, and an expected close date. Winning one creates the client and the project."
        actions={<Link href="/deals/new" className="btn btn-primary">New deal</Link>}
      />
      <div className="mb-4"><Flash sp={sp} /></div>

      <StatTiles tiles={tiles} label="Deal numbers" />

      <section aria-labelledby="fc-h" className="card mt-6 p-5">
        <h2 id="fc-h" className="text-xl font-semibold">Expected money by month</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted">Grey is the full amount of the open deals. Gold is the forecast: each amount times its chance to win, so a $10,000 deal at 50% counts as $5,000.</p>
        {f.open.count === 0 ? <p className="mt-3 text-muted">No open deals yet.</p> : (
          <BarChart
            buckets={f.buckets}
            series={[{ label: "Open amount", color: "var(--k-muted)" }, { label: "Forecast", color: "var(--k-brand)" }]}
            title="Expected deal value by month"
            summary={`Open deals total ${formatCents(f.open.cents)}, with a forecast of ${formatCents(f.open.weightedCents)}, by expected close month.`}
            money
            unit="Expected close"
          />
        )}
        {(f.open.overdueCount > 0 || f.open.noDateCount > 0 || f.open.noAmountCount > 0) && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-warn">
            {f.open.overdueCount > 0 && <li>{f.open.overdueCount} deal(s) are past their expected close date. Update the date or close them.</li>}
            {f.open.noDateCount > 0 && <li>{f.open.noDateCount} deal(s) have no expected close date, so they are not on the chart.</li>}
            {f.open.noAmountCount > 0 && <li>{f.open.noAmountCount} deal(s) have no amount, so they add nothing to the totals.</li>}
          </ul>
        )}
      </section>

      <section aria-labelledby="board-h" className="mt-6">
        <h2 id="board-h" className="sr-only">Open deals by stage</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {DEAL_STAGES.map(([key, label]) => {
            const here = open.filter((d) => d.stage === key);
            const next = nextDealStage(key);
            return (
              <div key={key} className="card p-4">
                <h3 className="text-lg font-semibold">{label} <span className="text-sm font-normal text-muted">({here.length}, {formatCents(here.reduce((a, d) => a + (d.amount_cents || 0), 0))})</span></h3>
                {here.length === 0 ? <p className="mt-3 text-sm text-muted">Nothing here.</p> : (
                  <ul className="mt-3 space-y-3">
                    {here.map((d) => (
                      <li key={d.id} className="rounded-lg border border-line bg-paper p-3">
                        <Link href={`/deals/${d.id}`} className="font-semibold text-ink underline underline-offset-4 hover:text-brand-hover">{d.title}</Link>
                        <p className="text-sm text-muted">{d.lead_name}</p>
                        <p className="mt-1 text-sm text-ink">{formatCents(d.amount_cents)} <span className="text-muted">at {d.probability}%</span></p>
                        <p className={`text-sm ${d.expected_close_on && d.expected_close_on < today ? "text-bad" : "text-muted"}`}>{closeText(d, today)}</p>
                        {next && (
                          <form action={moveDealAction} className="mt-2">
                            <input type="hidden" name="dealId" value={d.id} />
                            <input type="hidden" name="stage" value={next} />
                            <input type="hidden" name="back" value="/deals" />
                            <button type="submit" className="btn">Move to {dealStageLabel(next)}</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="closed-h" className="mt-6">
        <h2 id="closed-h" className="text-xl font-semibold">Recently closed</h2>
        {closed.length === 0 ? <p className="mt-2 text-muted">No deals have been won or lost yet.</p> : (
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <caption className="sr-only">Recently won and lost deals</caption>
              <thead className="border-b border-line">
                <tr>{["Deal", "Contact", "Result", "Amount", "Closed"].map((h) => <th key={h} scope="col" className="p-3 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {closed.map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-b-0">
                    <th scope="row" className="p-3 font-normal"><Link href={`/deals/${d.id}`} className="text-ink underline underline-offset-4 hover:text-brand-hover">{d.title}</Link></th>
                    <td className="p-3">{d.lead_name}</td>
                    <td className="p-3">{d.stage === "won" ? "Won" : `Lost${d.lost_reason ? `: ${lostReasonLabel(d.lost_reason)}` : ""}`}</td>
                    <td className="p-3">{formatCents(d.amount_cents)}</td>
                    <td className="p-3">{(d.closed_at || "").slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
