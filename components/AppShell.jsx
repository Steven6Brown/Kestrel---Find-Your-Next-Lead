import { useId } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { product } from "@/config/product";
import { getBrand, DEFAULT_BRAND_ID } from "@/config/brands";
import { logoutAction } from "@/app/(auth)/actions";
import { LegalFooter } from "./PublicShell";
import NavLinks from "./NavLinks";
import MobileMenu from "./MobileMenu";
import ThemeToggle from "./ThemeToggle";
import { initialsOf, ROLE_LABELS } from "@/lib/nav";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

function SideLockup({ brand }) {
  return (
    <Link href="/today" aria-label={`${product.name} home`} className="flex items-center gap-3">
      {brand.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logo} alt="" width={32} height={32} className="h-8 w-8 shrink-0" />
      ) : null}
      <span className="flex flex-col leading-tight">
        <span className="font-bold uppercase tracking-wide text-side-gold">{product.name}</span>
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-side-muted">by {brand.name.replace(/ LLC$/, "")}</span>
      </span>
    </Link>
  );
}

/** Navigation, theme switch, and the signed in person, used in the sidebar and in the phone menu. */
function SideBody({ user, theme }) {
  const uid = useId();
  return (
    <>
      <form action="/search" method="get" role="search" className="mb-4 px-1">
        <label htmlFor={`${uid}-q`} className="sr-only">Search contacts, clients, and deals</label>
        <input id={`${uid}-q`} name="q" type="search" maxLength={80} autoComplete="off" placeholder="Search" className="min-h-[44px] w-full rounded-lg border border-side-line bg-side-active px-3 text-[0.95rem] text-white placeholder:text-side-muted" />
      </form>
      <div className="flex-1"><NavLinks /></div>
      <div className="mt-6 border-t border-side-line pt-3">
        <ThemeToggle initial={theme} tone="side" />
        <Link href="/account" className="mt-1 flex min-h-[52px] items-center gap-3 rounded-lg px-3 hover:bg-side-active">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-side-gold font-bold text-side">{initialsOf(user.name)}</span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-semibold text-white">{user.name}</span>
            <span className="block text-xs text-side-muted">{ROLE_LABELS[user.role] || "Member"}</span>
          </span>
        </Link>
        <form action={logoutAction} className="mt-1">
          <button type="submit" className="flex min-h-[44px] w-full items-center rounded-lg px-3 text-left text-[0.95rem] text-side-ink hover:bg-side-active">Log out</button>
        </form>
      </div>
    </>
  );
}

/** The signed in frame: Aquila navy sidebar on large screens, a menu bar on phones, the page on the right. */
export default async function AppShell({ user, children }) {
  const brand = getBrand(DEFAULT_BRAND_ID);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="min-h-screen lg:flex">
      <MobileMenu lockup={<SideLockup brand={brand} />}>
        <SideBody user={user} theme={theme} />
      </MobileMenu>
      <aside className="hidden bg-side text-side-ink lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:overflow-y-auto lg:px-3 lg:py-5">
        <div className="px-3 pb-5"><SideLockup brand={brand} /></div>
        <SideBody user={user} theme={theme} />
      </aside>
      <div className="min-w-0 flex-1">
        <main id="main" className="mx-auto max-w-6xl px-4 py-8 lg:px-8">{children}</main>
        <LegalFooter />
      </div>
    </div>
  );
}
