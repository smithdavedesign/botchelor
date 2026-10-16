import type { Metadata } from "next";
import { safeFrom } from "@/lib/age";
import AccountPanel from "./AccountPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  // ?next= (the shop's "sign in to buy"): where to go once signed in. A local path only.
  const params = await searchParams;
  const raw = params.next;
  // Back from an email confirmation link (app/api/email/confirm).
  const emailConfirmed = params.email === "confirmed" || params.email === "invalid" ? params.email : null;
  const next = typeof raw === "string" && safeFrom(raw) !== "/" ? safeFrom(raw) : null;
  return (
    <>
      <h1>Your account</h1>
      <AccountPanel next={next} emailConfirmed={emailConfirmed} />
    </>
  );
}
