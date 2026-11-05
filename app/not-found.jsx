import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-24">
      <h1 className="text-4xl font-extrabold">Page not found</h1>
      <p className="mt-4 text-muted">
        That page does not exist, or the link you followed is no longer valid.
      </p>
      <Link href="/" className="btn btn-primary mt-8">
        Back to the start
      </Link>
    </main>
  );
}
