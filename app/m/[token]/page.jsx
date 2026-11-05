import { notFound } from "next/navigation";
import Mockup from "@/components/Mockup";
import { getLeadByToken } from "@/lib/store";
import { getBrand } from "@/config/brands";

// Hosted concept page. Public by design (unguessable 128 bit token), never indexed.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { token } = await params;
  const lead = getLeadByToken(token);
  return {
    title: lead ? `Website concept for ${lead.name}` : "Not found",
    robots: { index: false, follow: false },
  };
}

export default async function MockupPage({ params }) {
  const { token } = await params;
  const lead = getLeadByToken(token);
  if (!lead || lead.bucket !== "no_website" || lead.status === "do_not_contact") notFound();
  return <Mockup lead={lead} brand={getBrand(lead.brand_id)} />;
}
