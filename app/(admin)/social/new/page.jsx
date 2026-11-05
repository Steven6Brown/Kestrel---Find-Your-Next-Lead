import Link from "next/link";
import { requireUser, BRAND } from "@/lib/auth";
import * as ss from "@/lib/socialstore";
import { TEMPLATES, getTemplate } from "@/lib/social/templates";
import { PLATFORM_IDS, PLATFORMS } from "@/lib/social/platforms";
import PageHeader from "@/components/PageHeader";
import Flash from "@/components/Flash";
import { ChipCheckbox, ChipGroup, ChipRadio } from "@/components/Chips";
import { SocialTabs } from "@/components/SocialBits";
import { composeManualAction, composeTemplateAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "New post" };

function AppPicker({ apps, selected }) {
  return (
    <ChipGroup legend="Which app is this for?">
      {apps.map((a) => <ChipRadio key={a.id} name="app_id" value={a.id} label={a.name} defaultChecked={a.id === selected || (!selected && apps.length === 1)} />)}
    </ChipGroup>
  );
}

export default async function NewPost({ searchParams }) {
  await requireUser();
  const sp = await searchParams;
  const apps = await ss.listApps(BRAND);
  const selected = apps.find((a) => String(a.id) === sp.app)?.id || null;
  const t = getTemplate(sp.t);
  const q = selected ? `&app=${selected}` : "";
  return (
    <div className="reveal">
      <PageHeader title="New post" subtitle="Pick a format and fill in the blanks. Kestrel makes one draft per platform and a graphic for each. Nothing posts until you approve it." />
      <SocialTabs current="/social/new" appId={selected} />
      <Flash sp={sp} />
      {apps.length === 0 ? (
        <div className="card p-5"><p>Add an app first.</p><Link href="/social/apps" className="btn btn-primary mt-3">Add an app</Link></div>
      ) : (
        <>
          <section aria-labelledby="fmt-h" className="mb-6">
            <h2 id="fmt-h" className="text-xl font-semibold">1. Choose a format</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {TEMPLATES.map((x) => (
                <li key={x.id}><Link href={`/social/new?t=${x.id}${q}`} aria-current={t?.id === x.id ? "true" : undefined} className={`btn ${t?.id === x.id ? "btn-primary" : ""}`}>{x.label}</Link></li>
              ))}
              <li><Link href={`/social/new?t=manual${q}`} aria-current={sp.t === "manual" ? "true" : undefined} className={`btn ${sp.t === "manual" ? "btn-primary" : ""}`}>Write my own</Link></li>
              <li><Link href={`/social/import${selected ? `?app=${selected}` : ""}`} className="btn">Import from an AI chat</Link></li>
            </ul>
            {t && <p className="mt-2 text-muted">{t.hint}</p>}
          </section>

          {t && (
            <form action={composeTemplateAction} className="card grid max-w-2xl gap-5 p-5">
              <h2 className="text-xl font-semibold">2. Fill in the blanks</h2>
              <input type="hidden" name="template" value={t.id} />
              <AppPicker apps={apps} selected={selected} />
              {t.fields.map((f) => (
                <div key={f.key}>
                  <label htmlFor={`f_${f.key}`} className="block font-semibold text-ink">{f.label}{f.required ? "" : " (optional)"}</label>
                  {f.multiline ? <textarea id={`f_${f.key}`} name={`f_${f.key}`} rows={3} maxLength={f.max} required={f.required} className="field" /> : <input id={`f_${f.key}`} name={`f_${f.key}`} maxLength={f.max} required={f.required} className="field" />}
                  {f.hint && <p className="text-sm text-muted">{f.hint}</p>}
                </div>
              ))}
              <div><label htmlFor="link" className="block font-semibold text-ink">Link to track (optional)</label><input id="link" name="link" type="url" maxLength={500} className="field" placeholder="https://" /><p className="text-sm text-muted">Becomes a short link that counts clicks. It must be on the app&apos;s allowed link list.</p></div>
              <div><label htmlFor="goal" className="block font-semibold text-ink">Goal (optional)</label><input id="goal" name="goal" maxLength={200} className="field" /></div>
              <div><button className="btn btn-primary" type="submit">Make drafts</button></div>
            </form>
          )}

          {sp.t === "manual" && (
            <form action={composeManualAction} className="card grid max-w-2xl gap-5 p-5">
              <h2 className="text-xl font-semibold">2. Write it</h2>
              <AppPicker apps={apps} selected={selected} />
              <div><label htmlFor="topic" className="block font-semibold text-ink">Topic</label><input id="topic" name="topic" required maxLength={140} className="field" /></div>
              <div><label htmlFor="headline" className="block font-semibold text-ink">Words on the graphic</label><input id="headline" name="headline" maxLength={90} className="field" /></div>
              <div><label htmlFor="caption" className="block font-semibold text-ink">Text</label><textarea id="caption" name="caption" required rows={6} maxLength={5000} className="field" /><p className="text-sm text-muted">You can adjust it for each platform on the next page.</p></div>
              <div><label htmlFor="hashtags" className="block font-semibold text-ink">Hashtags</label><input id="hashtags" name="hashtags" maxLength={500} className="field" /></div>
              <div><label htmlFor="link" className="block font-semibold text-ink">Link to track (optional)</label><input id="link" name="link" type="url" maxLength={500} className="field" placeholder="https://" /></div>
              <ChipGroup legend="Which platforms?">{PLATFORM_IDS.map((p) => <ChipCheckbox key={p} name="platforms" value={p} label={PLATFORMS[p].name} defaultChecked />)}</ChipGroup>
              <div><button className="btn btn-primary" type="submit">Make drafts</button></div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
