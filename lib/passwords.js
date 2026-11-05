// Password hashing (scrypt, salted, memory hard), policy, and breached-password check.
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const N = 32768, R = 8, P = 1, KEYLEN = 64, MAXMEM = 96 * 1024 * 1024;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password, stored) {
  const [scheme, n, r, p, salt, hash] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return crypto.timingSafeEqual(actual, expected);
}

// Verified against when the account does not exist, so response time does not reveal it.
let dummy;
export async function burnTime(password) {
  dummy ??= await hashPassword("not-a-real-password-for-timing");
  await verifyPassword(password, dummy);
}

const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "letmein", "welcome", "welcome1", "qwerty", "qwertyuiop",
  "iloveyou", "admin", "administrator", "changeme", "football", "baseball", "monkey", "dragon", "master",
  "sunshine", "princess", "trustno1", "abc123", "123456", "123456789", "1234567890", "111111", "000000",
  "aquila", "aquiladigital", "kestrel",
]);

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Policy follows NIST 800-63B: length and blocklists over composition rules. */
export function passwordProblems(password, { email = "", name = "" } = {}) {
  const p = [];
  const pw = String(password || "");
  const lower = pw.toLowerCase();
  if (pw.length < PASSWORD_MIN) p.push(`Use at least ${PASSWORD_MIN} characters.`);
  if (pw.length > PASSWORD_MAX) p.push(`Use at most ${PASSWORD_MAX} characters.`);
  const stripped = lower.replace(/[^a-z0-9]/g, "");
  if (COMMON.has(lower) || COMMON.has(stripped) || [...COMMON].some((c) => c.length >= 8 && stripped.includes(c))) {
    p.push("That password is too common.");
  }
  if (/^(.)\1+$/.test(pw)) p.push("Do not repeat a single character.");
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf|zxcv)/.test(lower) && pw.length < 16) p.push("Avoid simple sequences.");
  const local = String(email).split("@")[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) p.push("Do not include your email name.");
  const first = String(name).trim().split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && lower.includes(first)) p.push("Do not include your name.");
  return p;
}

/**
 * Have I Been Pwned range API (k-anonymity: only the first 5 characters of the SHA-1 leave
 * this machine). Fails open on any network problem. Disable with AUTH_CHECK_BREACHED=0.
 */
export async function isBreached(password, { fetchImpl = fetch, env = process.env } = {}) {
  if (env.AUTH_CHECK_BREACHED === "0") return false;
  try {
    const sha = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const suffix = sha.slice(5);
    return (await res.text()).split("\n").some((line) => {
      const [s, count] = line.trim().split(":");
      return s === suffix && Number(count) > 0;
    });
  } catch {
    return false;
  }
}

/** Full check used by every flow that sets a password. Returns a list of problems. */
export async function checkNewPassword(password, ctx, opts) {
  const problems = passwordProblems(password, ctx);
  if (!problems.length && (await isBreached(password, opts))) {
    problems.push("That password appears in known data breaches. Choose a different one.");
  }
  return problems;
}
