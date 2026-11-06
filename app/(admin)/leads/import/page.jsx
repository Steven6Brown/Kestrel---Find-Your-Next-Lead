import Link from "next/link";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import PageHeader from "@/components/PageHeader";
import { ChipGroup, ChipRadio } from "@/components/Chips";
import { MANUAL_SOURCES } from "@/lib/crm";
import { MAX_ROWS } from "@/lib/csvimport";
import { uploadImportAction } from "../../import-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import contacts" };

export default async function ImportContacts({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  return (
    <div className="reveal">
      <p><Link href="/leads" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back to prospects</Link></p>
      <PageHeader title="Import contacts" subtitle="Bring in a list from a spreadsheet. You will see exactly what will happen before anything is added." />
      <div className="mb-4"><Flash sp={sp} /></div>

      <form action={uploadImportAction} className="card max-w-2xl space-y-5 p-5">
        <div>
          <label htmlFor="file" className="block font-semibold text-ink">CSV file</label>
          <input id="file" name="file" type="file" accept=".csv,text/csv" required className="field mt-1" aria-describedby="file-h" />
          <p id="file-h" className="mt-1 text-sm text-muted">In Excel or Google Sheets, choose Save as, then CSV. Up to {MAX_ROWS.toLocaleString()} rows at a time.</p>
        </div>
        <ChipGroup legend="Where did these contacts come from?">
          {MANUAL_SOURCES.map(([k, l]) => <ChipRadio key={k} name="source" value={k} label={l} defaultChecked={k === "manual"} />)}
        </ChipGroup>
        <div>
          <label htmlFor="tagAll" className="block font-semibold text-ink">Tag everyone with (optional)</label>
          <input id="tagAll" name="tagAll" maxLength={100} autoComplete="off" placeholder="expo 2026" className="field mt-1 max-w-sm" />
        </div>
        <button type="submit" className="btn btn-primary">Check the file</button>
      </form>

      <section aria-labelledby="fmt-h" className="card mt-6 max-w-2xl p-5">
        <h2 id="fmt-h" className="text-xl font-semibold">What the file should look like</h2>
        <p className="mt-2 text-muted">The first row names the columns. Only <strong className="text-ink">Name</strong> is required. These are recognized, in any order and any capitals: Name (or Business, Company), Email, Phone, Website, City, State, Address, Category, Notes, and Tags (separated by commas).</p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-paper p-3 text-sm">{`Name,Email,Phone,Website,City,State,Tags
Sunny Bakery,hello@sunny.example,330-555-0142,sunnybakery.example,Akron,OH,"coffee, expo"`}</pre>
        <p className="mt-3 text-sm text-muted">A business you already have, or that appears twice in the file, is skipped rather than added again. Rows with a bad email address or website are left out and listed so you can fix them.</p>
      </section>
    </div>
  );
}
