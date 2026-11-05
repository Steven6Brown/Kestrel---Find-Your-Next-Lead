/** Only same-site relative paths are allowed as a post-login destination (no open redirects). */
export function safeNext(value, fallback = "/") {
  const v = String(value || "");
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\r\n\t]/.test(v) || v.length > 300) return fallback;
  if (/^\/(login|forgot|reset|accept|setup)(\/|\?|$)/.test(v)) return fallback;
  return v;
}
