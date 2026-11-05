import Link from "next/link";
import PublicShell from "@/components/PublicShell";
import AuthForm from "@/components/AuthForm";
import { forgotAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reset your password" };

export default function Forgot() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-md">
        <p className="eyebrow">Account recovery</p>
        <h1 className="mt-1 text-4xl font-semibold">Reset your password</h1>
        <p className="mt-2 text-muted">Enter your account email. If it matches an account we will send a link that works once and expires in 1 hour.</p>
        <div className="mt-6">
          <AuthForm action={forgotAction} submitLabel="Send reset link" fields={[{ name: "email", label: "Email", type: "email", autoComplete: "username", autoFocus: true }]} />
        </div>
        <p className="mt-6"><Link href="/login" className="inline-flex min-h-[44px] items-center text-muted underline underline-offset-4 hover:text-brand-hover">Back to sign in</Link></p>
      </div>
    </PublicShell>
  );
}
