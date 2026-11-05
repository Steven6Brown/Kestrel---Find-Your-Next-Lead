import { redirect } from "next/navigation";

// The campaign list lives on the overview page; this keeps /campaigns working as a link target.
export default function Campaigns() {
  redirect("/");
}
