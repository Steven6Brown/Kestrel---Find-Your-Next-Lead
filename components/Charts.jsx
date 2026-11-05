import { useId } from "react";
import { compact, compactMoney, labelEvery, niceScale } from "@/lib/chartmath";
import { formatCents } from "@/lib/crm";
import { rateText } from "@/lib/insights";

// Charts are drawn as plain SVG and HTML, so nothing is loaded from outside. Colors come from the theme tokens,
// which means both light and dark follow. Every chart has a text table underneath for screen readers.

const W = 600;
const H = 240;
const M = { l: 52, r: 10, t: 10, b: 30 };

function DataTable({ caption, columns, rows }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-semibold text-ink underline underline-offset-4">View as a table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[320px] text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line">
            <tr>{columns.map((c) => <th key={c} scope="col" className="p-2 font-semibold">{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]} className="border-b border-line last:border-b-0">
                {r.map((cell, i) => (i === 0 ? <th key={i} scope="row" className="p-2 font-normal">{cell}</th> : <td key={i} className="p-2">{cell}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/**
 * Bars over time. `buckets` = [{ label, values: [a, b] }], `series` = [{ label, color }].
 * `money` means values are cents. A table of the same numbers sits underneath.
 */
export function BarChart({ buckets, series, title, summary, money = false, unit = "" }) {
  const uid = useId();
  const fmt = (v) => (money ? compactMoney(v) : compact(v));
  const full = (v) => (money ? formatCents(v) : String(v));
  const maxVal = Math.max(0, ...buckets.flatMap((b) => b.values));
  const { top } = niceScale(money ? maxVal / 100 : maxVal);
  const scaleTop = money ? top * 100 : top;
  const plotW = W - M.l - M.r;
  const plotH = H - M.t - M.b;
  const group = plotW / Math.max(1, buckets.length);
  const barW = Math.min(30, (group * 0.72) / series.length);
  const every = labelEvery(buckets.length, 10);
  const y = (v) => M.t + plotH - (scaleTop ? (v / scaleTop) * plotH : 0);
  const gridValues = [0, 1, 2, 3, 4].map((i) => (scaleTop / 4) * i);

  return (
    <figure className="mt-3">
      <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted" aria-label="Key">
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color }} />{s.label}</li>
        ))}
      </ul>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[520px]" role="img" aria-labelledby={`${uid}-t ${uid}-d`}>
          <title id={`${uid}-t`}>{title}</title>
          <desc id={`${uid}-d`}>{summary}</desc>
          {gridValues.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="var(--k-line)" strokeWidth="1" />
              <text x={M.l - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--k-muted)">{fmt(v)}</text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const x0 = M.l + group * i + (group - barW * series.length) / 2;
            return (
              <g key={b.label + i}>
                {b.values.map((v, k) => (
                  <rect key={k} x={x0 + barW * k} y={y(v)} width={barW - 2} height={Math.max(0, M.t + plotH - y(v))} rx="2" fill={series[k].color}>
                    <title>{`${b.label}: ${series[k].label} ${full(v)}`}</title>
                  </rect>
                ))}
                {(buckets.length - 1 - i) % every === 0 && (
                  <text x={M.l + group * i + group / 2} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--k-muted)">{b.label}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
      <DataTable
        caption={title}
        columns={[unit || "Period", ...series.map((s) => s.label)]}
        rows={buckets.map((b) => [b.label, ...b.values.map(full)])}
      />
    </figure>
  );
}

/** Contacts reaching each step. Bars are drawn against the first step; each row says how many moved on. */
export function FunnelBars({ steps }) {
  const top = Math.max(1, steps[0]?.count || 0);
  return (
    <div className="mt-3">
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.key} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[9rem_1fr_9rem]">
            <span className="font-semibold text-ink">{s.label}</span>
            <span className="block h-6 rounded bg-paper" aria-hidden="true">
              <span className="block h-6 rounded bg-brand" style={{ width: `${s.count ? Math.max(2, Math.round((s.count / top) * 100)) : 0}%` }} />
            </span>
            <span className="leading-tight">
              <span className="block font-semibold text-ink">{s.count.toLocaleString()}</span>
              {i > 0 ? (
                <span className="block text-xs text-muted">
                  {s.ofPrev && s.ofPrev.den ? (s.ofPrev.small ? `${s.ofPrev.num} of ${s.ofPrev.den}` : `${s.ofPrev.pct}% of ${steps[i - 1].label.toLowerCase()}`) : ""}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <DataTable
        caption="Contacts reaching each step"
        columns={["Step", "Contacts", "Of the step before", "Of all found"]}
        rows={steps.map((s) => [s.label, s.count, s.ofPrev ? rateText(s.ofPrev) : "", s.ofFound ? rateText(s.ofFound) : ""])}
      />
    </div>
  );
}
