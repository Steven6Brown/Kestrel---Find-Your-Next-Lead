import Flash from "@/components/Flash";
import AuthForm from "@/components/AuthForm";
import { ChipRadio } from "@/components/Chips";
import { BRAND, requireUser } from "@/lib/auth";
import { isLocked, listUsers } from "@/lib/users";
import { inviteUserAction, sendResetAction, setRoleAction, setStatusAction, unlockAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users" };

const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Never");

export default async function Users({ searchParams }) {
  const sp = await searchParams;
  const me = await requireUser({ roles: ["owner", "admin"] });
  const users = await listUsers(BRAND);
  return (
    <div className="reveal">
      <p className="eyebrow">Administration</p>
      <h1 className="mt-1 text-4xl font-semibold">Users</h1>
      <p className="mt-2 max-w-2xl text-muted">Owners manage everything. Administrators manage members and send email. Members can run campaigns and review leads but cannot send email or manage users.</p>
      <div className="mt-4"><Flash sp={sp} /></div>

      <section aria-labelledby="inv-h" className="card mt-6 p-5">
        <h2 id="inv-h" className="text-2xl font-semibold">Invite someone</h2>
        <div className="mt-4 max-w-md">
          <AuthForm action={inviteUserAction} submitLabel="Send invitation" fields={[{ name: "email", label: "Email", type: "email", autoComplete: "off" }]}>
            <fieldset>
              <legend className="font-semibold text-ink">Role</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                <ChipRadio name="role" value="member" label="Member" defaultChecked />
                {me.role === "owner" && <ChipRadio name="role" value="admin" label="Administrator" />}
              </div>
            </fieldset>
          </AuthForm>
        </div>
      </section>

      <section aria-labelledby="list-h" className="mt-8">
        <h2 id="list-h" className="sr-only">All users</h2>
        <ul className="card divide-y divide-line">
          {users.map((x) => {
            const locked = isLocked(x);
            const locksOwner = me.role !== "owner" && x.role === "owner";
            return (
              <li key={x.id} className="p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-ink">{x.name}{x.id === me.id ? " (you)" : ""} <span className="font-normal text-muted">{x.email}</span></p>
                  <p className="text-sm text-muted capitalize">{x.role} · {x.status}{locked ? " · locked" : ""}{x.mfa_enabled ? " · 2FA on" : ""} · last sign in {fmt(x.last_login_at)}</p>
                </div>
                {!locksOwner && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <form action={setRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={x.id} />
                      <label htmlFor={`r${x.id}`} className="sr-only">Role for {x.email}</label>
                      <select id={`r${x.id}`} name="role" defaultValue={x.role} className="field !w-auto">
                        {me.role === "owner" && <option value="owner">Owner</option>}
                        <option value="admin" disabled={me.role !== "owner"}>Administrator</option>
                        <option value="member">Member</option>
                      </select>
                      <button type="submit" className="btn">Change role</button>
                    </form>
                    {x.id !== me.id && (
                      <form action={setStatusAction}>
                        <input type="hidden" name="userId" value={x.id} />
                        <input type="hidden" name="disable" value={x.status === "disabled" ? "false" : "true"} />
                        <button type="submit" className="btn">{x.status === "disabled" ? "Enable" : "Disable"}</button>
                      </form>
                    )}
                    {locked && (
                      <form action={unlockAction}><input type="hidden" name="userId" value={x.id} /><button type="submit" className="btn">Unlock</button></form>
                    )}
                    {x.status === "active" && (
                      <form action={sendResetAction}><input type="hidden" name="userId" value={x.id} /><button type="submit" className="btn">Send reset link</button></form>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
