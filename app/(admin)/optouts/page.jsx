import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import { addSuppressionAction } from "../actions";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { listSuppressions } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Opt-outs" };

export default async function OptOuts({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const rows = await listSuppressions(DEFAULT_BRAND_ID);
  return (
    <div className="reveal">
      <h1 className="text-4xl font-semibold">Opt-outs</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Addresses here are never emailed again. Unsubscribe link clicks are added automatically. If someone replies
        &quot;STOP&quot; or asks to be removed, add them here the same day. The legal limit is 10 days.
      </p>
      <div className="mt-4"><Flash sp={sp} /></div>
      <form action={addSuppressionAction} className="mb-8 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="email" className="block font-semibold">Add an address</label>
          <input id="email" name="email" type="email" required autoComplete="off" className="field mt-1 w-80 max-w-full" />
        </div>
        <button type="submit" className="btn btn-primary">Add opt-out</button>
      </form>
      {rows.length === 0 ? (
        <p className="text-muted">No opt-outs yet.</p>
      ) : (
        <table className="w-full text-left">
          <caption className="sr-only">Opted out addresses</caption>
          <thead className="border-b border-line"><tr>
            <th scope="col" className="p-3">Email</th><th scope="col" className="p-3">Reason</th><th scope="col" className="p-3">Date</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.email} className="border-b border-line">
                <th scope="row" className="p-3 font-semibold break-all">{r.email}</th>
                <td className="p-3">{r.reason}</td>
                <td className="p-3">{r.created_at.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
