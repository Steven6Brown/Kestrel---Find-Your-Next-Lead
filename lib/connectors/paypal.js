// PayPal connector. Credentials live only in server environment variables (never in the
// database, never in the browser). "Test connection" asks PayPal for a short-lived token to
// prove the credentials work. Invoicing itself comes in a later step.
import { z } from "zod";

const tokenSchema = z.object({ access_token: z.string().min(10), token_type: z.string(), expires_in: z.number() });

export const paypalBase = (mode) => (mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
export const paypalMode = (env) => (env.PAYPAL_ENV === "live" ? "live" : "sandbox");

const connector = {
  id: "paypal",
  name: "PayPal",
  description: "Create and send invoices, and check whether they are paid. Runs in PayPal's sandbox (test money) until you approve live mode.",
  mode: "env",
  envVars: ["PAYPAL_ENV", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
  requiredVars: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
  configured: (env) => !!(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
  async check({ env, fetchImpl = fetch }) {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      return { ok: false, message: "Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env.local, then restart Kestrel." };
    }
    const mode = paypalMode(env);
    if (mode === "live" && env.PAYPAL_ALLOW_LIVE !== "1") {
      return { ok: false, message: "Live mode is switched off until you approve it. Test in sandbox first. When you are ready, set PAYPAL_ALLOW_LIVE=1." };
    }
    const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
    let res;
    try {
      res = await fetchImpl(`${paypalBase(mode)}/v1/oauth2/token`, {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      return { ok: false, message: "Could not reach PayPal. Check your internet connection and try again." };
    }
    if (res.status === 401) {
      return { ok: false, message: `PayPal rejected these credentials. Check that the client id and secret came from the ${mode} tab of your app.` };
    }
    if (!res.ok) return { ok: false, message: `PayPal returned an error (status ${res.status}). Try again in a moment.` };
    let data;
    try {
      data = tokenSchema.parse(await res.json());
    } catch {
      return { ok: false, message: "PayPal sent an unexpected reply. Nothing was changed." };
    }
    void data; // the token is deliberately thrown away: this check only proves the credentials work
    return { ok: true, message: `Connected to PayPal ${mode}.`, meta: { mode } };
  },
};

export default connector;
