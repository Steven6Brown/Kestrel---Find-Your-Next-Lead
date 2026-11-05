import Link from "next/link";
import { requireUser } from "@/lib/auth";
import Flash from "@/components/Flash";
import PageHeader from "@/components/PageHeader";
import { BACKUP_NAME, DEFAULT_KEEP, STALE_DAYS, backupDir, backupStatus, listBackups } from "@/lib/backup";
import { createBackupAction, verifyBackupAction } from "../../backup-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backups" };

const when = (iso) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export default async function Backups({ searchParams }) {
  await requireUser({ roles: ["owner", "admin"] });
  const sp = await searchParams;
  const dir = backupDir();
  const list = listBackups(dir);
  const st = backupStatus(dir);
  const encrypted = !!process.env.BACKUP_PASSPHRASE;
  const ageText = st.ageDays === null ? "" : st.ageDays < 1 ? "today" : `${Math.floor(st.ageDays)} day${Math.floor(st.ageDays) === 1 ? "" : "s"} ago`;

  return (
    <div className="reveal">
      <p><Link href="/settings" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back to settings</Link></p>
      <PageHeader
        title="Backups"
        subtitle="A full copy of everything in Kestrel in one file: leads, notes, emails, clients, and invoices. If this computer fails, a backup is how you get it all back."
        actions={<form action={createBackupAction}><button type="submit" className="btn btn-primary">Back up now</button></form>}
      />
      <div className="mb-4"><Flash sp={sp} /></div>

      <section aria-labelledby="status-h" className={`card p-5 ${st.stale ? "!border-warn" : ""}`}>
        <h2 id="status-h" className="text-xl font-semibold">{st.count === 0 ? "No backups yet" : st.stale ? "Your last backup is getting old" : "Backups are up to date"}</h2>
        <p className="mt-2 text-ink">
          {st.count === 0
            ? "Nothing has been backed up. Press Back up now to save your first one."
            : `Last backup: ${when(st.newest)} (${ageText}). ${st.stale ? `That is more than ${STALE_DAYS} days ago.` : ""}`}
        </p>
        <p className="mt-2 text-sm text-muted">Saved in <span className="break-all font-mono">{dir}</span>. Kestrel keeps the newest {DEFAULT_KEEP} and removes older ones.</p>
        <p className={`mt-2 text-sm ${encrypted ? "text-ok" : "text-warn"}`}>
          {encrypted
            ? "Backups are encrypted with your BACKUP_PASSPHRASE. Keep that passphrase safe: without it a backup cannot be opened."
            : "Backups are not encrypted. Anyone who gets a copy can read your leads, notes, and password hashes. Set BACKUP_PASSPHRASE in .env.local and restart before you copy backups to another place."}
        </p>
      </section>

      <section aria-labelledby="list-h" className="mt-6">
        <h2 id="list-h" className="text-xl font-semibold">Saved backups</h2>
        {list.length === 0 ? <p className="mt-2 text-muted">None yet.</p> : (
          <div className="card mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <caption className="sr-only">Saved backups, newest first</caption>
              <thead className="border-b border-line">
                <tr>{["Made", "Size", "Encrypted", "File", ""].map((h, i) => <th key={i} scope="col" className="p-3 font-semibold">{h || <span className="sr-only">Actions</span>}</th>)}</tr>
              </thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.name} className="border-b border-line align-middle last:border-b-0">
                    <th scope="row" className="p-3 font-normal text-ink">{when(b.modified)}</th>
                    <td className="p-3">{size(b.bytes)}</td>
                    <td className="p-3">{b.encrypted ? "Yes" : "No"}</td>
                    <td className="p-3 break-all font-mono text-xs">{b.name}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <a className="btn" href={`/settings/backups/download?name=${encodeURIComponent(b.name)}`} download aria-label={`Download backup from ${when(b.modified)}`}>Download</a>
                        {BACKUP_NAME.test(b.name) && (
                          <form action={verifyBackupAction}>
                            <input type="hidden" name="name" value={b.name} />
                            <button type="submit" className="btn" aria-label={`Check backup from ${when(b.modified)}`}>Check</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-sm text-muted">Check opens a backup and confirms it is complete and unchanged. Do it now and then: a backup nobody has checked is only a hope.</p>
      </section>

      <section aria-labelledby="sched-h" className="card mt-6 p-5">
        <h2 id="sched-h" className="text-xl font-semibold">Back up every night</h2>
        <p className="mt-2 text-muted">Windows can do it for you. Make sure CRON_SECRET is set in .env.local, then run this once in PowerShell from the Kestrel folder. Kestrel must be running at that time.</p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-paper p-3 text-sm">.\scripts\register-backup-task.ps1 -Time 02:00</pre>
        <p className="mt-3 text-muted">Better still, point BACKUP_DIR (an absolute path in .env.local) at a folder on another drive or a synced folder, so a copy lives somewhere other than this computer. Use an encrypted backup (BACKUP_PASSPHRASE) if that place is online.</p>
      </section>

      <section aria-labelledby="restore-h" className="card mt-6 p-5">
        <h2 id="restore-h" className="text-xl font-semibold">Getting your data back</h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-muted">
          <li>Stop Kestrel.</li>
          <li>Restore the backup into a new, empty folder. This never touches your current data:
            <pre className="mt-2 overflow-x-auto rounded-lg border border-line bg-paper p-3 text-sm text-ink">node scripts/restore-backup.mjs &quot;C:\path\to\kestrel-backup-....kbk.gz&quot; &quot;C:\KestrelRestored&quot;</pre>
          </li>
          <li>Add <span className="font-mono">KESTREL_DATA_DIR=C:\KestrelRestored</span> to .env.local and start Kestrel. Check your leads and sign in, then keep the old folder until you are sure.</li>
        </ol>
        <p className="mt-3 text-sm text-muted">If you deleted a contact because they asked, remember that older backups still contain them until newer ones replace them. Backups never keep more than the newest {DEFAULT_KEEP}.</p>
      </section>
    </div>
  );
}
