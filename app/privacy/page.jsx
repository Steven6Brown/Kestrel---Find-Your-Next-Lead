import PublicShell from "@/components/PublicShell";
import { product } from "@/config/product";

export const metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return (
    <PublicShell>
      <h1 className="text-4xl font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-muted">Draft for review. This is not legal advice.</p>
      <div className="mt-6 space-y-4 text-lg leading-relaxed">
        <p>{product.name} is operated by Aquila Digital LLC. It helps a small web design business find local businesses that do not have a website and send a short, reviewed introduction.</p>
        <h2 className="pt-2 text-2xl font-semibold">What we collect</h2>
        <p>Business details that are already public in online listings (Google Places or OpenStreetMap): name, category, address, phone number, and website if one exists. If we email a business, we also keep the business email address we used and whether the message was sent.</p>
        <h2 className="pt-2 text-2xl font-semibold">Why</h2>
        <p>Only to create a one time concept page and introduction for that business, and to honor opt-out requests. We do not sell this information.</p>
        <h2 className="pt-2 text-2xl font-semibold">Who processes it</h2>
        <p>Google or OpenStreetMap (listing data), our email provider Resend (message delivery), and our hosting provider. Concept pages are unlisted and hidden from search engines.</p>
        <h2 className="pt-2 text-2xl font-semibold">Opting out and removal</h2>
        <p>Use the unsubscribe link in any email, or reply with the word STOP. We honor opt-outs promptly and within 10 days, and we keep your address on a suppression list so we do not contact you again. To ask for your listing details or concept page to be removed, reply to the email you received.</p>
        <p>This site uses no analytics and sets no tracking cookies.</p>
      </div>
    </PublicShell>
  );
}
