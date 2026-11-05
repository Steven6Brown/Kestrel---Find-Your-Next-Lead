import { requireUser, BRAND } from "@/lib/auth";
import * as ss from "@/lib/socialstore";
import PageHeader from "@/components/PageHeader";
import Flash from "@/components/Flash";
import { ChipGroup, ChipRadio } from "@/components/Chips";
import { SocialTabs } from "@/components/SocialBits";
import { importAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import drafts" };

const EXAMPLE = `{
  "app": "App name",
  "topic": "Short topic",
  "goal": "What this post should achieve",
  "variants": [
    { "platform": "facebook", "caption": "Text", "hashtags": ["one", "two"],
      "image": { "headline": "Words on the graphic", "subline": "Optional", "cta": "Get the app" } },
    { "platform": "instagram", "caption": "Text", "hashtags": ["one", "two"], "image": { "headline": "Words on the graphic" } },
    { "platform": "linkedin", "caption": "Longer text", "hashtags": ["one"] },
    { "platform": "tiktok", "caption": "Short caption", "hashtags": ["one"], "script": "Hook, shots, end card" }
  ]
}`;

function promptFor(app) {
  const kit = app
    ? [`App: ${app.name}`, app.tagline && `What it is: ${app.tagline}`, app.website && `Website: ${app.website}`, app.tone && `Tone: ${app.tone}`, app.ctas && `Calls to action to choose from:\n${app.ctas}`, app.never_say && `Never use these words or phrases:\n${app.never_say}`, app.hashtags && `Standard hashtags: ${app.hashtags}`].filter(Boolean).join("\n")
    : "App: (paste the app name, a one line description, the tone, and any words to never use)";
  return `You are writing organic social media posts (not paid ads) for a mobile app.

${kit}

Write 3 post ideas. For each, give one variant each for facebook, instagram, linkedin and tiktok.
Rules:
- Use only facts I gave above. Do not invent statistics, user numbers, testimonials, awards, prices, certifications, guarantees or security claims.
- Facebook and Instagram: friendly and short. LinkedIn: a little longer and professional. TikTok: a short caption plus a "script" with a hook, 3 to 5 shots, and an end card.
- Instagram at most 30 hashtags, LinkedIn at most 5, others at most 10. Hashtags without the # sign.
- Keep each "headline" under 60 characters.
- Reply with JSON only, no other text: a list of objects shaped exactly like this example.

${EXAMPLE}`;
}

export default async function Import({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const apps = await ss.listApps(BRAND);
  const selected = apps.find((a) => String(a.id) === sp.app) || (apps.length === 1 ? apps[0] : null);
  return (
    <div className="reveal">
      <PageHeader title="Import drafts" subtitle="Use an AI assistant (covered by your plan, so Kestrel makes no paid calls), then paste its answer here. Imported posts arrive as drafts and go through the same approval as everything else." />
      <SocialTabs current="/social/import" appId={selected?.id} />
      <Flash sp={sp} />
      {apps.length === 0 ? <p className="card p-5">Add an app first.</p> : (
        <>
          <section className="card p-5" aria-labelledby="step1">
            <h2 id="step1" className="text-xl font-semibold">1. Copy this request into your AI assistant</h2>
            <ChipGroup legend="Write it for which app?">
              {apps.map((a) => <a key={a.id} href={`/social/import?app=${a.id}`} className={`btn ${selected?.id === a.id ? "btn-primary" : ""}`}>{a.name}</a>)}
            </ChipGroup>
            <label htmlFor="prompt" className="mt-4 block font-semibold text-ink">Request to copy</label>
            <textarea id="prompt" readOnly rows={14} className="field font-mono text-sm" defaultValue={promptFor(selected)} />
            <p className="mt-2 text-sm text-muted">Do not paste client names, contact details or private notes into a chat.</p>
          </section>
          <form action={importAction} className="card mt-6 grid max-w-3xl gap-4 p-5">
            <h2 className="text-xl font-semibold">2. Paste the answer</h2>
            <ChipGroup legend="Which app, if the answer does not name one?">
              {apps.map((a) => <ChipRadio key={a.id} name="app_id" value={a.id} label={a.name} defaultChecked={selected?.id === a.id} />)}
            </ChipGroup>
            <div><label htmlFor="json" className="block font-semibold text-ink">Pasted JSON</label><textarea id="json" name="json" required rows={12} maxLength={200000} className="field font-mono text-sm" /></div>
            <div><button type="submit" className="btn btn-primary">Import as drafts</button></div>
          </form>
        </>
      )}
    </div>
  );
}
