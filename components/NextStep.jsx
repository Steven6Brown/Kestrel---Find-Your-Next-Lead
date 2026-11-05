import Link from "next/link";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { currentSession, isManager } from "@/lib/auth";
import { todayStr } from "@/lib/crm";
import { nextStepCounts, pickNext } from "@/lib/nextstep";
import Icon from "./Icon";

/** One line at the top of a page that says what to do next and takes you there. */
export default async function NextStep({ here = "" }) {
  const session = await currentSession();
  const step = pickNext(await nextStepCounts(DEFAULT_BRAND_ID, todayStr(), { checkBackup: !!session && isManager(session) }), here);
  return (
    <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-l-4 !border-l-brand px-4 py-3">
      <p className="flex items-center gap-3 text-ink">
        <span className="text-brand"><Icon name={step.icon} /></span>
        <span><span className="font-semibold">Next step:</span> {step.text}.</span>
      </p>
      <Link href={step.href} className="btn btn-primary">{step.cta}</Link>
    </div>
  );
}
