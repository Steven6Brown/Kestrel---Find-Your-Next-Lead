import BrandHeader from "@/components/BrandHeader";
import { LegalFooter } from "@/components/PublicShell";
import { isManager, requireUser } from "@/lib/auth";

export default async function AdminLayout({ children }) {
  // Pages and actions check again on their own: layouts are not re-run on every client navigation.
  const user = await requireUser({ allowUnenrolled: true });
  const links = [
    ["/", "Overview"],
    ["/leads?bucket=no_website", "Leads"],
    ["/queue", "Review queue"],
    ["/optouts", "Opt-outs"],
    ...(isManager(user) ? [["/users", "Users"], ["/audit", "Audit"]] : []),
  ];
  return (
    <>
      <BrandHeader links={links} user={user} />
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
      <LegalFooter />
    </>
  );
}
