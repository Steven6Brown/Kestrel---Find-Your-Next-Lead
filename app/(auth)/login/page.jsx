import Link from "next/link";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import Flash from "@/components/Flash";
import PublicShell from "@/components/PublicShell";
import { loginAction } from "../actions";
import { BRAND, currentSession } from "@/lib/auth";
import { safeNext } from "@/lib/safeNext";
import { countUsers } from "@/lib/users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const s = await currentSession();
  if (s && (!s.mfa_enabled || s.mfa_passed)) redirect(next);
  if ((await countUsers(BRAND)) === 0) redirect("/setup");
  return (
    <PublicShell>
      <div className="mx-auto max-w-md">
        <p className="eyebrow">Welcome back</p>
        <h1 className="mt-1 text-4xl font-semibold">Sign in</h1>
        <div className="mt-6"><Flash sp={sp} /></div>
        <AuthForm
          action={loginAction}
          submitLabel="Sign in"
          hidden={{ next }}
          fields={[
            { name: "email", label: "Email", type: "email", autoComplete: "username", autoFocus: true },
            { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
          ]}
        >
          <div className="flex min-h-[44px] items-center gap-3">
            <input id="remember" name="remember" type="checkbox" className="h-5 w-5 accent-[#c08a2e]" />
            <label htmlFor="remember">Keep me signed in on this device</label>
          </div>
        </AuthForm>
        <p className="mt-6">
          <Link href="/forgot" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Forgot your password?</Link>
        </p>
      </div>
    </PublicShell>
  );
}
