// The views of the prospect list. Finding, checking and redesign leads are one place with tabs.
export const PROSPECT_TABS = [
  { key: "all", label: "All prospects", href: "/leads?site=any" },
  { key: "none", label: "No website", href: "/leads" },
  { key: "social", label: "Social page only", href: "/leads?site=social" },
  { key: "has", label: "Has a website", href: "/leads?site=has" },
  { key: "redesign", label: "Redesign targets", href: "/redesign" },
  { key: "closed", label: "Closed", href: "/leads?open=closed&site=any" },
];

/** Which tab a Leads page filter set belongs to, or "" when the filters are custom. */
export function tabFor(f) {
  if (f.open === "closed") return "closed";
  if (f.site === "any") return "all";
  if (f.site === "none") return "none";
  if (f.site === "social") return "social";
  if (f.site === "has") return "has";
  return "";
}
