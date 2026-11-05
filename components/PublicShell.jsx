import Link from "next/link";
import BrandHeader from "./BrandHeader";

export const LEGAL = [["/privacy", "Privacy Policy"], ["/terms", "Terms of Use"], ["/accessibility", "Accessibility Statement"]];

export function LegalFooter() {
  return (
    <footer className="mx-auto max-w-6xl border-t border-line px-4 py-6">
      <p className="eyebrow">Per aspera ad astra</p>
      <ul className="mt-2 flex flex-wrap gap-x-4 text-sm text-muted">
        {LEGAL.map(([h, t]) => (
          <li key={h}><Link href={h} className="inline-flex min-h-[44px] items-center underline underline-offset-4 hover:text-brand-hover">{t}</Link></li>
        ))}
      </ul>
    </footer>
  );
}

export default function PublicShell({ children }) {
  return (
    <>
      <BrandHeader />
      <main id="main" className="mx-auto max-w-3xl px-4 py-10">{children}</main>
      <LegalFooter />
    </>
  );
}
