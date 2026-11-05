"use client";

export default function GlobalError({ reset }) {
  // Never show internal error details to the user.
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-24">
      <h1 className="text-4xl font-extrabold">Something went wrong</h1>
      <p className="mt-4 text-muted">The page could not be loaded. Please try again.</p>
      <button type="button" onClick={() => reset()} className="btn btn-primary mt-8">
        Try again
      </button>
    </main>
  );
}
