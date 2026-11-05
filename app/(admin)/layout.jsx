import BrandHeader from "@/components/BrandHeader";
import { LegalFooter } from "@/components/PublicShell";
import { isManager, requireUser } from "@/lib/auth";

export default async function AdminLayout({ children }) {
  // Pages and actions check again on their own: layouts are not re-run on every client navigation.
  const user = await requireUser({ allowUnenrolled: true });
  const links = [
    ["/today", "Today"],
    ["/calendar", "Calendar"],
    ["/pipeline", "Pipeline"],
    ["/leads", "Leads"],
    ["/redesign", "Redesign targets"],
    ["/clients", "Clients"],
    ["/meetings", "Meetings"],
    ["/", "Scanner"],
    ["/queue", "Review queue"],
    ["/optouts", "Opt-outs"],
    ...(isManager(user) ? [["/connections", "Connections"], ["/users", "Users"], ["/audit", "Audit"]] : []),
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
