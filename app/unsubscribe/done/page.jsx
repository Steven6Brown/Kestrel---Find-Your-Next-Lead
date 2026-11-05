import PublicShell from "@/components/PublicShell";

export const metadata = { title: "Unsubscribed" };

export default function Done() {
  return (
    <PublicShell>
      <h1 className="text-4xl font-semibold">You are unsubscribed</h1>
      <p className="mt-4 text-lg" role="status">
        Your address has been added to our opt-out list and will not be emailed again.
      </p>
    </PublicShell>
  );
}
