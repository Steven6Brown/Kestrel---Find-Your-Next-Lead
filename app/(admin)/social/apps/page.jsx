import Link from "next/link";
import { requireUser, BRAND } from "@/lib/auth";
import * as ss from "@/lib/socialstore";
import PageHeader from "@/components/PageHeader";
import Flash from "@/components/Flash";
import { SocialTabs } from "@/components/SocialBits";
import AppForm from "./AppForm";
import { archiveAppAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apps and accounts" };

export default async function Apps({ searchParams }) {
  const user = await requireUser();
  const sp = await searchParams;
  const manager = user.role === "owner" || user.role === "admin";
  const apps = await ss.listApps(BRAND);
  const archived = await ss.listApps(BRAND, { archived: true });
  return (
    <div className="reveal">
      <PageHeader title="Apps and accounts" subtitle="One entry per app. Each has its own look, its own rules and its own Facebook, Instagram, LinkedIn and TikTok." />
      <SocialTabs current="/social/apps" />
      <Flash sp={sp} />
      <ul className="space-y-3">
        {apps.map((a) => (
          <li key={a.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="inline-block h-8 w-8 rounded border border-line" style={{ background: a.primary_color }} />
              <div><Link href={`/social/apps/${a.id}`} className="text-lg font-semibold text-ink underline">{a.name}</Link><p className="text-sm text-muted">{a.tagline || "No description yet."}</p></div>
            </div>
            {manager && (
              <form action={archiveAppAction}><input type="hidden" name="id" value={a.id} /><button className="btn" type="submit">Archive</button></form>
            )}
          </li>
        ))}
        {apps.length === 0 && <li className="card p-4 text-muted">No apps yet.</li>}
      </ul>
      {manager ? (
        <section className="card mt-6 p-5" aria-labelledby="add-h">
          <h2 id="add-h" className="mb-4 text-xl font-semibold">Add an app</h2>
          <AppForm />
        </section>
      ) : <p className="mt-4 text-muted">Only owners and admins can add apps.</p>}
      {archived.length > 0 && (
        <section className="mt-6" aria-labelledby="arch-h">
          <h2 id="arch-h" className="text-lg font-semibold">Archived</h2>
          <ul className="mt-2 space-y-2">{archived.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-muted">{a.name}
              {manager && <form action={archiveAppAction}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="restore" value="1" /><button className="btn" type="submit">Restore</button></form>}
            </li>))}</ul>
        </section>
      )}
    </div>
  );
}
