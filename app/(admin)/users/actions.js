"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BRAND, clientInfo, linkBase, requireUser } from "@/lib/auth";
import { getBrand } from "@/config/brands";
import { mailConfigured, sendAccountMail } from "@/lib/mailer";
import * as u from "@/lib/users";

const managers = { roles: ["owner", "admin"] };
const back = (msg, type = "ok") => redirect(`/users?${new URLSearchParams({ msg, type })}`);
const idSchema = z.coerce.number().int().positive();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Admins manage members and other admins; only an owner may touch owners or grant owner. */
function canManage(actor, target, newRole) {
  if (actor.role === "owner") return true;
  if (target.role === "owner" || newRole === "owner") return false;
  return true;
}

export async function inviteUserAction(_prev, fd) {
  const actor = await requireUser(managers);
  const email = u.normEmail(String(fd.get("email") || "").slice(0, 254));
  const role = z.enum(["admin", "member"]).safeParse(fd.get("role"));
  if (!EMAIL.test(email)) return { error: "Enter a valid email address.", values: { email } };
  if (!role.success) return { error: "Choose a role.", values: { email } };
  if (actor.role !== "owner" && role.data === "admin") return { error: "Only an owner can invite administrators.", values: { email } };
  let user = await u.getUserByEmail(BRAND, email);
  if (user && user.status !== "invited") return { error: "That person already has an account.", values: { email } };
  if (!user) {
    const id = await u.createUser(BRAND, { email, name: email, role: role.data, status: "invited" });
    user = await u.getUser(BRAND, id);
  } else {
    await u.setRole(user.id, role.data); // re-inviting updates the role and replaces the old link
  }
  const raw = await u.createAuthToken(user.id, "invite", u.INVITE_TTL_MS);
  const link = `${await linkBase()}/accept?token=${raw}`;
  const brand = getBrand(BRAND);
  const sent = await sendAccountMail({
    to: email,
    subject: `You are invited to ${brand.name}`,
    text: `${actor.name} invited you to join ${brand.name}.\n\nSet up your account here (works once, expires in 7 days):\n${link}`,
  });
  await u.audit(BRAND, actor.id, "user_invited", `${email} as ${role.data}`, (await clientInfo()).ip);
  revalidatePath("/users");
  if (sent.delivered) return { ok: `Invitation emailed to ${email}.`, values: {} };
  return {
    ok: mailConfigured() ? "Email could not be sent. Share this link with them yourself:" + ` ${link}` : `Email is not set up, so share this link with them yourself (it works once): ${link}`,
    values: {},
  };
}

async function target(actor, fd) {
  const id = idSchema.parse(fd.get("userId"));
  const t = await u.getUser(BRAND, id);
  if (!t) back("User not found.", "bad");
  return t;
}

export async function setRoleAction(fd) {
  const actor = await requireUser(managers);
  const t = await target(actor, fd);
  const role = z.enum(["owner", "admin", "member"]).parse(fd.get("role"));
  if (!canManage(actor, t, role)) back("You do not have permission to change that role.", "bad");
  if (t.role === "owner" && role !== "owner" && (await u.activeOwnerCount(BRAND)) <= 1) back("There must always be at least one owner.", "bad");
  await u.setRole(t.id, role);
  await u.deleteUserSessions(t.id); // permissions changed, so sessions are re-issued
  await u.audit(BRAND, actor.id, "role_changed", `${t.email}: ${t.role} to ${role}`, (await clientInfo()).ip);
  revalidatePath("/users");
  back("Role updated. Their sessions were signed out.");
}

export async function setStatusAction(fd) {
  const actor = await requireUser(managers);
  const t = await target(actor, fd);
  const disable = fd.get("disable") === "true";
  if (t.id === actor.id) back("You cannot disable your own account.", "bad");
  if (!canManage(actor, t)) back("You do not have permission to change that account.", "bad");
  if (disable && t.role === "owner" && (await u.activeOwnerCount(BRAND)) <= 1) back("There must always be at least one owner.", "bad");
  await u.setStatus(t.id, disable ? "disabled" : t.password_hash ? "active" : "invited");
  if (disable) await u.deleteUserSessions(t.id);
  await u.audit(BRAND, actor.id, disable ? "user_disabled" : "user_enabled", t.email, (await clientInfo()).ip);
  revalidatePath("/users");
  back(disable ? "Account disabled and signed out." : "Account enabled.");
}

export async function unlockAction(fd) {
  const actor = await requireUser(managers);
  const t = await target(actor, fd);
  await u.unlockUser(t.id);
  await u.audit(BRAND, actor.id, "user_unlocked", t.email, (await clientInfo()).ip);
  revalidatePath("/users");
  back("Account unlocked.");
}

export async function sendResetAction(fd) {
  const actor = await requireUser(managers);
  const t = await target(actor, fd);
  if (t.status !== "active") back("Only active accounts can be sent a reset link.", "bad");
  if (!canManage(actor, t)) back("You do not have permission to do that.", "bad");
  const raw = await u.createAuthToken(t.id, "reset", u.RESET_TTL_MS);
  const link = `${await linkBase()}/reset?token=${raw}`;
  const sent = await sendAccountMail({ to: t.email, subject: "Reset your password", text: `An administrator sent you a password reset link (works once, expires in 1 hour):\n${link}` });
  await u.audit(BRAND, actor.id, "reset_sent_by_admin", t.email, (await clientInfo()).ip);
  back(sent.delivered ? "Reset link emailed." : "Email is not set up, so the link was not delivered.", sent.delivered ? "ok" : "bad");
}
