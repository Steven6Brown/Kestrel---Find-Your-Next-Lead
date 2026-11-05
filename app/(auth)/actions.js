"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { BRAND, clientInfo, currentSession, endSession, linkBase, requirePendingMfa, startSession } from "@/lib/auth";
import { getBrand } from "@/config/brands";
import { allow } from "@/lib/ratelimit";
import { safeEqual, decrypt } from "@/lib/crypto";
import { burnTime, checkNewPassword, hashPassword, PASSWORD_MAX, verifyPassword } from "@/lib/passwords";
import { hashRecovery, verifyTotp } from "@/lib/totp";
import { safeNext } from "@/lib/safeNext";
import { sendAccountMail } from "@/lib/mailer";
import * as u from "@/lib/users";

const GENERIC = "Incorrect email or password.";
const LOCKED = "Too many failed attempts. Try again in 15 minutes, or reset your password.";
const INVALID_LINK = "This link is invalid or has expired. Request a new one.";
const str = (v, max = 256) => String(v ?? "").slice(0, max);

async function notify(user, subject, text) {
  const brand = getBrand(BRAND);
  await sendAccountMail({ to: user.email, subject, text: `${text}\n\n${brand.name}` });
}

// ---------------- sign in ----------------

export async function loginAction(_prev, fd) {
  const email = u.normEmail(str(fd.get("email"), 254));
  const password = str(fd.get("password"), PASSWORD_MAX * 2);
  const remember = fd.get("remember") === "on";
  const next = safeNext(fd.get("next"));
  const values = { email };
  const { ip } = await clientInfo();
  if (!allow(`login:ip:${ip}`, 10, 60_000)) return { error: "Too many attempts. Wait a minute and try again.", values };
  if (!email || !password) return { error: GENERIC, values };

  const user = await u.getUserByEmail(BRAND, email);
  if (!user || user.status !== "active" || !user.password_hash) {
    await burnTime(password); // same work whether or not the account exists
    await u.audit(BRAND, user?.id, "login_failed", user ? `account ${user.status}` : "unknown email", ip);
    return { error: GENERIC, values };
  }
  if (u.isLocked(user)) {
    await burnTime(password);
    await u.audit(BRAND, user.id, "login_blocked_locked", "", ip);
    return { error: LOCKED, values };
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    const r = await u.recordFailure(user.id);
    await u.audit(BRAND, user.id, r.locked ? "account_locked" : "login_failed", "bad password", ip);
    if (r.locked) await notify(user, "Your account was temporarily locked", "There were several failed sign-in attempts on your account, so it is locked for 15 minutes. If this was not you, reset your password.");
    return { error: r.locked ? LOCKED : GENERIC, values };
  }
  if (user.mfa_enabled) {
    await startSession(user.id, { remember, mfaPassed: false });
    await u.audit(BRAND, user.id, "password_ok_mfa_pending", "", ip);
    redirect(`/login/mfa?next=${encodeURIComponent(next)}`);
  }
  await u.recordSuccess(user.id);
  await startSession(user.id, { remember, mfaPassed: true });
  await u.audit(BRAND, user.id, "login_ok", "", ip);
  redirect(next);
}

export async function mfaAction(_prev, fd) {
  const s = await requirePendingMfa();
  const { ip } = await clientInfo();
  const next = safeNext(fd.get("next"));
  const code = str(fd.get("code"), 32).trim();
  if (!allow(`mfa:${s.session_id}`, 10, 10 * 60_000)) return { error: "Too many attempts. Sign in again in a few minutes." };

  let ok = false;
  let used = "";
  if (/^\d{3}\s?\d{3}$/.test(code)) {
    const step = verifyTotp(decrypt(s.mfa_secret), code, { lastStep: Number(s.mfa_last_step) });
    if (step !== null) { await u.setMfaStep(s.id, step); ok = true; used = "authenticator code"; }
  } else if (code.length >= 8) {
    ok = await u.consumeRecoveryCode(s, hashRecovery(code));
    if (ok) used = "recovery code";
  }
  if (!ok) {
    const r = await u.recordFailure(s.id);
    await u.audit(BRAND, s.id, r.locked ? "account_locked" : "mfa_failed", "", ip);
    if (r.locked) {
      await u.deleteUserSessions(s.id);
      redirect(`/login?${new URLSearchParams({ msg: LOCKED, type: "bad" })}`);
    }
    return { error: "That code was not accepted. Try again." };
  }
  await u.recordSuccess(s.id);
  await startSession(s.id, { remember: s.remember, mfaPassed: true }); // rotate the session after the second factor
  await u.audit(BRAND, s.id, "login_ok", `second factor: ${used}`, ip);
  redirect(next);
}

export async function logoutAction() {
  const s = await currentSession();
  const { ip } = await clientInfo();
  if (s) await u.audit(BRAND, s.id, "logout", "", ip);
  await endSession();
  redirect(`/login?${new URLSearchParams({ msg: "You have been signed out.", type: "ok" })}`);
}

// ---------------- password reset ----------------

export async function forgotAction(_prev, fd) {
  const email = u.normEmail(str(fd.get("email"), 254));
  const reply = { ok: "If an account exists for that email, a reset link is on its way. It expires in 1 hour.", values: {} };
  const { ip } = await clientInfo();
  if (!email || !allow(`forgot:ip:${ip}`, 5, 10 * 60_000) || !allow(`forgot:${email}`, 3, 60 * 60_000)) return reply; // same answer either way
  const user = await u.getUserByEmail(BRAND, email);
  if (user && user.status === "active") {
    const raw = await u.createAuthToken(user.id, "reset", u.RESET_TTL_MS);
    const link = `${await linkBase()}/reset?token=${raw}`;
    await sendAccountMail({
      to: user.email,
      subject: "Reset your password",
      text: `Someone asked to reset the password for this account.\n\nChoose a new password here (the link works once and expires in 1 hour):\n${link}\n\nIf this was not you, ignore this email. Your password stays the same.`,
    });
    await u.audit(BRAND, user.id, "reset_requested", "", ip);
  } else {
    await u.audit(BRAND, user?.id, "reset_requested_no_account", "", ip);
  }
  return reply;
}

export async function resetAction(_prev, fd) {
  const token = str(fd.get("token"), 200);
  const password = str(fd.get("password"), PASSWORD_MAX * 2);
  const { ip } = await clientInfo();
  if (!allow(`reset:ip:${ip}`, 10, 10 * 60_000)) return { error: "Too many attempts. Wait a few minutes." };
  const row = await u.peekAuthToken(token, "reset");
  if (!row) return { error: INVALID_LINK };
  if (password !== str(fd.get("confirm"), PASSWORD_MAX * 2)) return { error: "The two passwords do not match." };
  const user = await u.getUser(BRAND, row.user_id);
  if (!user || user.status !== "active") return { error: INVALID_LINK };
  const problems = await checkNewPassword(password, { email: user.email, name: user.name });
  if (problems.length) return { error: problems.join(" ") };
  if (!(await u.consumeAuthToken(token, "reset"))) return { error: INVALID_LINK }; // lost a race with another use
  await u.setPassword(user.id, await hashPassword(password));
  await u.deleteUserSessions(user.id); // everyone is signed out everywhere
  await u.audit(BRAND, user.id, "password_reset", "all sessions ended", ip);
  await notify(user, "Your password was changed", "Your password was just reset and all sessions were signed out. If this was not you, contact an administrator right away.");
  redirect(`/login?${new URLSearchParams({ msg: "Password updated. Sign in with your new password.", type: "ok" })}`);
}

// ---------------- invitations and first-run setup ----------------

export async function acceptInviteAction(_prev, fd) {
  const token = str(fd.get("token"), 200);
  const name = str(fd.get("name"), 80).trim();
  const password = str(fd.get("password"), PASSWORD_MAX * 2);
  const { ip } = await clientInfo();
  if (!allow(`accept:ip:${ip}`, 10, 10 * 60_000)) return { error: "Too many attempts. Wait a few minutes.", values: { name } };
  const row = await u.peekAuthToken(token, "invite");
  if (!row) return { error: INVALID_LINK, values: { name } };
  if (name.length < 2) return { error: "Enter your name.", values: { name } };
  if (password !== str(fd.get("confirm"), PASSWORD_MAX * 2)) return { error: "The two passwords do not match.", values: { name } };
  const user = await u.getUser(BRAND, row.user_id);
  if (!user || user.status !== "invited") return { error: INVALID_LINK, values: { name } };
  const problems = await checkNewPassword(password, { email: user.email, name });
  if (problems.length) return { error: problems.join(" "), values: { name } };
  if (!(await u.consumeAuthToken(token, "invite"))) return { error: INVALID_LINK, values: { name } };
  await u.activateInvited(user.id, { name, passwordHash: await hashPassword(password) });
  await u.audit(BRAND, user.id, "invite_accepted", "", ip);
  await startSession(user.id, { mfaPassed: true });
  redirect("/");
}

export async function setupAction(_prev, fd) {
  const { ip } = await clientInfo();
  const name = str(fd.get("name"), 80).trim();
  const email = u.normEmail(str(fd.get("email"), 254));
  const values = { name, email };
  if (!allow(`setup:ip:${ip}`, 10, 10 * 60_000)) return { error: "Too many attempts. Wait a few minutes.", values };
  if ((await u.countUsers(BRAND)) > 0) redirect("/login");
  const required = process.env.SETUP_TOKEN;
  const host = (await headers()).get("host") || "";
  if (required) {
    if (!safeEqual(str(fd.get("setupToken"), 200), required)) return { error: "The setup code is not correct.", values };
  } else if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    return { error: "First-run setup from another host needs a SETUP_TOKEN. Set it in the environment and enter it here.", values };
  }
  if (name.length < 2) return { error: "Enter your name.", values };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: "Enter a valid email address.", values };
  const password = str(fd.get("password"), PASSWORD_MAX * 2);
  if (password !== str(fd.get("confirm"), PASSWORD_MAX * 2)) return { error: "The two passwords do not match.", values };
  const problems = await checkNewPassword(password, { email, name });
  if (problems.length) return { error: problems.join(" "), values };
  const id = await u.createUser(BRAND, { email, name, passwordHash: await hashPassword(password), role: "owner", verified: true });
  await u.audit(BRAND, id, "owner_created", "first-run setup", ip);
  await startSession(id, { mfaPassed: true });
  redirect("/account?msg=Account+created.+Turn+on+two-factor+sign-in+below+to+protect+it.&type=ok");
}
