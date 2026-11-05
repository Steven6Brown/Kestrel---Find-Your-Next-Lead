import { notFound } from "next/navigation";
import { requireUser, BRAND } from "@/lib/auth";
import * as ss from "@/lib/socialstore";
import { CHECKLIST, PLATFORMS, finalText } from "@/lib/social/platforms";
import { shortUrl } from "@/lib/social/links";
import { variantChecks } from "@/lib/social/service";
import PageHeader from "@/components/PageHeader";
import Flash from "@/components/Flash";
import { PLATFORM_SHORT, SocialTabs, StatusPill, fmtWhen } from "@/components/SocialBits";
import {
  approveAction, deletePostAction, inquiryAction, markPostedAction, postNowAction, regenImageAction, rejectAction,
  reopenAction, retryAction, saveVariantAction, scheduleAction, unscheduleAction, uploadImageAction,
} from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Post" };

const HID = ({ id }) => <input type="hidden" name="variant_id" value={id} />;
const LOCKED = ["published", "posted_manually", "publishing"];

export default async function PostPage({ params, searchParams }) {
  const user = await requireUser();
  const manager = user.role === "owner" || user.role === "admin";
  const { id } = await params;
  const sp = await searchParams;
  const post = /^\d+$/.test(id) ? await ss.getPost(BRAND, Number(id)) : null;
  if (!post) notFound();
  const app = await ss.getApp(BRAND, post.app_id);
  const accounts = Object.fromEntries((await ss.listAccounts(BRAND, app.id)).map((a) => [a.platform, a]));
  const statsById = {};
  for (const v of post.variants) if (v.link_target) statsById[v.id] = await ss.getShortLinkForVariant(BRAND, v.id);

  return (
    <div className="reveal">
      <PageHeader title={post.topic} subtitle={`${app.name}. Check exactly what will be posted on each platform.`} />
      <SocialTabs current="/social" appId={app.id} />
      <Flash sp={sp} />
      <div className="grid gap-6">
        {post.variants.map((v) => {
          const checks = variantChecks(app, v);
          const link = v.link_target ? shortUrl("xxxxxxxx") : "";
          const text = finalText({ caption: v.caption, hashtags: v.hashtags, link });
          const spec = PLATFORMS[v.platform];
          const stats = statsById[v.id] || null;
          const locked = LOCKED.includes(v.status);
          const acc = accounts[v.platform];
          return (
            <section key={v.id} className="card p-5" aria-labelledby={`v-${v.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`v-${v.id}`} className="text-2xl font-semibold">{PLATFORM_SHORT[v.platform]}</h2>
                <StatusPill status={v.status} />
              </div>
              {v.scheduled_at && v.status === "scheduled" && <p className="mt-1 text-muted">Goes out {fmtWhen(v.scheduled_at)}.</p>}
              {v.permalink && <p className="mt-1"><a className="text-ink underline" href={v.permalink} rel="noopener noreferrer" target="_blank">See it on {PLATFORM_SHORT[v.platform]}</a></p>}
              {v.error && <p role="alert" className="mt-2 text-bad">{v.error}</p>}
              {v.approved_at && <p className="mt-1 text-sm text-muted">Approved {fmtWhen(v.approved_at)}.</p>}
              {spec.direct && !acc?.has_secret && <p className="mt-2 text-warn">No {spec.name} account is connected for {app.name} yet, so this cannot post. <a className="underline" href={`/social/apps/${app.id}`}>Connect it</a>.</p>}

              <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
                <div>
                  <h3 className="font-semibold text-ink">Exactly what will be posted</h3>
                  <pre className="mt-1 whitespace-pre-wrap break-words border border-line bg-paper p-3 font-sans text-ink">{text || "(empty)"}</pre>
                  <p className="mt-1 text-sm text-muted">{checks.length} of {spec.maxChars} characters.{link ? " The link shown is a stand in; the real short link is made when it posts." : ""}</p>
                  {checks.problems.length > 0 && <ul className="mt-2 list-disc pl-5 text-bad" role="alert">{checks.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
                  {checks.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-warn">{checks.warnings.map((p) => <li key={p}>{p}</li>)}</ul>}
                  {v.platform === "tiktok" && v.script && (<><h3 className="mt-3 font-semibold text-ink">Script and shots</h3><pre className="mt-1 whitespace-pre-wrap break-words border border-line bg-paper p-3 font-sans text-ink">{v.script}</pre></>)}
                </div>
                <div>
                  {v.asset_id ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/social/media/${v.asset_id}`} alt={`Graphic for ${PLATFORM_SHORT[v.platform]}: ${v.image_headline || post.topic}`} className="w-full border border-line" />
                  ) : <p className="border border-line p-3 text-muted">No graphic yet.</p>}
                </div>
              </div>

              {!locked && (
                <details className="mt-4">
                  <summary className="cursor-pointer font-semibold text-ink">Edit text, link and graphic</summary>
                  <form action={saveVariantAction} className="mt-3 grid max-w-2xl gap-3">
                    <HID id={v.id} />
                    <div><label htmlFor={`cap-${v.id}`} className="block font-semibold text-ink">Text</label><textarea id={`cap-${v.id}`} name="caption" rows={6} maxLength={5000} required className="field" defaultValue={v.caption} /></div>
                    <div><label htmlFor={`ht-${v.id}`} className="block font-semibold text-ink">Hashtags</label><input id={`ht-${v.id}`} name="hashtags" maxLength={1500} className="field" defaultValue={v.hashtags} /></div>
                    {v.platform === "tiktok" && <div><label htmlFor={`sc-${v.id}`} className="block font-semibold text-ink">Script and shots</label><textarea id={`sc-${v.id}`} name="script" rows={4} maxLength={4000} className="field" defaultValue={v.script} /></div>}
                    {v.platform !== "tiktok" && <input type="hidden" name="script" value={v.script} />}
                    <div><label htmlFor={`lk-${v.id}`} className="block font-semibold text-ink">Link to track</label><input id={`lk-${v.id}`} name="link_target" type="url" maxLength={500} className="field" defaultValue={v.link_target} placeholder="https://" /></div>
                    <div><label htmlFor={`hl-${v.id}`} className="block font-semibold text-ink">Graphic headline</label><input id={`hl-${v.id}`} name="image_headline" maxLength={90} className="field" defaultValue={v.image_headline} /></div>
                    <div><label htmlFor={`sl-${v.id}`} className="block font-semibold text-ink">Graphic second line</label><input id={`sl-${v.id}`} name="image_subline" maxLength={160} className="field" defaultValue={v.image_subline} /></div>
                    <div><label htmlFor={`ct-${v.id}`} className="block font-semibold text-ink">Graphic button text</label><input id={`ct-${v.id}`} name="image_cta" maxLength={40} className="field" defaultValue={v.image_cta} /></div>
                    <div><button className="btn btn-primary" type="submit">Save</button></div>
                  </form>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <form action={regenImageAction}><HID id={v.id} /><button className="btn" type="submit">Rebuild graphic from these words</button></form>
                    <form action={uploadImageAction} className="flex flex-wrap items-end gap-2">
                      <HID id={v.id} />
                      <div><label htmlFor={`up-${v.id}`} className="block font-semibold text-ink">Use my own image</label><input id={`up-${v.id}`} name="image" type="file" accept="image/jpeg,image/png,image/webp" className="field" /></div>
                      <button className="btn" type="submit">Upload</button>
                    </form>
                  </div>
                  <p className="mt-1 text-sm text-muted">Editing or changing the graphic means it must be approved again.</p>
                </details>
              )}

              {manager && ["draft", "failed"].includes(v.status) && (
                <form action={approveAction} className="mt-4 max-w-xl border-t border-line pt-4">
                  <HID id={v.id} />
                  <fieldset><legend className="font-semibold text-ink">Before you approve</legend>
                    {CHECKLIST.map((c, i) => (
                      <label key={c} className="mt-2 flex items-center gap-2 text-ink"><input type="checkbox" name={`check_${"abc"[i]}`} className="h-5 w-5" /> {c}</label>
                    ))}
                  </fieldset>
                  <button className="btn btn-primary mt-3" type="submit" disabled={checks.problems.length > 0}>Approve this {PLATFORM_SHORT[v.platform]} post</button>
                  {checks.problems.length > 0 && <p className="mt-1 text-sm text-muted">Fix the problems above first.</p>}
                </form>
              )}

              {manager && ["approved", "scheduled"].includes(v.status) && (
                <div className="mt-4 border-t border-line pt-4">
                  {spec.direct && acc?.has_secret ? (
                    <div className="flex flex-wrap items-end gap-3">
                      <form action={scheduleAction} className="flex flex-wrap items-end gap-2">
                        <HID id={v.id} />
                        <div><label htmlFor={`wh-${v.id}`} className="block font-semibold text-ink">Post at</label><input id={`wh-${v.id}`} name="when" type="datetime-local" required className="field" defaultValue={v.scheduled_at ? new Date(new Date(v.scheduled_at).getTime() - new Date(v.scheduled_at).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} /></div>
                        <button className="btn btn-primary" type="submit">{v.status === "scheduled" ? "Change time" : "Schedule"}</button>
                      </form>
                      <form action={postNowAction}><HID id={v.id} /><button className="btn" type="submit">Post now</button></form>
                      {v.status === "scheduled" && <form action={unscheduleAction}><HID id={v.id} /><button className="btn" type="submit">Unschedule</button></form>}
                    </div>
                  ) : (
                    <form action={markPostedAction}><HID id={v.id} /><p className="mb-2 text-muted">{spec.direct ? `No ${spec.name} account is connected, so post it by hand: copy the text above, download the graphic, post it in the app, then press Mark as posted.` : "Copy the text above, upload your video in TikTok, then:"}</p>
                      {v.asset_id && <a className="btn mb-2 mr-2" href={`/social/media/${v.asset_id}`} download={`${app.name}-${v.platform}.png`}>Download graphic</a>}
                      <button className="btn btn-primary" type="submit">Mark as posted</button></form>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {manager && v.status === "failed" && <form action={retryAction}><HID id={v.id} /><button className="btn" type="submit">Retry</button></form>}
                {manager && ["draft", "approved", "scheduled", "failed"].includes(v.status) && <form action={rejectAction}><HID id={v.id} /><button className="btn" type="submit">Reject</button></form>}
                {manager && v.status === "rejected" && <form action={reopenAction}><HID id={v.id} /><button className="btn" type="submit">Move back to draft</button></form>}
              </div>

              {stats && (
                <p className="mt-3 text-sm text-muted">Tracked link: {stats.clicks} click{stats.clicks === 1 ? "" : "s"}, {stats.inquiries} inquir{stats.inquiries === 1 ? "y" : "ies"} counted.{" "}
                  <span className="inline-block"><form action={inquiryAction} className="inline"><HID id={v.id} /><button className="underline" type="submit">Count an inquiry from this post</button></form></span></p>
              )}
            </section>
          );
        })}
      </div>
      {manager && (
        <form action={deletePostAction} className="mt-6"><input type="hidden" name="post_id" value={post.id} /><button className="btn" type="submit">Delete this post</button></form>
      )}
    </div>
  );
}
