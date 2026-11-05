// Light or dark. The only thing stored is the word, in a cookie the toggle writes.
export const THEME_COOKIE = "ks_theme";

/** Anything other than the exact word "dark" is light, so a damaged cookie can never break the page. */
export function parseTheme(value) {
  return value === "dark" ? "dark" : "light";
}
