import Link from "next/link";
import { requireUser, BRAND } from "@/lib/auth";
import * as ss from "@/lib/socialstore";
import { PLATFORM_IDS, PLATFORMS } from "@/lib/social/platforms";
import { capMicros, modelName, monthKey } from "@/lib/social/ai";
import PageHeader from "@/components/PageHeader";
import Flash from "@/components/Flash";
import { ChipCheckbox, ChipGroup, ChipRadio } from "@/components/Chips";
import { SocialTabs } from "@/components/SocialBits";
import { writeWithAiAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI writing" };

const usd = (micros) => `$${(micros / 1e6).toFixed(2)}`;

export default async function Write({ searchParams }) {
  const user = await requireUser();
  const manager = user.role === "owner" || user.role === "admin";
  const sp = await searchParams;
  const apps = await ss.listApps(BRAND);
  const selected = apps.find((a) => String(a.id) === sp.app)?.id || null;
  const usage = await ss.getAiUsage(BRAND, monthKey());
  const cap = capMicros();
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  return (
    <div className="reveal">
      <PageHeader title="AI writing" subtitle="Tell the AI what to promote and the real facts. It writes a draft for each platform. You read it and approve it before anything posts." />
      <SocialTabs current="/social/write" appId={selected} />
      <Flash sp={sp} />
      <section className="card mb-6 p-4" aria-labelledby="cost-h">
        <h2 id="cost-h" className="text-xl font-semibold">This month</h2>
        <p className="mt-1 text-ink">{usd(usage.cost)} spent of your {usd(cap)} limit, over {usage.calls} request{usage.calls === 1 ? "" : "s"}. Model: {modelName()}.</p>
        <p className="mt-1 text-sm text-muted">The spend shown is an estimate from published prices, not your Anthropic bill. When the limit is reached, Kestrel stops asking the AI until next month or until you raise SOCIAL_AI_MONTHLY_CAP_USD in .env.local. The AI is paid separately from an AI chat plan, through an Anthropic API account. Kestrel sends the AI only this app&apos;s brand kit and what you type below, never contacts or client details.</p>
      </section>
      {!hasKey ? (
        <div className="card p-5">
          <h2 className="text-xl font-semibold">One setup step first</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink">
            <li>Make an account at console.anthropic.com and add a small amount of credit. Set its own spending limit there too.</li>
            <li>Create an API key there and copy it once.</li>
            <li>Add the line <code>ANTHROPIC_API_KEY=</code> followed by the key to your <code>.env.local</code> file, then restart Kestrel.</li>
          </ol>
          <p className="mt-2 text-sm text-muted">Until then you can still use <Link href="/social/import" className="underline">Import drafts</Link>, which costs nothing.</p>
        </div>
      ) : !manager ? (
        <p className="card p-5 text-muted">Only owners and admins can spend on the AI.</p>
      ) : apps.length === 0 ? (
        <p className="card p-5">Add an app first.</p>
      ) : (
        <form action={writeWithAiAction} className="card grid max-w-2xl gap-5 p-5">
          <ChipGroup legend="Which app?">
            {apps.map((a) => <ChipRadio key={a.id} name="app_id" value={a.id} label={a.name} defaultChecked={a.id === selected || (!selected && apps.length === 1)} />)}
          </ChipGroup>
          <div><label htmlFor="idea" className="block font-semibold text-ink">What should the posts promote?</label>
            <textarea id="idea" name="idea" required minLength={5} maxLength={600} rows={3} className="field" />
            <p className="text-sm text-muted">For example: launch week, the new shot tracking feature, or a reminder to download the app.</p></div>
          <div><label htmlFor="facts" className="block font-semibold text-ink">Real facts the AI may use</label>
            <textarea id="facts" name="facts" maxLength={1500} rows={5} className="field" />
            <p className="text-sm text-muted">One per line: what the app really does, prices, where to get it. The AI is told to use nothing else, so anything missing here will not appear in the posts.</p></div>
          <fieldset><legend className="font-semibold text-ink">How many posts?</legend>
            <div className="mt-2 flex flex-wrap gap-2">{[1, 2, 3].map((n) => <ChipRadio key={n} name="count" value={n} label={`${n}`} defaultChecked={n === 2} />)}</div></fieldset>
          <ChipGroup legend="Which platforms?">{PLATFORM_IDS.map((p) => <ChipCheckbox key={p} name="platforms" value={p} label={PLATFORMS[p].name} defaultChecked />)}</ChipGroup>
          <div><button className="btn btn-primary" type="submit">Write drafts</button><p className="mt-2 text-sm text-muted">This takes up to a minute. Each request is an estimated few cents.</p></div>
        </form>
      )}
    </div>
  );
}
