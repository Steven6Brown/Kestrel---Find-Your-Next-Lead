import Link from "next/link";
import { product } from "@/config/product";
import { getBrand, DEFAULT_BRAND_ID } from "@/config/brands";
import { logoutAction } from "@/app/(auth)/actions";

/** Logo lockup read from the brand config, so a white-label brand swaps the logo and name. */
export function Lockup({ brand }) {
  return (
    <span className="flex items-center gap-3">
      {brand.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logo} alt="" width={32} height={32} className="h-8 w-8 shrink-0" />
      ) : null}
      <span className="flex flex-col leading-tight">
        <span className="font-bold uppercase tracking-wide text-brand">{product.name}</span>
        <span className="eyebrow !text-[0.65rem] !text-muted">by {brand.name.replace(/ LLC$/, "")}</span>
      </span>
    </span>
  );
}

export default function BrandHeader({ links = [], user = null }) {
  const brand = getBrand(DEFAULT_BRAND_ID);
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" aria-label={`${product.name} home`}><Lockup brand={brand} /></Link>
        {links.length > 0 && (
          <nav aria-label="Main">
            <ul className="flex flex-wrap">
              {links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="eyebrow inline-flex min-h-[44px] items-center px-3 !text-muted hover:!text-brand-hover">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {user && (
          <div className="flex items-center gap-2">
            <Link href="/account" className="inline-flex min-h-[44px] items-center px-2 text-sm text-muted underline-offset-4 hover:text-brand-hover hover:underline">
              {user.name}
            </Link>
            <form action={logoutAction}><button type="submit" className="btn !min-h-[44px]">Log out</button></form>
          </div>
        )}
      </div>
    </header>
  );
}
