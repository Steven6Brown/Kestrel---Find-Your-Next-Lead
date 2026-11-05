import PublicShell from "@/components/PublicShell";
import { listBrandIds, getBrand } from "@/config/brands";
import { verifyUnsubscribe } from "@/lib/tokens";

export const metadata = { title: "Unsubscribe" };
export const dynamic = "force-dynamic";

export default async function Unsubscribe({ searchParams }) {
  const sp = await searchParams;
  const b = typeof sp.b === "string" ? sp.b : "";
  const e = typeof sp.e === "string" ? sp.e.slice(0, 254) : "";
  const s = typeof sp.s === "string" ? sp.s : "";
  const valid = listBrandIds().includes(b) && verifyUnsubscribe(b, e, s);
  const brand = valid ? getBrand(b) : null;
  const query = new URLSearchParams({ b, e, s }).toString();

  return (
    <PublicShell>
      <h1 className="text-4xl font-extrabold">Unsubscribe</h1>
      {valid ? (
        <>
          <p className="mt-4 text-lg">
            Confirm that {e} should no longer receive email from {brand.name}.
          </p>
          <form action={`/api/unsubscribe?${query}`} method="post" className="mt-6">
            <button type="submit" className="btn btn-primary">Unsubscribe me</button>
          </form>
        </>
      ) : (
        <p className="mt-4 text-lg" role="alert">
          This opt-out link is not valid. If you want to stop receiving email, reply to the message with the word STOP and it will be honored.
        </p>
      )}
    </PublicShell>
  );
}
