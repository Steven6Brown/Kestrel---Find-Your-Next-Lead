import Link from "next/link";
import { product } from "@/config/product";
import { getBrand, DEFAULT_BRAND_ID } from "@/config/brands";

const links = [
  ["/", "Dashboard"],
  ["/leads?bucket=no_website", "No website"],
  ["/leads?bucket=has_website", "Has website"],
  ["/queue", "Review queue"],
  ["/optouts", "Opt-outs"],
];

export default function AdminLayout({ children }) {
  const brand = getBrand(DEFAULT_BRAND_ID);
  return (
    <>
      <header className="border-b-2 border-ink bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="font-[family-name:var(--font-archivo)] text-2xl font-extrabold">
            {product.name}
          </Link>
          <nav aria-label="Main">
            <ul className="flex flex-wrap">
              {links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="inline-flex min-h-[44px] items-center px-3 font-semibold underline-offset-4 hover:underline">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p className="text-sm text-muted">Brand: {brand.name}</p>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
      <footer className="mx-auto max-w-6xl border-t border-line px-4 py-6 text-sm text-muted">
        <p>{product.operator}.</p>
        <ul className="mt-2 flex flex-wrap gap-x-4">
          {[["/privacy", "Privacy Policy"], ["/terms", "Terms of Use"], ["/accessibility", "Accessibility Statement"]].map(([h, t]) => (
            <li key={h}>
              <Link href={h} className="inline-flex min-h-[44px] items-center underline underline-offset-4">{t}</Link>
            </li>
          ))}
        </ul>
      </footer>
    </>
  );
}
