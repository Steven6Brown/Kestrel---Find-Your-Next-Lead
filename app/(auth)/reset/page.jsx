import Link from "next/link";
import PublicShell from "@/components/PublicShell";
import AuthForm from "@/components/AuthForm";
import { resetAction } from "../actions";
import { peekAuthToken } from "@/lib/users";

export const dynamic = "force-dynamic";
// The token is in the URL, so never send it onward in a Referer header.
export const metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default async function Reset({ searchParams }) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token.slice(0, 200) : "";
  const valid = !!(await peekAuthToken(token, "reset"));
  return (
    <PublicShell>
      <div className="mx-auto max-w-md">
        <p className="eyebrow">Account recovery</p>
        <h1 className="mt-1 text-4xl font-semibold">Choose a new password</h1>
        {valid ? (
          <div className="mt-6">
            <AuthForm
              action={resetAction}
              submitLabel="Update password"
              hidden={{ token }}
              fields={[
                { name: "password", label: "New password", type: "password", autoComplete: "new-password", hint: "At least 12 characters. Avoid common passwords and ones found in data breaches. A short phrase works well." },
                { name: "confirm", label: "Confirm new password", type: "password", autoComplete: "new-password" },
              ]}
            />
            <p className="mt-4 text-sm text-muted">Changing your password signs you out everywhere.</p>
          </div>
        ) : (
          <>
            <p role="alert" className="mt-6 border border-bad bg-bad-bg p-3 text-bad">This reset link is invalid or has expired.</p>
            <p className="mt-6"><Link href="/forgot" className="btn btn-primary">Request a new link</Link></p>
          </>
        )}
      </div>
    </PublicShell>
  );
}
