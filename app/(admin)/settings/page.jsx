import Link from "next/link";
import { isManager, requireUser } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import Icon from "@/components/Icon";
import { DEFAULT_BRAND_ID, getBrand, brandReadiness } from "@/config/brands";
import { baseUrl, isPublicHttps } from "@/lib/tokens";
import { provider } from "@/lib/discovery";
import { SETUP_ITEMS } from "@/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function Setup() {
  const user = await requireUser();
  const brand = getBrand(DEFAULT_BRAND_ID);
  const items = SETUP_ITEMS.filter((i) => !i.manager || isManager(user));
  const emailSetup = [
    ...brandReadiness(brand),
    ...(process.env.RESEND_API_KEY ? [] : ["RESEND_API_KEY is not set, so sending is disabled."]),
    ...(isPublicHttps(baseUrl()) ? [] : ["APP_BASE_URL is not a public https URL, so emailed links would not work for recipients."]),
  ];
  const scanIssues = provider() === "google" && !process.env.GOOGLE_PLACES_API_KEY ? ["DISCOVERY_PROVIDER is google but GOOGLE_PLACES_API_KEY is not set."] : [];

  return (
    <div className="reveal">
      <PageHeader title="Settings" subtitle="Connections, people, and the rules that keep outreach safe. Daily work lives in the menu on the left." />

      <ul className="card divide-y divide-line">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="flex min-h-[64px] items-center justify-between gap-4 p-4 hover:bg-paper">
              <span>
                <span className="block font-semibold text-ink">{i.label}</span>
                <span className="block text-sm text-muted">{i.text}</span>
              </span>
              <span className="text-muted"><Icon name="chevron" /></span>
            </Link>
          </li>
        ))}
      </ul>

      {scanIssues.length > 0 && (
        <section aria-labelledby="scan-h" className="mt-8 border border-warn bg-warn-bg p-4 text-warn">
          <h2 id="scan-h" className="text-xl font-semibold !text-warn">Scanner setup needed</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">{scanIssues.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      )}

      <section aria-labelledby="email-h" className="card mt-8 p-5">
        <h2 id="email-h" className="text-xl font-semibold">Email setup</h2>
        {emailSetup.length === 0 ? (
          <p className="mt-2 text-muted">Everything needed to send is in place. Nothing is ever sent without your approval.</p>
        ) : (
          <>
            <p className="mt-2 text-muted">Only needed before you send for real. It is safe to skip while you are testing.</p>
            <ul className="mt-3 list-disc space-y-1 pl-5">{emailSetup.map((t) => <li key={t}>{t}</li>)}</ul>
          </>
        )}
      </section>
    </div>
  );
}
