"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page data every few seconds while a scan is running, so progress shows live. */
export default function AutoRefresh({ active, everyMs = 6000 }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
