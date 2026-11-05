// Brand / tenant configuration.
//
// Everything that is "who is sending this" lives here and is passed around as a
// `brand` object. The discovery, mockup, and email code never hardcode a company
// name, logo, color, or address. Adding a second brand later means adding another
// entry to `brands` (or loading it from a database); no core logic changes.
//
// Values come from environment variables so no personal or business detail is
// invented in source. Anything missing is reported by brandReadiness().

export const PLACEHOLDER = {
  senderName: "[[SENDER NAME NOT SET]]",
  senderEmail: "[[SENDER EMAIL NOT SET]]",
  mailingAddress: "[[PHYSICAL MAILING ADDRESS NOT SET]]",
};

function env(name) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : "";
}

function buildAquila() {
  const senderEmail = env("SENDER_EMAIL");
  return {
    id: "aquila",
    name: "Aquila Digital LLC",
    logo: "/brands/aquila/logo.svg",
    // Flat colors sampled from aquiladigital.net. Never gradients.
    primaryColor: "#C08A2E",
    darkColor: "#0B0E13",
    senderName: env("SENDER_NAME") || PLACEHOLDER.senderName,
    senderEmail: senderEmail || PLACEHOLDER.senderEmail,
    replyTo: env("REPLY_TO_EMAIL") || senderEmail || "",
    mailingAddress: env("MAILING_ADDRESS") || PLACEHOLDER.mailingAddress,
    website: env("BRAND_WEBSITE") || "https://www.aquiladigital.net",
  };
}

export const DEFAULT_BRAND_ID = "aquila";

export function getBrand(id = DEFAULT_BRAND_ID) {
  if (id === "aquila") return buildAquila();
  throw new Error(`Unknown brand: ${id}`);
}

export function listBrandIds() {
  return ["aquila"];
}

/** Returns a list of human-readable problems that block real email sending. */
export function brandReadiness(brand) {
  const problems = [];
  if (!brand.senderName || brand.senderName.includes("[[")) problems.push("SENDER_NAME is not set.");
  if (!brand.senderEmail || brand.senderEmail.includes("[[")) problems.push("SENDER_EMAIL is not set.");
  if (!brand.mailingAddress || brand.mailingAddress.includes("[[")) {
    problems.push("MAILING_ADDRESS is not set (a real physical address is required by CAN-SPAM).");
  }
  return problems;
}
