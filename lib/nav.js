// The menu, in the order work actually happens: find businesses, reach out, follow up, deliver.
// Pure data and one matching rule, so it can be tested without rendering anything.
export const NAV_GROUPS = [
  {
    key: "home",
    label: "",
    items: [
      { href: "/today", label: "Today", icon: "sun", match: ["/today"] },
      { href: "/insights", label: "Insights", icon: "chart", match: ["/insights"] },
    ],
  },
  {
    key: "find",
    label: "1  Find",
    items: [
      { href: "/", label: "Scan areas", icon: "target", match: ["/", "/campaigns"] },
      { href: "/leads", label: "Prospects", icon: "list", match: ["/leads", "/redesign"] },
    ],
  },
  {
    key: "reach",
    label: "2  Reach out",
    items: [
      { href: "/queue", label: "Review drafts", icon: "mail", match: ["/queue"] },
      { href: "/social", label: "Social posts", icon: "chart", match: ["/social"] },
    ],
  },
  {
    key: "follow",
    label: "3  Follow up",
    items: [
      { href: "/pipeline", label: "Pipeline", icon: "columns", match: ["/pipeline"] },
      { href: "/calendar", label: "Calendar", icon: "calendar", match: ["/calendar", "/meetings"] },
    ],
  },
  {
    key: "deliver",
    label: "4  Deliver",
    items: [{ href: "/clients", label: "Clients and money", icon: "briefcase", match: ["/clients", "/invoices"] }],
  },
  {
    key: "settings",
    label: "Admin",
    items: [{ href: "/settings", label: "Settings", icon: "sliders", match: ["/settings", "/connections", "/users", "/audit", "/optouts", "/account"] }],
  },
];

/** Whether a menu item should be highlighted for the page being viewed. "/" only matches the home page itself. */
export function isActive(item, pathname) {
  const p = String(pathname || "");
  return item.match.some((m) => (m === "/" ? p === "/" : p === m || p.startsWith(m + "/")));
}

/** Pages under Setup, shown as a list on the Setup page. `manager` pages need an owner or admin. */
export const SETUP_ITEMS = [
  { href: "/connections", label: "Connections", text: "Booking link, PayPal, email sending, and Google Calendar.", manager: true },
  { href: "/settings/backups", label: "Backups", text: "Save a full copy of your data, check it, and get it back.", manager: true },
  { href: "/optouts", label: "Opt-outs", text: "Addresses that must never be emailed again.", manager: false },
  { href: "/users", label: "Users", text: "Invite people, change roles, reset access.", manager: true },
  { href: "/audit", label: "Audit log", text: "Who did what, and when.", manager: true },
  { href: "/account", label: "Your account", text: "Password, two factor sign in, and active sessions.", manager: false },
];

/** Initials for the avatar in the sidebar. */
export function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export const ROLE_LABELS = { owner: "Owner", admin: "Admin", member: "Member" };
