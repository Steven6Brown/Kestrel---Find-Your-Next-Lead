// PayPal Invoicing API v2 client. Credentials come only from the server environment. Every
// response is validated with zod and treated as untrusted. Errors carry a short safe message,
// never headers, tokens, or credentials. Sandbox is the default; live needs PAYPAL_ALLOW_LIVE=1.
import { z } from "zod";
import { paypalBaseFor, paypalMode } from "./connectors/paypal.js";

export class PayPalError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = "PayPalError";
    this.status = status;
  }
}

const money = z.object({ currency_code: z.string().optional(), value: z.string() });
const invoiceSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  detail: z
    .object({
      invoice_number: z.string().optional(),
      payment_term: z.object({ due_date: z.string().optional() }).partial().optional(),
      metadata: z.object({ recipient_view_url: z.string().optional() }).partial().optional(),
    })
    .partial()
    .optional(),
  amount: money.optional(),
  due_amount: money.optional(),
  payments: z.object({ paid_amount: money.optional() }).partial().optional(),
});
const createdSchema = z.union([invoiceSchema.pick({ id: true }).passthrough(), z.object({ href: z.string().min(1) })]);
const tokenSchema = z.object({ access_token: z.string().min(10), expires_in: z.number() });

const tokens = new Map(); // cache key (mode + client id) -> { token, expiresAt }

/** Only PayPal's own https pages are accepted as a "view invoice" link. */
export function safePayPalUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && /(^|\.)paypal\.com$/i.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

const lastSegment = (href) => String(href).split("?")[0].split("/").filter(Boolean).pop();
const dollars = (cents) => (cents / 100).toFixed(2);

function safeMessage(status, body) {
  const bits = [body?.message, body?.details?.[0]?.description || body?.details?.[0]?.issue].filter((x) => typeof x === "string");
  const text = bits.join(" ").replace(/\s+/g, " ").trim().slice(0, 200);
  if (status === 401 || status === 403) return "PayPal refused the request. Check your credentials on the Connections page.";
  if (status === 429) return "PayPal says too many requests. Wait a minute and try again.";
  if (status >= 500) return "PayPal is having trouble right now. Try again in a few minutes.";
  return text ? `PayPal said: ${text}` : `PayPal could not complete that (status ${status}).`;
}

export function paypalClient({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new PayPalError("PayPal is not connected. Add your sandbox credentials on the Connections page first.");
  }
  const mode = paypalMode(env);
  if (mode === "live" && env.PAYPAL_ALLOW_LIVE !== "1") {
    throw new PayPalError("Live PayPal is switched off until you approve it. Use sandbox first.");
  }
  const base = paypalBaseFor(env);
  const cacheKey = `${mode}:${env.PAYPAL_CLIENT_ID}`;

  async function fetchJson(url, init) {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(15000) });
    } catch {
      throw new PayPalError("Could not reach PayPal. Check your internet connection and try again.");
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null; // some success responses (like send) may have no body
    }
    return { res, data };
  }

  async function token(force = false) {
    const hit = tokens.get(cacheKey);
    if (!force && hit && hit.expiresAt > now() + 60_000) return hit.token;
    const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
    const { res, data } = await fetchJson(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new PayPalError(res.status === 401 ? "PayPal rejected your credentials. Check the client id and secret." : safeMessage(res.status, data), { status: res.status });
    const parsed = tokenSchema.safeParse(data);
    if (!parsed.success) throw new PayPalError("PayPal sent an unexpected reply while signing in.");
    tokens.set(cacheKey, { token: parsed.data.access_token, expiresAt: now() + parsed.data.expires_in * 1000 });
    return parsed.data.access_token;
  }

  async function api(method, path, { body, headers = {} } = {}, retried = false) {
    const t = await token(retried);
    const { res, data } = await fetchJson(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) return api(method, path, { body, headers }, true); // expired token: sign in again once
    if (!res.ok) throw new PayPalError(safeMessage(res.status, data), { status: res.status });
    return data;
  }

  return {
    mode,

    /** Creates a draft invoice. `requestId` makes a retry safe: PayPal returns the same invoice instead of a second one. */
    async createInvoice({ requestId, recipientEmail, itemName, itemDescription = "", amountCents, currency = "USD", note = "" }) {
      const body = {
        detail: { currency_code: currency, ...(note ? { note: note.slice(0, 500) } : {}), payment_term: { term_type: "NET_30" } },
        primary_recipients: [{ billing_info: { email_address: recipientEmail } }],
        items: [{
          name: itemName.slice(0, 200),
          ...(itemDescription ? { description: itemDescription.slice(0, 1000) } : {}),
          quantity: "1",
          unit_amount: { currency_code: currency, value: dollars(amountCents) },
        }],
      };
      const data = await api("POST", "/v2/invoicing/invoices", { body, headers: { "PayPal-Request-Id": requestId, Prefer: "return=representation" } });
      const parsed = createdSchema.safeParse(data);
      if (!parsed.success) throw new PayPalError("PayPal sent an unexpected reply. Check PayPal before trying again.");
      const id = "id" in parsed.data ? parsed.data.id : lastSegment(parsed.data.href);
      if (!id) throw new PayPalError("PayPal did not return an invoice id. Check PayPal before trying again.");
      return { id };
    },

    /** Emails the invoice to the client (and a copy to you). Outward facing: callers must have the owner's confirmation. */
    async sendInvoice(invoiceId) {
      await api("POST", `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, { body: { send_to_recipient: true, send_to_invoicer: true } });
    },

    async getInvoice(invoiceId) {
      const data = await api("GET", `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
      const parsed = invoiceSchema.safeParse(data);
      if (!parsed.success) throw new PayPalError("PayPal sent an unexpected reply about this invoice.");
      return parsed.data;
    },
  };
}

export function clearPayPalTokenCache() {
  tokens.clear();
}
