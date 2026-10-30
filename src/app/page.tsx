import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const user = await getUser();
  redirect(user ? "/dashboard" : "/login");
}
