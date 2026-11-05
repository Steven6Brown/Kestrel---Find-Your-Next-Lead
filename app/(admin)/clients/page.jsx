import Link from "next/link";
import { requireUser, BRAND } from "@/lib/auth";
import Flash from "@/components/Flash";
import { listClients } from "@/lib/store";
import { CLIENT_STATUSES, formatCents, labelOf } from "@/lib/crm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients" };

export default async function Clients({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const clients = await listClients(BRAND);
  return (
    <div className="reveal">
      <p className="eyebrow">Clients</p>
      <h1 className="mt-1 text-4xl font-semibold">Clients and projects</h1>
      <p className="mt-2 max-w-2xl text-muted">A contact becomes a client when you press Convert to client on their page. You can also add clients you already work with.</p>
      <div className="mt-4"><Flash sp={sp} /></div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/clients/new" className="btn btn-primary">Add a client</Link>
        <a href="/export/clients" className="btn" download>Download clients CSV</a>
        <a href="/export/projects" className="btn" download>Download projects CSV</a>
        <a href="/export/contacts" className="btn" download>Download contacts CSV</a>
      </div>
      {clients.length === 0 ? (
        <p className="card p-5 text-muted">No clients yet.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] text-left">
            <caption className="sr-only">Clients</caption>
            <thead className="border-b border-line">
              <tr>{["Client", "Status", "Projects", "Quoted total"].map((h) => <th key={h} scope="col" className="p-3 eyebrow !text-muted">{h}</th>)}</tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-b-0">
                  <th scope="row" className="p-3 font-semibold">
                    <Link href={`/clients/${c.id}`} className="inline-flex min-h-[44px] items-center text-ink underline underline-offset-4 hover:text-brand-hover">{c.name}</Link>
                  </th>
                  <td className="p-3">{labelOf(CLIENT_STATUSES, c.status)}</td>
                  <td className="p-3">{c.project_count}</td>
                  <td className="p-3">{formatCents(Number(c.quoted_total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
