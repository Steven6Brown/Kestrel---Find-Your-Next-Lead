"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Icon from "./Icon";

/** The menu on phones: a bar with a button that opens the same navigation, and closes again after you pick a page. */
export default function MobileMenu({ lockup, children }) {
  const ref = useRef(null);
  const pathname = usePathname();
  useEffect(() => {
    ref.current?.removeAttribute("open");
  }, [pathname]);
  return (
    <details ref={ref} className="group bg-side text-side-ink lg:hidden">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-4 [&::-webkit-details-marker]:hidden">
        {lockup}
        <span className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-lg border border-side-line px-3 text-sm">
          <Icon name="menu" />
          Menu
        </span>
      </summary>
      <div className="max-h-[calc(100vh-56px)] overflow-y-auto border-t border-side-line px-3 pb-4 pt-3">{children}</div>
    </details>
  );
}
