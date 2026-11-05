import AppShell from "@/components/AppShell";
import { requireUser } from "@/lib/auth";

export default async function AdminLayout({ children }) {
  // Pages and actions check again on their own: layouts are not re-run on every client navigation.
  const user = await requireUser({ allowUnenrolled: true });
  return <AppShell user={user}>{children}</AppShell>;
}
