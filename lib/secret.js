// The app secret signs unsubscribe links and encrypts two-factor secrets.
// Production and Vercel must set APP_SECRET. For local use only, a random secret is
// generated once and kept in data/.secret (git-ignored) so setup needs nothing.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appDataDir, migrateLegacyData } from "./appdir.js";

let cached;

export function appSecret() {
  const env = process.env.APP_SECRET;
  if (env && env.length >= 16) return env;
  if (cached) return cached;
  if (process.env.VERCEL) throw new Error("APP_SECRET must be set (16+ characters).");
  if (!process.env.KESTREL_DATA_DIR) migrateLegacyData(); // brings the old secret along before a new one is made
  const file = path.join(appDataDir(), ".secret");
  try {
    cached = fs.readFileSync(file, "utf8").trim();
    if (cached.length >= 32) return cached;
  } catch {
    /* create below */
  }
  cached = crypto.randomBytes(48).toString("base64url");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, cached, { mode: 0o600 });
  return cached;
}
