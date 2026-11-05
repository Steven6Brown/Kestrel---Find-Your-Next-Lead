"use client";

import { useState } from "react";
import Icon from "./Icon";

/**
 * Light and dark switch. The choice is kept in a plain cookie so the server draws the right theme on the next
 * page with no flash. It stores nothing about the person, only the word light or dark.
 */
export default function ThemeToggle({ initial = "light", tone = "page" }) {
  const [theme, setTheme] = useState(initial === "dark" ? "dark" : "light");
  const next = theme === "dark" ? "light" : "dark";
  function flip() {
    document.documentElement.dataset.theme = next;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `ks_theme=${next}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    setTheme(next);
  }
  const cls = tone === "side"
    ? "flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-[0.95rem] text-side-ink hover:bg-side-active"
    : "btn";
  return (
    <button type="button" onClick={flip} className={cls} aria-label={`Switch to ${next} mode`}>
      <Icon name={theme === "dark" ? "sun" : "moon"} />
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
