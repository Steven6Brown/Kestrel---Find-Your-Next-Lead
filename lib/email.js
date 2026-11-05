// Phase 3: outreach drafting and guarded sending. Nothing in here names a company;
// every sender detail comes from the `brand` object passed in.
import { brandReadiness } from "../config/brands.js";
import { unsubscribeUrl, baseUrl, isPublicHttps } from "./tokens.js";
import { isSuppressed } from "./store.js";
import { auditOf, longDate } from "./redesign.js";

export const UNSUB_TOKEN = "{{UNSUBSCRIBE_URL}}";
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

export const isValidEmail = (e) => EMAIL_RE.test(String(e || "").trim());

/**
 * Build the cold email for one no-website lead. The unsubscribe link is a token
 * resolved at send time, because it is signed for the actual recipient address.
 */
export function buildDraft({ lead, brand, mockupLink, bookingLink = "" }) {
  const where = lead.city ? ` in ${lead.city}` : "";
  const facts = lead.phone
    ? "your business name, category, city, and phone number"
    : "your business name, category, and city";
  const subject = `A quick website concept for ${lead.name}`;
  const body = [
    `Hi ${lead.name} team,`,
    "",
    `My name is ${brand.senderName} and I run ${brand.name}, a small web design company. While looking at local businesses${where}, I noticed your public business listing does not show a website, so I put together a quick concept of what one could look like:`,
    "",
    mockupLink,
    "",
    `It is only a draft built from the public details in your business listing (${facts}). Anything I could not confirm is left as a clearly marked placeholder, and none of it should be treated as accurate until you have reviewed it.`,
    "",
    `If it is useful, just reply to this email and I will explain how a real site could work for ${lead.name}. If it is not, no problem, and nothing more is needed from you.`,
    ...(bookingLink ? ["", `If it is easier, you can pick a time to talk here: ${bookingLink}`] : []),
    "",
    "Thanks for your time,",
    brand.senderName,
    brand.name,
    brand.mailingAddress,
    "",
    `You are receiving this because your business is listed publicly in online directories. To opt out of future email from us, open ${UNSUB_TOKEN} or reply with the word STOP. Opt outs are honored promptly and always within 10 days.`,
  ].join("\n");
  return { subject, body };
}

/**
 * Cold email for a business that has a website that scored low. Says plainly what was looked at (an
 * automated read of the home page), lists only what that check found, and links a concept page that
 * copies nothing from their site. Same footer, address and opt out rules as the no website email.
 */
export function buildRedesignDraft({ lead, brand, mockupLink, bookingLink = "" }) {
  const audit = auditOf(lead);
  if (!audit) throw new Error("This lead has no website quality check to base a redesign email on.");
  const where = lead.city ? ` in ${lead.city}` : "";
  const facts = lead.phone ? "your business name, category, city, and phone number" : "your business name, category, and city";
  const when = longDate(audit.checkedAt);
  const found = audit.reasons.slice(0, 3).map((r, i) => `${i + 1}. ${r}`);
  const subject = `A few ideas for the ${lead.name} website`;
  const body = [
    `Hi ${lead.name} team,`,
    "",
    `My name is ${brand.senderName} and I run ${brand.name}, a small web design company. While looking at local businesses${where}, I took a quick look at the home page of ${audit.website} and noticed a few things that may be making it harder for customers to reach you:`,
    "",
    ...found,
    "",
    `Those come from an automated read of your home page${when ? ` on ${when}` : ""}. It can miss things and does not tell the whole story, so please take it as a starting point.`,
    "",
    "I also put together a quick concept of what a refreshed site could look like:",
    "",
    mockupLink,
    "",
    `It is only a draft built from the public details in your business listing (${facts}). Nothing was copied from your current site, anything I could not confirm is left as a clearly marked placeholder, and none of it should be treated as accurate until you have reviewed it.`,
    "",
    `If it is useful, just reply to this email and I will explain how a real site could work for ${lead.name}. If it is not, no problem, and nothing more is needed from you.`,
    ...(bookingLink ? ["", `If it is easier, you can pick a time to talk here: ${bookingLink}`] : []),
    "",
    "Thanks for your time,",
    brand.senderName,
    brand.name,
    brand.mailingAddress,
    "",
    `You are receiving this because your business is listed publicly in online directories. To opt out of future email from us, open ${UNSUB_TOKEN} or reply with the word STOP. Opt outs are honored promptly and always within 10 days.`,
  ].join("\n");
  return { subject, body };
}

export function resolveBody(body, { brand, email }) {
  const url = email && isValidEmail(email) ? unsubscribeUrl(brand.id, email) : "[unsubscribe link will be created once a recipient email is saved]";
  return body.split(UNSUB_TOKEN).join(url);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function textToHtml(text) {
  const linked = esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1b1f23">${linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`;
}

/**
 * Every condition that must hold before a real email goes out.
 * Returns a list of problems; an empty list means sending is allowed.
 */
export async function sendProblems({ lead, draft, brand, sentToday, env = process.env }) {
  const p = [...brandReadiness(brand)];
  if (!draft) return [...p, "No draft exists for this lead."];
  if (draft.status !== "approved") p.push("The draft must be approved first.");
  if (lead.status === "do_not_contact") p.push("This lead is marked do not contact.");
  if (lead.closed_at) p.push("This business is marked closed.");
  if (!isValidEmail(lead.contact_email)) p.push("Save a valid recipient email on the lead first.");
  else if (await isSuppressed(brand.id, lead.contact_email)) p.push("This address has opted out.");
  if (!draft.body.includes(UNSUB_TOKEN)) p.push("The body must contain the unsubscribe link placeholder.");
  if (brand.mailingAddress && !brand.mailingAddress.includes("[[") && !draft.body.includes(brand.mailingAddress)) {
    p.push("The body must include the brand's physical mailing address.");
  }
  if (/\[\[.*\]\]/.test(draft.body)) p.push("The body still contains an unfilled placeholder.");
  if (!draft.subject.trim()) p.push("Subject is empty.");
  if (!env.RESEND_API_KEY) p.push("RESEND_API_KEY is not set.");
    if (!isPublicHttps(baseUrl())) p.push("APP_BASE_URL must be a public https URL so mockup and opt-out links work for recipients.");
  const cap = Number(env.SEND_DAILY_CAP || 10);
  if (sentToday >= cap) p.push(`Daily send cap reached (${cap}). Raise SEND_DAILY_CAP only if you trust your results.`);
  return p;
}

export async function sendViaResend({ brand, to, subject, body, fetchImpl = fetch, apiKey = process.env.RESEND_API_KEY }) {
  const text = resolveBody(body, { brand, email: to });
  // One-click (RFC 8058) POSTs go to the API route; people clicking the body link get a confirm page.
  const unsub = unsubscribeUrl(brand.id, to, "/api/unsubscribe");
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${brand.senderName} <${brand.senderEmail}>`,
      to: [to],
      reply_to: brand.replyTo || brand.senderEmail,
      subject,
      text,
      html: textToHtml(text),
      headers: {
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${data?.message || "request failed"}`);
  return { id: data.id };
}
