import Link from "next/link";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import { ChipRadio } from "@/components/Chips";
import { MANUAL_SOURCES } from "@/lib/crm";
import { createContactAction } from "../../crm-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a contact" };

export default async function NewContact({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  return (
    <div className="reveal">
      <p><Link href="/pipeline" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back to pipeline</Link></p>
      <p className="eyebrow mt-2">Contact</p>
      <h1 className="mt-1 text-4xl font-semibold">Add a contact</h1>
      <p className="mt-2 max-w-2xl text-muted">For referrals, seminar attendees, or anyone who did not come from a scan. Only the name is required.</p>
      <div className="mt-4"><Flash sp={sp} /></div>
      <form action={createContactAction} className="card mt-4 max-w-xl space-y-5 p-5">
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
        <fieldset>
          <legend className="font-semibold text-ink">How did they find you</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {MANUAL_SOURCES.map(([k, l], i) => <ChipRadio key={k} name="source" value={k} label={l} defaultChecked={i === 0} />)}
          </div>
        </fieldset>
        <div>
          <label htmlFor="notes" className="block font-semibold text-ink">Notes</label>
          <textarea id="notes" name="notes" rows={4} maxLength={4000} className="field mt-1" />
        </div>
        <button type="submit" className="btn btn-primary">Add contact</button>
      </form>
    </div>
  );
}
