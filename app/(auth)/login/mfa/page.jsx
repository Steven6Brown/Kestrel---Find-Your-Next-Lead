import PublicShell from "@/components/PublicShell";
import AuthForm from "@/components/AuthForm";
import { logoutAction, mfaAction } from "../../actions";
import { requirePendingMfa } from "@/lib/auth";
import { safeNext } from "@/lib/safeNext";

export const dynamic = "force-dynamic";
export const metadata = { title: "Two-factor sign in" };

export default async function Mfa({ searchParams }) {
  const sp = await searchParams;
  await requirePendingMfa();
  return (
    <PublicShell>
      <div className="mx-auto max-w-md">
        <p className="eyebrow">Step 2 of 2</p>
        <h1 className="mt-1 text-4xl font-semibold">Enter your code</h1>
        <p className="mt-2 text-muted">Open your authenticator app and enter the 6 digit code. Lost your phone? Use one of your recovery codes instead.</p>
        <div className="mt-6">
          <AuthForm
            action={mfaAction}
            submitLabel="Verify"
            hidden={{ next: safeNext(sp.next, "/today") }}
            fields={[{ name: "code", label: "Authenticator or recovery code", autoComplete: "one-time-code", autoFocus: true, maxLength: 32 }]}
          />
        </div>
        <form action={logoutAction} className="mt-4"><button type="submit" className="btn">Cancel and sign out</button></form>
      </div>
    </PublicShell>
  );
}
