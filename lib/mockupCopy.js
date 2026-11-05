// Draft copy for the mockup. Rules from the build standards:
//  - only real retrieved data (name, category, city, phone, address) is stated as fact
//  - no invented services, prices, hours, years, certifications, or testimonials
//  - no lorem ipsum; draft text is realistic, tied to the category, and clearly labeled
//  - no dash punctuation in any copy

const GROUPS = [
  { re: /restaurant|cafe|coffee|bakery|bar|pizza|food|meal|diner|grill|kitchen/, kind: "food",
    about: (n) => `Welcome to ${n}. Tell visitors what you serve, what regulars come back for, and what the room feels like. Two or three sentences in your own words is plenty.`,
    items: ["Menu highlights (to confirm)", "Hours and how to order (to confirm)", "Catering or events (only if offered)"] },
  { re: /salon|barber|hair|beauty|nail|spa|massage|tattoo/, kind: "beauty",
    about: (n) => `${n} is a local appointment based business. Describe the experience, who the stylists or artists are, and how a first visit works, in your own words.`,
    items: ["Services offered (to confirm)", "How to book (to confirm)", "Meet the team (to confirm)"] },
  { re: /plumb|electric|hvac|roof|contractor|handyman|landscap|clean|paint|pest|locksmith|garage|repair|mechanic|auto|tire|towing/, kind: "trade",
    about: (n) => `${n} serves local customers who need work done right. Describe the kinds of jobs you take on, the area you cover, and how someone gets a quote, in your own words.`,
    items: ["Services offered (to confirm)", "Service area (to confirm)", "Licensing and insurance (only if applicable, to confirm)"] },
  { re: /dentist|doctor|clinic|chiropract|therapy|health|medical|physio|veterin|pet|vet/, kind: "care",
    about: (n) => `${n} is a local practice. Explain who you care for, how appointments work, and what a new patient or client should expect, in your own words.`,
    items: ["Services offered (to confirm)", "New client information (to confirm)", "Insurance or payment info (to confirm)"] },
  { re: /store|shop|boutique|market|florist|gift|retail|furniture|jewel|clothing|hardware/, kind: "retail",
    about: (n) => `${n} is a local shop. Share what you sell, what makes the selection yours, and when people can stop in, in your own words.`,
    items: ["What you sell (to confirm)", "Hours and parking (to confirm)", "Special orders (only if offered)"] },
  { re: /gym|fitness|yoga|dance|studio|martial|school|tutor|academy|daycare|child/, kind: "studio",
    about: (n) => `${n} welcomes people looking to learn or train locally. Describe the classes or programs, who they suit, and how to start, in your own words.`,
    items: ["Classes or programs (to confirm)", "Schedule (to confirm)", "How to get started (to confirm)"] },
];

const FALLBACK = {
  kind: "local",
  about: (n) => `${n} is a local business. Use this space to explain what you do, who you do it for, and why customers choose you, in your own words.`,
  items: ["What you offer (to confirm)", "How customers reach you (to confirm)", "Hours and location details (to confirm)"],
};

export function categoryCopy(lead) {
  const hay = `${lead.category || ""} ${lead.category_label || ""}`.toLowerCase();
  const group = GROUPS.find((g) => g.re.test(hay)) || FALLBACK;
  return { kind: group.kind, about: group.about(lead.name), items: group.items };
}

/** Phone number safe to place in a tel: link (digits and a leading plus only). */
export function telHref(phone) {
  const cleaned = String(phone || "").replace(/[^\d+]/g, "");
  return cleaned.length >= 7 ? `tel:${cleaned}` : "";
}

/** Choose black or white text for a flat background color (WCAG contrast). */
export function readableOn(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05) / (L + 0.05) >= (L + 0.05) / 0.05 ? "#ffffff" : "#111111";
}
