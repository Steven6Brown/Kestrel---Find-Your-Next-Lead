import { requireUser, BRAND } from "@/lib/auth";
import Flash from "@/components/Flash";
import { CONNECTORS, describeConnector } from "@/lib/connectors";
import { paypalMode } from "@/lib/connectors/paypal";
import { listConnections } from "@/lib/store";
import { disconnectAction, saveBookingLinkAction, testConnectionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connections" };

const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never");
const PILL = {
  connected: ["Connected", "bg-ok-bg text-ok"],
  not_connected: ["Not connected", "bg-warn-bg text-warn"],
  error: ["Needs attention", "bg-bad-bg text-bad"],
  unavailable: ["Not available yet", "bg-line text-muted"],
};

export default async function Connections({ searchParams }) {
  await requireUser({ roles: ["owner", "admin"] });
  const sp = await searchParams;
  const rows = Object.fromEntries((await listConnections(BRAND)).map((r) => [r.provider, r]));

  return (
    <div className="reveal">
      <p className="eyebrow">Settings</p>
      <h1 className="mt-1 text-4xl font-semibold">Connections</h1>
      <p className="mt-2 max-w-2xl text-muted">
        The outside services Kestrel works with. Passwords, keys and secrets for PayPal and Resend stay in your <code className="text-ink">.env.local</code> file and are never shown or stored here.
      </p>
      <div className="mt-4"><Flash sp={sp} /></div>

      <ul className="mt-4 space-y-4">
        {CONNECTORS.map((c) => {
          const conn = rows[c.id] || null;
          const d = describeConnector(c, conn);
          const [label, cls] = PILL[d.state];
          return (
            <li key={c.id} className="card p-5">
              <section aria-labelledby={`c-${c.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id={`c-${c.id}`} className="text-2xl font-semibold">{c.name}</h2>
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
                </div>
                <p className="mt-1 text-muted">{c.description}</p>
                <p className="mt-2 break-all text-ink">{d.detail}</p>
                {c.id === "paypal" && c.configured(process.env) && (
                  <p className="mt-1 text-sm text-muted">Mode: <strong className="text-ink">{paypalMode(process.env)}</strong>{paypalMode(process.env) === "sandbox" ? " (test money only)" : ""}</p>
                )}
                {conn?.last_checked_at && <p className="mt-1 text-sm text-muted">Last checked {fmt(conn.last_checked_at)}</p>}

                {c.mode === "setting" && (
                  <form action={saveBookingLinkAction} className="mt-4 max-w-xl space-y-3">
                    <label htmlFor="booking-url" className="block font-semibold text-ink">Booking link</label>
                    <input id="booking-url" name="url" type="url" required maxLength={300} className="field" placeholder="https://calendar.app.google/..." defaultValue={d.state === "connected" ? d.detail : ""} />
                    <p className="text-sm text-muted">In Google Calendar choose Create, then Appointment schedule, then copy its booking page link.</p>
                    <button type="submit" className="btn btn-primary">Save link</button>
                  </form>
                )}
                {c.mode === "env" && (
                  <p className="mt-3 text-sm text-muted">Set in <code className="text-ink">.env.local</code>: {c.envVars.join(", ")}.</p>
                )}

                {c.mode !== "unavailable" && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <form action={testConnectionAction}>
                      <input type="hidden" name="provider" value={c.id} />
                      <button type="submit" className="btn">{c.mode === "setting" ? "Check link" : "Test connection"}</button>
                    </form>
                    {conn && conn.status !== "disconnected" && (
                      <form action={disconnectAction}>
                        <input type="hidden" name="provider" value={c.id} />
                        <button type="submit" className="btn">Disconnect</button>
                      </form>
                    )}
                  </div>
                )}
              </section>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
