// Account email (password reset, invitations, security notices).
// With RESEND_API_KEY and SENDER_EMAIL set it sends through Resend. With no mail setup it
// appends to outbox.log in the app data folder (see lib/appdir.js) instead, so you can test reset and invite links locally.
// The outbox is never used on Vercel (links in a log would be a secret leak).
import fs from "node:fs";
import path from "node:path";
import { appDataDir } from "./appdir.js";

export function mailConfigured(env = process.env) {
  return !!(env.RESEND_API_KEY && env.SENDER_EMAIL);
}

export async function sendAccountMail({ to, subject, text }, { fetchImpl = fetch, env = process.env } = {}) {
  if (mailConfigured(env)) {
    try {
      const from = env.SENDER_NAME ? `${env.SENDER_NAME} <${env.SENDER_EMAIL}>` : env.SENDER_EMAIL;
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(15000),
      });
      return { delivered: res.ok, via: "resend" };
    } catch {
      return { delivered: false, via: "resend" };
    }
  }
  if (env.VERCEL) return { delivered: false, via: "none" };
  const file = path.join(appDataDir(), "outbox.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `\n=== ${new Date().toISOString()} to ${to}\nSubject: ${subject}\n\n${text}\n`, { mode: 0o600 });
  return { delivered: false, via: "outbox" };
}
