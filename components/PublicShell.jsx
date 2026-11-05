import Link from "next/link";
import { product } from "@/config/product";

export default function PublicShell({ children }) {
  return (
    <>
      <header className="border-b-2 border-ink bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold">{product.name}</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-10">{children}</main>
      <footer className="mx-auto max-w-3xl border-t border-line px-4 py-6 text-sm text-muted">
        <ul className="flex flex-wrap gap-x-4">
          {[["/privacy", "Privacy Policy"], ["/terms", "Terms of Use"], ["/accessibility", "Accessibility Statement"]].map(([h, t]) => (
            <li key={h}><Link href={h} className="inline-flex min-h-[44px] items-center underline underline-offset-4">{t}</Link></li>
          ))}
        </ul>
      </footer>
    </>
  );
}
