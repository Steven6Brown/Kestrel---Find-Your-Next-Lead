import crypto from "node:crypto";
import { appSecret } from "./secret.js";

export const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

const key = () => crypto.createHash("sha256").update(`sitescout-at-rest|${appSecret()}`).digest();

/** AES-256-GCM. Used to keep two-factor secrets unreadable if the database is copied. */
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(blob) {
  const [v, iv, tag, ct] = String(blob).split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Bad ciphertext.");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
