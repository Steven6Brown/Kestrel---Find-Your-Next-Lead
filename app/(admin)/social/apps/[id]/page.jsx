import { notFound } from "next/navigation";
import { requireUser, BRAND } from "@/lib/auth";
import * as ss from "@/lib/socialstore";
import { PLATFORMS, PLATFORM_IDS } from "@/lib/social/platforms";
import PageHeader from "@/components/PageHeader";
import Flash from "@/components/Flash";
import { SocialTabs, fmtWhen } from "@/components/SocialBits";
import AppForm from "../AppForm";
import { checkAccountAction, disconnectAccountAction, saveAccountAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "App accounts" };

const HELP = {
  facebook: { id: "Facebook Page ID", token: "Page access token", note: "Posts go to your Facebook Page, never a personal profile." },
  instagram: { id: "Instagram professional account ID", token: "Access token", note: "Automatic posting needs a Business or Creator account linked to a Facebook Page (a free Page is fine), a Meta developer app, and Kestrel hosted at a public https address. Until then, leave this empty: approve posts here, then post by hand using the Download graphic and Mark as posted buttons." },
  linkedin: { id: "LinkedIn member ID", token: "Access token", note: "Posts go to your personal profile. Company pages need LinkedIn&apos;s approval and are not supported yet." },
};
const PILL = { connected: ["Connected", "bg-ok-bg text-ok"], error: ["Needs attention", "bg-bad-bg text-bad"], disconnected: ["Not connected", "bg-warn-bg text-warn"] };

export default async function AppPage({ params, searchParams }) {
  const user = await requireUser();
  const manager = user.role === "owner" || user.role === "admin";
  const { id } = await params;
  const sp = await searchParams;
  const app = /^\d+$/.test(id) ? await ss.getApp(BRAND, Number(id)) : null;
  if (!app) notFound();
  const accounts = Object.fromEntries((await ss.listAccounts(BRAND, app.id)).map((a) => [a.platform, a]));
  return (
    <div className="reveal">
      <PageHeader title={app.name} subtitle="Brand kit and connected accounts for this app." />
      <SocialTabs current="/social/apps" />
      <Flash sp={sp} />

      <h2 className="mb-3 text-2xl font-semibold">Accounts</h2>
      <p className="mb-4 max-w-2xl text-muted">Tokens are encrypted before they are saved and are never shown again. Create the developer app on each platform yourself, then paste the id and token here. A token that was ever shown to anyone else should be replaced.</p>
      <ul className="space-y-4">
        {PLATFORM_IDS.map((p) => {
          const acc = accounts[p];
          const spec = PLATFORMS[p];
          if (!spec.direct) {
            return (
              <li key={p} className="card p-5">
                <h3 className="text-xl font-semibold">{spec.name}</h3>
                <p className="mt-1 text-muted">Kestrel writes the caption, hashtags and a short script. You upload your own video in the TikTok app, then press Mark as posted. Direct posting needs TikTok&apos;s approval and may be added later.</p>
              </li>
            );
          }
          const [label, cls] = PILL[acc?.status || "disconnected"];
          return (
            <li key={p} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xl font-semibold">{spec.name}</h3>
                <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
              </div>
              <p className="mt-1 text-muted">{HELP[p].note}</p>
              {acc?.last_error && <p className="mt-2 text-bad">{acc.last_error}</p>}
              {acc?.last_checked_at && <p className="mt-1 text-sm text-muted">Last checked {fmtWhen(acc.last_checked_at)}</p>}
              {manager && (
                <>
                  <form action={saveAccountAction} className="mt-4 grid max-w-xl gap-3">
                    <input type="hidden" name="app_id" value={app.id} /><input type="hidden" name="platform" value={p} />
                    <div><label htmlFor={`l-${p}`} className="block font-semibold text-ink">Name for your reference</label><input id={`l-${p}`} name="label" maxLength={80} className="field" defaultValue={acc?.label || ""} /></div>
                    <div><label htmlFor={`i-${p}`} className="block font-semibold text-ink">{HELP[p].id}</label><input id={`i-${p}`} name="external_id" required maxLength={80} className="field" defaultValue={acc?.external_id || ""} autoComplete="off" /></div>
                    <div><label htmlFor={`t-${p}`} className="block font-semibold text-ink">{HELP[p].token}</label><input id={`t-${p}`} name="token" type="password" maxLength={4000} className="field" autoComplete="off" placeholder={acc?.has_secret ? "Saved. Leave blank to keep it." : ""} /></div>
                    <div><label htmlFor={`c-${p}`} className="block font-semibold text-ink">Most posts per day</label><input id={`c-${p}`} name="daily_cap" type="number" min={1} max={10} className="field" defaultValue={acc?.daily_cap || 1} /><p className="text-sm text-muted">A modest pace keeps the account in good standing.</p></div>
                    <div><button className="btn btn-primary" type="submit">Save</button></div>
                  </form>
                  {acc && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <form action={checkAccountAction}><input type="hidden" name="app_id" value={app.id} /><input type="hidden" name="platform" value={p} /><button className="btn" type="submit">Test</button></form>
                      <form action={disconnectAccountAction}><input type="hidden" name="app_id" value={app.id} /><input type="hidden" name="platform" value={p} /><button className="btn" type="submit">Disconnect and erase token</button></form>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>

      <h2 className="mb-3 mt-10 text-2xl font-semibold">Brand kit</h2>
      {manager ? <div className="card p-5"><AppForm app={app} /></div> : <p className="text-muted">Only owners and admins can change the brand kit.</p>}
    </div>
  );
}
