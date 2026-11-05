import { BRAND, requireUser } from "@/lib/auth";
import { listAudit } from "@/lib/users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

const fmt = (iso) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "medium" });

export default async function Audit() {
  await requireUser({ roles: ["owner", "admin"] });
  const rows = await listAudit(BRAND, { limit: 200 });
  return (
    <div className="reveal">
      <p className="eyebrow">Administration</p>
      <h1 className="mt-1 text-4xl font-semibold">Audit log</h1>
      <p className="mt-2 max-w-2xl text-muted">Sign-ins, failures, lockouts, password changes, two-factor changes, and user management. The most recent 200 events.</p>
      <div className="card mt-6 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">Security audit log</caption>
          <thead className="border-b border-line">
            <tr>{["When", "Event", "Account", "Detail", "Address"].map((h) => <th key={h} scope="col" className="p-3 eyebrow !text-muted">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                <td className="p-3 whitespace-nowrap">{fmt(r.created_at)}</td>
                <td className="p-3 font-semibold text-ink">{r.event.replaceAll("_", " ")}</td>
                <td className="p-3 break-all">{r.user_email || "unknown"}</td>
                <td className="p-3">{r.detail}</td>
                <td className="p-3">{r.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
