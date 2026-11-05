import PublicShell from "@/components/PublicShell";
import { product } from "@/config/product";

export const metadata = { title: "Terms of Use" };

export default function Terms() {
  return (
    <PublicShell>
      <h1 className="text-4xl font-extrabold">Terms of Use</h1>
      <p className="mt-2 text-muted">Draft for review. This is not legal advice.</p>
      <div className="mt-6 space-y-4 text-lg leading-relaxed">
        <p>{product.name} is operated by Aquila Digital LLC. The dashboard is private and for authorized staff only.</p>
        <h2 className="pt-2 text-2xl font-extrabold">Concept pages</h2>
        <p>Concept pages are illustrations only. They are not the official website of the business shown, are not affiliated with it, and may contain placeholders that are not confirmed facts. A business may ask for its concept page to be removed at any time by replying to the email it received.</p>
        <h2 className="pt-2 text-2xl font-extrabold">No guarantees</h2>
        <p>Listing details come from Google and may be out of date or wrong. Nothing here is an offer, quote, or guarantee of results.</p>
      </div>
    </PublicShell>
  );
}
