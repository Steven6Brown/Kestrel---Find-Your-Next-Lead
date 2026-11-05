"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS, isActive } from "@/lib/nav";
import Icon from "./Icon";

/** The grouped menu. Highlights the page you are on and marks it for screen readers. */
export default function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      {NAV_GROUPS.map((g) => (
        <div key={g.key} className={g.label ? "mt-5" : ""}>
          {g.label ? <p className="px-3 pb-1 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-side-muted">{g.label}</p> : null}
          <ul>
            {g.items.map((item) => {
              const on = isActive(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={on ? "page" : undefined}
                    className={`flex min-h-[44px] items-center gap-3 rounded-lg border-l-[3px] px-3 text-[0.95rem] ${on ? "border-side-gold bg-side-active font-semibold text-white" : "border-transparent text-side-ink hover:bg-side-active"}`}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
