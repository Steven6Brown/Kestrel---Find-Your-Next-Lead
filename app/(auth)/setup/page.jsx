import { redirect } from "next/navigation";
import PublicShell from "@/components/PublicShell";
import AuthForm from "@/components/AuthForm";
import { setupAction } from "../actions";
import { BRAND } from "@/lib/auth";
import { countUsers } from "@/lib/users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Create the owner account" };

export default async function Setup() {
  if ((await countUsers(BRAND)) > 0) redirect("/login");
  const needsCode = !!process.env.SETUP_TOKEN;
  return (
    <PublicShell>
      <div className="mx-auto max-w-md">
        <p className="eyebrow">First run</p>
        <h1 className="mt-1 text-4xl font-semibold">Create the owner account</h1>
        <p className="mt-2 text-muted">This account can manage users and send email. You can add teammates after signing in.</p>
        <div className="mt-6">
          <AuthForm
            action={setupAction}
            submitLabel="Create account"
            fields={[
              { name: "name", label: "Your name", autoComplete: "name", maxLength: 80, autoFocus: true },
              { name: "email", label: "Email", type: "email", autoComplete: "username" },
              { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "At least 12 characters. A short phrase works well." },
              { name: "confirm", label: "Confirm password", type: "password", autoComplete: "new-password" },
              ...(needsCode ? [{ name: "setupToken", label: "Setup code (from SETUP_TOKEN)", type: "password", autoComplete: "off" }] : []),
            ]}
          />
        </div>
      </div>
    </PublicShell>
  );
}
