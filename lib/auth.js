// Request-bound auth helpers (cookies and headers). Server only.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { DEFAULT_BRAND_ID } from "@/config/brands";
import { createSession, deleteSessionByToken, getSession } from "./users.js";
import { baseUrl } from "./tokens.js";

export const COOKIE = "ss_session";
export const BRAND = DEFAULT_BRAND_ID;

const secureCookie = () => (process.env.APP_BASE_URL || "").startsWith("https://") || !!process.env.VERCEL;

export async function clientInfo() {
  const h = await headers();
  return {
    ip: (h.get("x-forwarded-for") || h.get("x-real-ip") || "local").split(",")[0].trim(),
    userAgent: h.get("user-agent") || "",
  };
}

/** Starts a fresh session (a new token every time, so a pre-login cookie can never be reused). */
export async function startSession(userId, { remember = false, mfaPassed = false } = {}) {
  const jar = await cookies();
  await deleteSessionByToken(jar.get(COOKIE)?.value);
  const { ip, userAgent } = await clientInfo();
  const raw = await createSession(userId, { remember, mfaPassed, ip, userAgent });
  jar.set(COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    ...(remember ? { maxAge: 30 * 24 * 3600 } : {}),
  });
  return raw;
}

export async function endSession() {
  const jar = await cookies();
  await deleteSessionByToken(jar.get(COOKIE)?.value);
  jar.delete(COOKIE);
}

export async function currentSession() {
  const jar = await cookies();
  return getSession(jar.get(COOKIE)?.value);
}

/**
 * Gate for every protected page and server action. Redirects to sign-in (or the second
 * factor step) when needed. `roles` limits who may continue.
 */
export async function requireUser({ roles, allowUnenrolled = false } = {}) {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.mfa_enabled && !s.mfa_passed) redirect("/login/mfa");
  if (process.env.REQUIRE_MFA === "1" && !s.mfa_enabled && !allowUnenrolled) redirect("/account?enroll=1");
  if (roles && !roles.includes(s.role)) redirect("/?msg=You+do+not+have+permission+for+that.&type=bad");
  return s;
}

/** Session that has passed the password step but not yet the second factor. */
export async function requirePendingMfa() {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (!s.mfa_enabled || s.mfa_passed) redirect("/today");
  return s;
}

/** Where links in account emails point. APP_BASE_URL wins; on localhost the request host is used. */
export async function linkBase() {
  if (process.env.APP_BASE_URL) return baseUrl();
  const host = (await headers()).get("host") || "";
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? `http://${host}` : baseUrl();
}

export const isManager = (u) => u.role === "owner" || u.role === "admin";
