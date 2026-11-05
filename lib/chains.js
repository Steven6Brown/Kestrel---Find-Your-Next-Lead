// Websites the quality audit should not score, because rebuilding them is not a sale:
//   chain   national chains and franchise location pages (head office runs the website)
//   listing a directory, booking or ordering page that is not the business's own website
// Both rules are deliberately narrow. Wrongly hiding a local business is worse than showing a chain,
// so anything uncertain is audited as usual.
import { nameTokens } from "./matchsites.js";

// Common US chains seen in local business data, matched on the whole business name.
const CHAIN_NAMES = [
  "starbucks", "supercuts", "great clips", "sport clips", "cost cutters", "fantastic sams", "regis salon", "tim hortons", "dunkin", "mcdonalds", "subway",
  "burger king", "wendys", "taco bell", "kfc", "pizza hut", "dominos", "papa johns", "little caesars", "panera bread", "chipotle", "arbys", "dairy queen",
  "jimmy johns", "firehouse subs", "jersey mikes", "five guys", "popeyes", "chick fil a", "sonic drive in", "applebees", "ihop", "dennys", "waffle house",
  "walgreens", "cvs", "rite aid", "walmart", "target", "kroger", "7 eleven", "speedway", "marathon", "shell", "bp", "sunoco", "dollar general", "family dollar",
  "aspen dental", "heartland dental", "h r block", "jackson hewitt", "einstein bros", "caribou coffee", "krispy kreme", "baskin robbins", "7 brew", "wingstop",
  "peace love and little donuts",
];
const CHAIN_TOKENS = CHAIN_NAMES.map((n) => nameTokens(n).join(" "));

// Sites where a business has a page but not a website of its own.
const LISTING_HOSTS = [
  "groupon.com", "yelp.com", "yellowpages.com", "mapquest.com", "tripadvisor.com", "businessfinder.cleveland.com", "book.squareup.com", "opentable.com",
  "doordash.com", "ubereats.com", "grubhub.com", "order.toasttab.com", "vagaro.com", "fresha.com", "styleseat.com", "schedulicity.com", "nextdoor.com", "bbb.org",
];

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * Whether a lead's website should be skipped, and why: { status: "chain" | "listing", reason } or null.
 */
export function skipReason(lead) {
  const name = nameTokens(lead.name).join(" ");
  // One word names (Target, Shell, Subway) are everyday words, so they must be the whole name.
  // Longer chain names can appear with a location after them ("Great Clips Akron").
  if (name && CHAIN_TOKENS.some((c) => name === c || (c.includes(" ") && (name.startsWith(c + " ") || name.endsWith(" " + c) || name.includes(" " + c + " "))))) {
    return { status: "chain", reason: "National chain, so its website is run by head office." };
  }
  let u;
  try {
    u = new URL(lead.website);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (LISTING_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
    return { status: "listing", reason: "This is a directory, booking or ordering page, not the business's own website." };
  }
  if (/^(locations?|stores?)\./.test(host) && u.pathname.length > 1) return { status: "chain", reason: "Franchise location page on a corporate site." };
  if (/\/(store-locator|find-a-store|locations?)\/[^/]+/i.test(u.pathname)) return { status: "chain", reason: "Franchise location page on a corporate site." };
  return null;
}

export { hostOf };
