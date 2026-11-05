"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { BRAND, clientInfo, requireUser } from "@/lib/auth";
import { getBrand } from "@/config/brands";
import { allow } from "@/lib/ratelimit";
import { decrypt, encrypt } from "@/lib/crypto";
import { checkNewPassword, hashPassword, PASSWORD_MAX, verifyPassword } from "@/lib/passwords";
import { generateSecret, hashRecovery, newRecoveryCodes, verifyTotp } from "@/lib/totp";
import { sendAccountMail } from "@/lib/mailer";
import * as u from "@/lib/users";

const str = (v, max = 256) => String(v ?? "").slice(0, max);
const back = (msg, type = "ok") => redirect(`/account?${new URLSearchParams({ msg, type })}`);
const manage = { allowUnenrolled: true };

async function reauth(s, password) {
  if (!allow(`reauth:${s.id}`, 8, 10 * 60_000)) return "Too many attempts. Wait a few minutes.";
  const [full] = [await u.getUser(BRAND, s.id)];
  if (!full || !(await verifyPassword(str(password, PASSWORD_MAX * 2), full.password_hash))) return "Your current password is not correct.";
  return null;
}

export async function changePasswordAction(_prev, fd) {
  const s = await requireUser(manage);
  const { ip } = await clientInfo();
  const bad = await reauth(s, fd.get("current"));
  if (bad) return { error: bad };
  const next = str(fd.get("password"), PASSWORD_MAX * 2);
  if (next !== str(fd.get("confirm"), PASSWORD_MAX * 2)) return { error: "The two new passwords do not match." };
  const problems = await checkNewPassword(next, { email: s.email, name: s.name });
  if (problems.length) return { error: problems.join(" ") };
  await u.setPassword(s.id, await hashPassword(next));
  await u.deleteUserSessions(s.id, s.session_id); // every other device is signed out
  await u.audit(BRAND, s.id, "password_changed", "other sessions ended", ip);
  await sendAccountMail({ to: s.email, subject: "Your password was changed", text: `Your password was just changed and your other sessions were signed out. If this was not you, reset your password right away.\n\n${getBrand(BRAND).name}` });
  revalidatePath("/account");
  return { ok: "Password updated. Your other devices were signed out." };
}

export async function revokeSessionAction(fd) {
  const s = await requireUser(manage);
  const id = Number(fd.get("sessionId"));
  if (Number.isInteger(id) && id !== s.session_id) {
    await u.deleteSession(s.id, id); // scoped to the caller's own sessions
    await u.audit(BRAND, s.id, "session_revoked", "", (await clientInfo()).ip);
  }
  revalidatePath("/account");
  back("Session signed out.");
}

export async function revokeOthersAction() {
  const s = await requireUser(manage);
  await u.deleteUserSessions(s.id, s.session_id);
  await u.audit(BRAND, s.id, "sessions_revoked_all", "", (await clientInfo()).ip);
  revalidatePath("/account");
  back("All other devices were signed out.");
}

// ---------------- two-factor ----------------

export async function mfaStartAction() {
  const s = await requireUser(manage);
  if (s.mfa_enabled) back("Two-factor is already on.", "bad");
  await u.setMfaPending(s.id, encrypt(generateSecret()));
  revalidatePath("/account");
  back("Scan the code below with an authenticator app, then enter a code to finish.");
}

export async function mfaConfirmAction(_prev, fd) {
  const s = await requireUser(manage);
  const { ip } = await clientInfo();
  const full = await u.getUser(BRAND, s.id);
  if (!full?.mfa_pending_secret) return { error: "Start the setup again." };
  if (!allow(`mfa-setup:${s.id}`, 10, 10 * 60_000)) return { error: "Too many attempts. Wait a few minutes." };
  const secret = decrypt(full.mfa_pending_secret);
  const step = verifyTotp(secret, str(fd.get("code"), 12));
  if (step === null) return { error: "That code was not accepted. Check the time on your phone and try again." };
  const codes = newRecoveryCodes();
  await u.enableMfa(s.id, { encryptedSecret: full.mfa_pending_secret, recoveryHashes: codes.map(hashRecovery) });
  await u.setMfaStep(s.id, step);
  await u.deleteUserSessions(s.id, s.session_id);
  await u.audit(BRAND, s.id, "mfa_enabled", "", ip);
  // No revalidatePath here on purpose: re-rendering would unmount this form and the recovery
  // codes it is about to show (they are displayed only once). The page updates on next load.
  return { ok: "Two-factor sign-in is on. Your other devices were signed out.", codes };
}

export async function mfaCancelAction() {
  const s = await requireUser(manage);
  await u.setMfaPending(s.id, null);
  revalidatePath("/account");
  back("Setup cancelled.");
}

export async function regenRecoveryAction(_prev, fd) {
  const s = await requireUser(manage);
  if (!s.mfa_enabled) return { error: "Two-factor is not on." };
  const bad = await reauth(s, fd.get("current"));
  if (bad) return { error: bad };
  const codes = newRecoveryCodes();
  await u.setRecoveryCodes(s.id, codes.map(hashRecovery));
  await u.audit(BRAND, s.id, "recovery_codes_regenerated", "", (await clientInfo()).ip);
  revalidatePath("/account");
  return { ok: "New recovery codes created. The old ones no longer work.", codes };
}

export async function mfaDisableAction(_prev, fd) {
  const s = await requireUser(manage);
  const { ip } = await clientInfo();
  if (!s.mfa_enabled) return { error: "Two-factor is not on." };
  if (process.env.REQUIRE_MFA === "1") return { error: "Two-factor is required by your administrator." };
  const bad = await reauth(s, fd.get("current"));
  if (bad) return { error: bad };
  const step = verifyTotp(decrypt(s.mfa_secret), str(fd.get("code"), 12), { lastStep: Number(s.mfa_last_step) });
  if (step === null) return { error: "Enter a current code from your authenticator app." };
  await u.disableMfa(s.id);
  await u.audit(BRAND, s.id, "mfa_disabled", "", ip);
  revalidatePath("/account");
  return { ok: "Two-factor sign-in is off." };
}
