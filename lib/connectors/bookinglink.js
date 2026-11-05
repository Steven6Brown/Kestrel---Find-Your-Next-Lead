// Booking link connector: the owner's own Google Calendar appointment page (or Cal.com, Calendly).
// Kestrel only stores and shows the link; it never calls it, so there is nothing to attack and
// nothing to authorize. Validation keeps the link safe to put in emails and on concept pages.
import { z } from "zod";

const BLOCKED_HOST = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const schema = z.string().trim().max(300).superRefine((value, ctx) => {
  let u;
  try {
    u = new URL(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Enter the full link, starting with https://" });
    return;
  }
  if (u.protocol !== "https:") ctx.addIssue({ code: "custom", message: "The link must start with https://" });
  if (u.username || u.password) ctx.addIssue({ code: "custom", message: "The link cannot contain a username or password." });
  if (!u.hostname.includes(".") || BLOCKED_HOST.test(u.hostname) || IPV4.test(u.hostname) || u.hostname.includes(":")) {
    ctx.addIssue({ code: "custom", message: "Use a public website address, not a local or numeric one." });
  }
});

/** Returns { ok, value } with a normalized URL, or { ok: false, error }. */
export function validateBookingLink(input) {
  const r = schema.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0].message };
  const u = new URL(r.data);
  u.hash = "";
  return { ok: true, value: u.toString() };
}

const connector = {
  id: "booking_link",
  name: "Booking link",
  description: "Your Google Calendar appointment page (or Cal.com or Calendly). Added to outreach drafts and concept pages so people can pick a time.",
  mode: "setting",
  validate: validateBookingLink,
  async check({ connection }) {
    const url = JSON.parse(connection?.config || "{}").url;
    const v = validateBookingLink(url);
    return v.ok ? { ok: true, message: "Link saved." } : { ok: false, message: v.error };
  },
};

export default connector;
