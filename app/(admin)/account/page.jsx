import QRCode from "qrcode";
import Flash from "@/components/Flash";
import AuthForm from "@/components/AuthForm";
import { BRAND, requireUser } from "@/lib/auth";
import { getBrand } from "@/config/brands";
import { decrypt } from "@/lib/crypto";
import { otpauthUri } from "@/lib/totp";
import * as u from "@/lib/users";
import {
  changePasswordAction, mfaConfirmAction, mfaDisableAction, mfaStartAction, mfaCancelAction,
  regenRecoveryAction, revokeOthersAction, revokeSessionAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account and security" };

const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never");
const EVENTS = {
  login_ok: "Signed in", login_failed: "Failed sign in", logout: "Signed out", account_locked: "Account locked",
  login_blocked_locked: "Blocked while locked", password_changed: "Password changed", password_reset: "Password reset",
  reset_requested: "Reset requested", mfa_enabled: "Two-factor turned on", mfa_disabled: "Two-factor turned off",
  mfa_failed: "Failed second factor", session_revoked: "Session signed out", sessions_revoked_all: "Other sessions signed out",
  recovery_codes_regenerated: "Recovery codes replaced", owner_created: "Account created", invite_accepted: "Invitation accepted",
};

function Card({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="card mt-8 p-5">
      <h2 id={id} className="text-2xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function Account({ searchParams }) {
  const sp = await searchParams;
  const s = await requireUser({ allowUnenrolled: true });
  const full = await u.getUser(BRAND, s.id);
  const [sessions, events] = await Promise.all([u.listSessions(s.id), u.listAudit(BRAND, { userId: s.id, limit: 12 })]);
  let qr = null;
  let manualKey = "";
  if (full.mfa_pending_secret) {
    manualKey = decrypt(full.mfa_pending_secret);
    const uri = otpauthUri({ issuer: getBrand(BRAND).name, account: s.email, secret: manualKey });
    qr = await QRCode.toString(uri, { type: "svg", margin: 1, width: 192, color: { dark: "#000000", light: "#ffffff" } });
  }
  const remaining = JSON.parse(full.recovery_codes || "[]").length;
  const requireMfa = process.env.REQUIRE_MFA === "1";

  return (
    <div className="reveal">
      <p className="eyebrow">Account</p>
      <h1 className="mt-1 text-4xl font-semibold">Account and security</h1>
      <div className="mt-4"><Flash sp={sp} /></div>
      {sp.enroll === "1" || (requireMfa && !s.mfa_enabled) ? (
        <p role="alert" className="mb-4 border border-warn bg-warn-bg p-3 text-warn">Your administrator requires two-factor sign-in. Turn it on below to continue using the app.</p>
      ) : null}

      <dl className="card grid gap-4 p-5 sm:grid-cols-3">
        <div><dt className="eyebrow !text-muted">Name</dt><dd className="mt-1">{s.name}</dd></div>
        <div><dt className="eyebrow !text-muted">Email</dt><dd className="mt-1 break-all">{s.email}</dd></div>
        <div><dt className="eyebrow !text-muted">Role</dt><dd className="mt-1 capitalize">{s.role}</dd></div>
      </dl>

      <Card id="pw-h" title="Change password">
        <p className="mt-1 text-muted">Changing it signs out every other device.</p>
        <div className="mt-4 max-w-md">
          <AuthForm
            action={changePasswordAction}
            submitLabel="Change password"
            fields={[
              { name: "current", label: "Current password", type: "password", autoComplete: "current-password" },
              { name: "password", label: "New password", type: "password", autoComplete: "new-password", hint: "At least 12 characters. A short phrase works well." },
              { name: "confirm", label: "Confirm new password", type: "password", autoComplete: "new-password" },
            ]}
          />
        </div>
      </Card>

      <Card id="mfa-h" title="Two-factor sign-in">
        {s.mfa_enabled ? (
          <>
            <p className="mt-1 text-ok">On. {remaining} recovery code{remaining === 1 ? "" : "s"} left.</p>
            <div className="mt-6 grid gap-8 lg:grid-cols-2">
              <div>
                <h3 className="text-lg font-semibold">Replace recovery codes</h3>
                <div className="mt-3 max-w-md">
                  <AuthForm action={regenRecoveryAction} submitLabel="Create new codes" fields={[{ name: "current", label: "Current password", type: "password", autoComplete: "current-password" }]} />
                </div>
              </div>
              {!requireMfa && (
                <div>
                  <h3 className="text-lg font-semibold">Turn off two-factor</h3>
                  <div className="mt-3 max-w-md">
                    <AuthForm
                      action={mfaDisableAction}
                      submitLabel="Turn off"
                      fields={[
                        { name: "current", label: "Current password", type: "password", autoComplete: "current-password" },
                        { name: "code", label: "Authenticator code", autoComplete: "one-time-code", maxLength: 12 },
                      ]}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        ) : qr ? (
          <div className="mt-4 grid gap-8 md:grid-cols-[auto_1fr]">
            <div>
              <div role="img" aria-label="QR code for your authenticator app" className="inline-block bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} />
            </div>
            <div className="max-w-md">
              <p className="text-muted">Scan the code with an authenticator app (such as Microsoft Authenticator, Google Authenticator, or 1Password). Cannot scan? Enter this key instead:</p>
              <p className="mt-2 break-all font-mono text-ink">{manualKey}</p>
              <div className="mt-4">
                <AuthForm action={mfaConfirmAction} submitLabel="Turn on two-factor" fields={[{ name: "code", label: "6 digit code from the app", autoComplete: "one-time-code", inputMode: "numeric", maxLength: 12 }]} />
              </div>
              <form action={mfaCancelAction} className="mt-3"><button type="submit" className="btn">Cancel</button></form>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-1 text-muted">Adds a code from your phone to every sign in, so a stolen password alone is not enough. Recommended.</p>
            <form action={mfaStartAction} className="mt-4"><button type="submit" className="btn btn-primary">Set up two-factor</button></form>
          </>
        )}
      </Card>

      <Card id="sess-h" title="Where you are signed in">
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {sessions.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-semibold">{x.user_agent ? x.user_agent.slice(0, 70) : "Unknown device"}{x.id === s.session_id ? " (this device)" : ""}</p>
                <p className="text-sm text-muted">{x.ip || "unknown address"} · started {fmt(x.created_at)} · last active {fmt(x.last_seen_at)}</p>
              </div>
              {x.id !== s.session_id && (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={x.id} />
                  <button type="submit" className="btn">Sign out</button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {sessions.length > 1 && (
          <form action={revokeOthersAction} className="mt-4"><button type="submit" className="btn">Sign out all other devices</button></form>
        )}
      </Card>

      <Card id="act-h" title="Recent security activity">
        {events.length === 0 ? <p className="mt-3 text-muted">Nothing yet.</p> : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                <span>{EVENTS[e.event] || e.event}{e.detail ? <span className="text-muted"> ({e.detail})</span> : null}</span>
                <span className="text-muted">{fmt(e.created_at)} · {e.ip || ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
