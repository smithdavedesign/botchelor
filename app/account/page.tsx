import type { Metadata } from "next";
import AccountPanel from "./AccountPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account · Botchelor", robots: { index: false, follow: false } };

export default function AccountPage() {
  return (
    <>
      <h1>Your account</h1>
      <AccountPanel />
    </>
  );
}
