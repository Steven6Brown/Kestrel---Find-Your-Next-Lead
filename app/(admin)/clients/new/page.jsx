import Link from "next/link";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import { createClientAction } from "../../clients-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a client" };

export default async function NewClient({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  return (
    <div className="reveal">
      <p><Link href="/clients" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back to clients</Link></p>
      <p className="eyebrow mt-2">Clients</p>
      <h1 className="mt-1 text-4xl font-semibold">Add a client</h1>
      <p className="mt-2 max-w-2xl text-muted">For clients who did not come through a scan. Only the name is required.</p>
      <div className="mt-4"><Flash sp={sp} /></div>
      <form action={createClientAction} className="card mt-4 max-w-xl space-y-5 p-5">
        <div>
          <label htmlFor="name" className="block font-semibold text-ink">Name or business</label>
          <input id="name" name="name" required maxLength={120} className="field mt-1" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="email" className="block font-semibold text-ink">Email</label>
          <input id="email" name="email" type="email" maxLength={200} className="field mt-1" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="phone" className="block font-semibold text-ink">Phone</label>
          <input id="phone" name="phone" type="tel" maxLength={40} className="field mt-1" autoComplete="off" />
        </div>
        <div>
          <label htmlFor="notes" className="block font-semibold text-ink">Notes</label>
          <textarea id="notes" name="notes" rows={4} maxLength={4000} className="field mt-1" />
        </div>
        <button type="submit" className="btn btn-primary">Add client</button>
      </form>
    </div>
  );
}
