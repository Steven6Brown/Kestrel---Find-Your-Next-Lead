import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND, requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import PageHeader from "@/components/PageHeader";
import StatTiles from "@/components/StatTiles";
import { getImportBatch, importComparisonLeads } from "@/lib/store";
import { analyzeCsv } from "@/lib/csvimport";
import { sourceLabel } from "@/lib/crm";
import { cancelImportAction, importBatchAction } from "../../../import-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Check import" };

const SHOWN = 100;
const WORDS = { new: "Will be added", duplicate: "Skipped, already exists", invalid: "Left out, has a problem" };

export default async function ImportPreview({ params, searchParams }) {
  await requireUser();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const batchId = Number(id);
  const batch = Number.isInteger(batchId) && batchId > 0 ? await getImportBatch(BRAND, batchId) : null;
  if (!batch) notFound();
  const r = analyzeCsv(batch.csv, await importComparisonLeads(BRAND));
  if (!r.ok) {
    return (
      <div className="reveal">
        <PageHeader title="This file cannot be imported" subtitle={r.error} />
        <Link href="/leads/import" className="btn">Choose another file</Link>
      </div>
    );
  }
  const tiles = [
    { label: "Will be added", value: r.counts.new, sub: "New contacts", href: `/leads/import/${batch.id}`, icon: "list" },
    { label: "Already exist", value: r.counts.duplicate, sub: "Skipped", href: `/leads/import/${batch.id}`, icon: "columns" },
    { label: "Have a problem", value: r.counts.invalid, sub: "Left out, listed below", href: `/leads/import/${batch.id}`, icon: "alert" },
    { label: "Rows in the file", value: r.counts.total, sub: sourceLabel(batch.source), href: `/leads/import/${batch.id}`, icon: "target" },
  ];
  const interesting = [...r.rows.filter((x) => x.status !== "new"), ...r.rows.filter((x) => x.status === "new")].slice(0, SHOWN);

  return (
    <div className="reveal">
      <p><Link href="/leads/import" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back</Link></p>
      <PageHeader title="Check before importing" subtitle="Nothing has been added yet. Look this over, then import or cancel." />
      <div className="mb-4"><Flash sp={sp} /></div>
      <StatTiles tiles={tiles} label="Import summary" />

      <div className="mt-6 flex flex-wrap gap-3">
        <form action={importBatchAction}>
          <input type="hidden" name="batchId" value={batch.id} />
          <button type="submit" className="btn btn-primary" disabled={r.counts.new === 0}>Import {r.counts.new} contact{r.counts.new === 1 ? "" : "s"}</button>
        </form>
        <form action={cancelImportAction}>
          <input type="hidden" name="batchId" value={batch.id} />
          <button type="submit" className="btn">Cancel</button>
        </form>
      </div>
      {r.counts.new === 0 && <p className="mt-3 text-muted">There is nothing new to add from this file.</p>}
      {batch.tag_all && <p className="mt-3 text-sm text-muted">Everyone imported will get the tag(s): {batch.tag_all.split(",").join(", ")}.</p>}

      <section aria-labelledby="rows-h" className="mt-6">
        <h2 id="rows-h" className="text-xl font-semibold">Rows {r.rows.length > SHOWN ? `(the first ${SHOWN}, problems first)` : ""}</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <caption className="sr-only">Rows of the file and what will happen to each</caption>
            <thead className="border-b border-line">
              <tr>{["Line", "Name", "City", "Email", "What happens"].map((h) => <th key={h} scope="col" className="p-3 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {interesting.map((x) => (
                <tr key={x.line} className="border-b border-line align-top last:border-b-0">
                  <td className="p-3">{x.line}</td>
                  <th scope="row" className="p-3 font-normal text-ink">{x.name || "(no name)"}</th>
                  <td className="p-3">{x.city}</td>
                  <td className="p-3 break-all">{x.email}</td>
                  <td className="p-3">
                    <span className={x.status === "new" ? "text-ok" : x.status === "invalid" ? "text-bad" : "text-warn"}>{WORDS[x.status]}</span>
                    {x.reason ? <span className="block text-sm text-muted">{x.reason}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
