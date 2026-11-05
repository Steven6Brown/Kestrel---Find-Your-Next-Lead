import Link from "next/link";
import PublicShell from "@/components/PublicShell";
import AuthForm from "@/components/AuthForm";
import { acceptInviteAction } from "../actions";
import { getInvitedUser } from "@/lib/users-view";
import { peekAuthToken } from "@/lib/users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept your invitation", referrer: "no-referrer" };

export default async function Accept({ searchParams }) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token.slice(0, 200) : "";
  const row = await peekAuthToken(token, "invite");
  const user = row ? await getInvitedUser(row.user_id) : null;
  return (
    <PublicShell>
      <div className="mx-auto max-w-md">
        <p className="eyebrow">Invitation</p>
        <h1 className="mt-1 text-4xl font-semibold">Set up your account</h1>
        {user ? (
          <div className="mt-6">
            <p className="mb-4 text-muted">Creating the account for {user.email}.</p>
            <AuthForm
              action={acceptInviteAction}
              submitLabel="Create account"
              hidden={{ token }}
              initial={{ name: user.name === user.email ? "" : user.name }}
              fields={[
                { name: "name", label: "Your name", autoComplete: "name", maxLength: 80, autoFocus: true },
                { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "At least 12 characters. A short phrase works well." },
                { name: "confirm", label: "Confirm password", type: "password", autoComplete: "new-password" },
              ]}
            />
          </div>
        ) : (
          <>
            <p role="alert" className="mt-6 border border-bad bg-bad-bg p-3 text-bad">This invitation is invalid or has expired. Ask an administrator to send a new one.</p>
            <p className="mt-6"><Link href="/login" className="btn">Go to sign in</Link></p>
          </>
        )}
      </div>
    </PublicShell>
  );
}
