// Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 second step) and recovery codes.
import crypto from "node:crypto";
import { sha256 } from "./crypto.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/=+$/, "")) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Bad base32.");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(secretB32, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const off = h[h.length - 1] & 15;
  const code = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

export const stepOf = (time = Date.now(), period = 30) => Math.floor(time / 1000 / period);

/**
 * Returns the matched time step (so callers can reject replays) or null.
 * Accepts one step either side to tolerate clock drift.
 */
export function verifyTotp(secretB32, code, { time = Date.now(), window = 1, lastStep = -1 } = {}) {
  const given = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const now = stepOf(time);
  for (let w = -window; w <= window; w++) {
    const step = now + w;
    if (step <= lastStep) continue;
    const expected = hotp(secretB32, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return step;
  }
  return null;
}

export function otpauthUri({ issuer, account, secret }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---- recovery codes: shown once, stored only as hashes, each usable once ----

export function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const s = base32Encode(crypto.randomBytes(8)).toLowerCase().slice(0, 10);
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const normalizeRecovery = (c) => String(c || "").toLowerCase().replace(/[^a-z2-7]/g, "");
export const hashRecovery = (c) => sha256(normalizeRecovery(c));
