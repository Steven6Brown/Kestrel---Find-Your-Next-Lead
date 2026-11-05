import { saveAppAction } from "../actions";

const L = "block font-semibold text-ink";
const H = "text-sm text-muted";

/** The brand kit form for one app. Used for both new and existing apps. */
export default function AppForm({ app = null }) {
  const v = (k, d = "") => app?.[k] ?? d;
  return (
    <form action={saveAppAction} className="grid max-w-2xl gap-4">
      {app && <input type="hidden" name="id" value={app.id} />}
      <div><label htmlFor="name" className={L}>App name</label><input id="name" name="name" required maxLength={60} className="field" defaultValue={v("name")} /></div>
      <div><label htmlFor="tagline" className={L}>One line description</label><input id="tagline" name="tagline" maxLength={140} className="field" defaultValue={v("tagline")} /><p className={H}>Only true statements. This is shown on graphics.</p></div>
      <div><label htmlFor="website" className={L}>App website</label><input id="website" name="website" type="url" maxLength={300} className="field" placeholder="https://" defaultValue={v("website")} /></div>
      <div><label htmlFor="store_url" className={L}>App Store or Google Play link</label><input id="store_url" name="store_url" type="url" maxLength={300} className="field" placeholder="https://apps.apple.com/..." defaultValue={v("store_url")} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="primary_color" className={L}>Main color</label><input id="primary_color" name="primary_color" maxLength={7} pattern="#[0-9a-fA-F]{6}" className="field" defaultValue={v("primary_color", "#C08A2E")} /><p className={H}>Like #C08A2E. Flat colors only.</p></div>
        <div><label htmlFor="dark_color" className={L}>Background color</label><input id="dark_color" name="dark_color" maxLength={7} pattern="#[0-9a-fA-F]{6}" className="field" defaultValue={v("dark_color", "#0B0E13")} /><p className={H}>A dark color. White text sits on it.</p></div>
      </div>
      <div><label htmlFor="tone" className={L}>Tone notes</label><textarea id="tone" name="tone" maxLength={400} rows={2} className="field" defaultValue={v("tone")} /><p className={H}>For you and for any chat you use to write drafts.</p></div>
      <div><label htmlFor="never_say" className={L}>Never say list</label><textarea id="never_say" name="never_say" maxLength={800} rows={3} className="field" defaultValue={v("never_say")} /><p className={H}>One word or phrase per line. A post containing one cannot be approved.</p></div>
      <div><label htmlFor="ctas" className={L}>Standard calls to action</label><textarea id="ctas" name="ctas" maxLength={600} rows={2} className="field" defaultValue={v("ctas")} /><p className={H}>One per line, for example: Get the app.</p></div>
      <div><label htmlFor="hashtags" className={L}>Standard hashtags</label><input id="hashtags" name="hashtags" maxLength={600} className="field" defaultValue={v("hashtags")} /></div>
      <div><label htmlFor="link_hosts" className={L}>Other allowed link websites</label><input id="link_hosts" name="link_hosts" maxLength={400} className="field" defaultValue={v("link_hosts")} /><p className={H}>Tracked links may only point to this app&apos;s website, its store link, aquiladigital.net, the app stores, and websites listed here.</p></div>
      <div><button type="submit" className="btn btn-primary">{app ? "Save changes" : "Add app"}</button></div>
    </form>
  );
}
