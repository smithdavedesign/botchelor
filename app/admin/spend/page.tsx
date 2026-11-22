import type { Metadata } from "next";
import Link from "next/link";
import { signedInAdmin } from "../signed-in-admin";
import AdminGate from "../AdminGate";
import SpendPanel from "./SpendPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Spend · Admin · Botchelor", robots: { index: false, follow: false } };

/**
 * Admin: the spend tracker (lib/spend.ts). Costs (API and models, infrastructure, other) and income, month by month, and
 * each provider's live balance. For a signed-in admin account (lib/admin-auth.ts), like the other panels.
 */
export default async function AdminSpendPage() {
  const admin = await signedInAdmin();
  return (
    <article className="admin-wide">
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Spend
      </p>
      <h1>Money in and out</h1>
      <p className="muted">
        <strong>Costs</strong> are what was paid: bills, prepaid top-ups and one-offs, entered below (a monthly bill repeats by itself).{" "}
        <strong>Income</strong> comes from the app&apos;s own payment records, plus anything entered. <strong>Provider balances</strong> are read
        live from each provider that has a billing API. That&apos;s usage, shown next to the cash and never added to it, since a top-up is
        already counted when it&apos;s paid.
      </p>
      <AdminGate admin={admin} areas={[{ href: "/admin/spend", label: "Spend" }]}>
        <SpendPanel />
      </AdminGate>
    </article>
  );
}
