import PublicShell from "@/components/PublicShell";
import { getBrand, DEFAULT_BRAND_ID } from "@/config/brands";

export const metadata = { title: "Accessibility Statement" };

export default function Accessibility() {
  const brand = getBrand(DEFAULT_BRAND_ID);
  return (
    <PublicShell>
      <h1 className="text-4xl font-extrabold">Accessibility Statement</h1>
      <div className="mt-6 space-y-4 text-lg leading-relaxed">
        <p>We aim to meet WCAG 2.1 level AA. The pages include a skip link, landmarks, visible focus, labeled form fields, sufficient color contrast, 44 pixel touch targets, and respect for reduced motion settings.</p>
        <p>This is a target, not a certification. A formal third party audit has not been done, and screen reader testing has not yet been completed.</p>
        <p>
          If something is hard to use, please tell us
          {brand.replyTo ? (
            <> at <a className="underline underline-offset-4" href={`mailto:${brand.replyTo}`}>{brand.replyTo}</a></>
          ) : " by replying to the email you received"}
          , and we will work to fix it.
        </p>
      </div>
    </PublicShell>
  );
}
