// Accounts, sessions, one-time tokens, and the audit trail. All scoped by brand_id.
import { query } from "./db.js";
import { randomToken, sha256 } from "./crypto.js";

const now = () => new Date().toISOString();
const iso = (ms) => new Date(ms).toISOString();
const one = (rows) => rows[0] || null;

export const normEmail = (e) => String(e || "").trim().toLowerCase();

export const LOCKOUT_AFTER = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Idle and absolute limits. "Remember me" lengthens both.
export const SESSION = {
  normal: { idleMs: 8 * 3600 * 1000, absoluteMs: 12 * 3600 * 1000 },
  remember: { idleMs: 14 * 86400 * 1000, absoluteMs: 30 * 86400 * 1000 },
};

// ---------- users ----------

export async function countUsers(brandId) {
  return one(await query("SELECT COUNT(*)::int AS n FROM users WHERE brand_id = ?", [brandId])).n;
}

export async function createUser(brandId, { email, name, passwordHash = null, role = "member", status = "active", verified = false }) {
  const rows = await query(
    `INSERT INTO users (brand_id, email, name, password_hash, role, status, email_verified_at, password_changed_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
    [brandId, normEmail(email), name.trim(), passwordHash, role, status, verified ? now() : null, passwordHash ? now() : null, now()],
  );
  return rows[0].id;
}

export async function getUserByEmail(brandId, email) {
  return one(await query("SELECT * FROM users WHERE brand_id = ? AND email = ?", [brandId, normEmail(email)]));
}

export async function getUser(brandId, id) {
  return one(await query("SELECT * FROM users WHERE brand_id = ? AND id = ?", [brandId, id]));
}

export async function listUsers(brandId) {
  return query("SELECT * FROM users WHERE brand_id = ? ORDER BY created_at ASC", [brandId]);
}

export async function setPassword(userId, passwordHash) {
  await query(
    "UPDATE users SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?",
    [passwordHash, now(), userId],
  );
}

/** Counts a failed sign-in and locks the account after too many. Returns { locked }. */
export async function recordFailure(userId) {
  const u = one(await query("UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ? RETURNING failed_attempts", [userId]));
  if (u && u.failed_attempts >= LOCKOUT_AFTER) {
    await query("UPDATE users SET locked_until = ?, failed_attempts = 0 WHERE id = ?", [iso(Date.now() + LOCKOUT_MS), userId]);
    return { locked: true };
  }
  return { locked: false };
}

export const isLocked = (u) => !!u.locked_until && u.locked_until > now();

export async function recordSuccess(userId) {
  await query("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?", [now(), userId]);
}

export async function unlockUser(userId) {
  await query("UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?", [userId]);
}

export async function setRole(userId, role) {
  await query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
}

export async function setStatus(userId, status) {
  await query("UPDATE users SET status = ? WHERE id = ?", [status, userId]);
}

export async function activateInvited(userId, { name, passwordHash }) {
  await query(
    "UPDATE users SET name = ?, password_hash = ?, status = 'active', email_verified_at = ?, password_changed_at = ? WHERE id = ?",
    [name.trim(), passwordHash, now(), now(), userId],
  );
}

/** A user may never be left without an owner. */
export async function activeOwnerCount(brandId) {
  return one(await query("SELECT COUNT(*)::int AS n FROM users WHERE brand_id = ? AND role = 'owner' AND status = 'active'", [brandId])).n;
}

// ---------- two-factor ----------

export async function setMfaPending(userId, encryptedSecret) {
  await query("UPDATE users SET mfa_pending_secret = ? WHERE id = ?", [encryptedSecret, userId]);
}

export async function enableMfa(userId, { encryptedSecret, recoveryHashes }) {
  await query(
    "UPDATE users SET mfa_enabled = TRUE, mfa_secret = ?, mfa_pending_secret = NULL, recovery_codes = ?, mfa_last_step = -1 WHERE id = ?",
    [encryptedSecret, JSON.stringify(recoveryHashes), userId],
  );
}

export async function disableMfa(userId) {
  await query("UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_pending_secret = NULL, recovery_codes = '[]', mfa_last_step = -1 WHERE id = ?", [userId]);
}

export async function setRecoveryCodes(userId, hashes) {
  await query("UPDATE users SET recovery_codes = ? WHERE id = ?", [JSON.stringify(hashes), userId]);
}

export async function setMfaStep(userId, step) {
  await query("UPDATE users SET mfa_last_step = ? WHERE id = ?", [step, userId]);
}

/** Uses up one recovery code if it matches. Returns true when consumed. */
export async function consumeRecoveryCode(user, codeHash) {
  const codes = JSON.parse(user.recovery_codes || "[]");
  if (!codes.includes(codeHash)) return false;
  await setRecoveryCodes(user.id, codes.filter((c) => c !== codeHash));
  return true;
}

// ---------- sessions ----------

/** Creates a session and returns the raw token (only its hash is stored). */
export async function createSession(userId, { remember = false, mfaPassed = false, ip = "", userAgent = "" } = {}) {
  const raw = randomToken(32);
  const cfg = remember ? SESSION.remember : SESSION.normal;
  await query(
    `INSERT INTO sessions (token_hash, user_id, remember, mfa_passed, ip, user_agent, created_at, last_seen_at, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [sha256(raw), userId, remember, mfaPassed, ip.slice(0, 64), userAgent.slice(0, 200), now(), now(), iso(Date.now() + cfg.absoluteMs)],
  );
  return raw;
}

/** Looks up a live session and its user. Returns null if missing, expired, idle, or the user is not active. */
export async function getSession(rawToken, { touch = true } = {}) {
  if (!rawToken) return null;
  const s = one(await query(
    `SELECT s.id AS session_id, s.remember, s.mfa_passed, s.last_seen_at, s.expires_at, s.created_at AS session_created,
            u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    [sha256(rawToken)],
  ));
  if (!s) return null;
  const cfg = s.remember ? SESSION.remember : SESSION.normal;
  const idleExpired = Date.parse(s.last_seen_at) + cfg.idleMs < Date.now();
  if (s.expires_at < now() || idleExpired || s.status !== "active") {
    await query("DELETE FROM sessions WHERE id = ?", [s.session_id]);
    return null;
  }
  if (touch && Date.now() - Date.parse(s.last_seen_at) > 60_000) {
    await query("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [now(), s.session_id]);
  }
  return s;
}

export async function markSessionMfa(sessionId) {
  await query("UPDATE sessions SET mfa_passed = TRUE WHERE id = ?", [sessionId]);
}

export async function deleteSessionByToken(rawToken) {
  if (rawToken) await query("DELETE FROM sessions WHERE token_hash = ?", [sha256(rawToken)]);
}

export async function deleteUserSessions(userId, exceptSessionId = null) {
  if (exceptSessionId) await query("DELETE FROM sessions WHERE user_id = ? AND id != ?", [userId, exceptSessionId]);
  else await query("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

export async function deleteSession(userId, sessionId) {
  await query("DELETE FROM sessions WHERE user_id = ? AND id = ?", [userId, sessionId]);
}

export async function listSessions(userId) {
  return query("SELECT id, ip, user_agent, created_at, last_seen_at, remember, mfa_passed FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC", [userId]);
}

// ---------- one-time tokens (password reset and invitations) ----------

/** Issues a token, voiding earlier unused ones of the same kind. Returns the raw token. */
export async function createAuthToken(userId, kind, ttlMs) {
  await query("UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL", [now(), userId, kind]);
  const raw = randomToken(32);
  await query("INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at, created_at) VALUES (?,?,?,?,?)",
    [userId, kind, sha256(raw), iso(Date.now() + ttlMs), now()]);
  return raw;
}

/** Checks a token without using it (so opening the page does not burn the link). */
export async function peekAuthToken(raw, kind) {
  if (!raw || raw.length > 200) return null;
  return one(await query(
    "SELECT * FROM auth_tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?",
    [sha256(raw), kind, now()],
  ));
}

/** Atomically uses a token. Returns the row once, then null for every later attempt. */
export async function consumeAuthToken(raw, kind) {
  if (!raw || raw.length > 200) return null;
  return one(await query(
    "UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ? RETURNING *",
    [now(), sha256(raw), kind, now()],
  ));
}

// ---------- audit trail ----------

export async function audit(brandId, userId, event, detail = "", ip = "") {
  await query("INSERT INTO audit_log (brand_id, user_id, event, detail, ip, created_at) VALUES (?,?,?,?,?,?)",
    [brandId, userId || null, event, String(detail).slice(0, 300), ip.slice(0, 64), now()]);
}

export async function listAudit(brandId, { userId, limit = 100 } = {}) {
  const args = [brandId];
  let where = "a.brand_id = ?";
  if (userId) { where += " AND a.user_id = ?"; args.push(userId); }
  args.push(limit);
  return query(
    `SELECT a.*, u.email AS user_email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE ${where} ORDER BY a.id DESC LIMIT ?`,
    args,
  );
}
