import type { Metadata } from "next";
import Link from "next/link";
import SpendPanel from "./SpendPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Spend · Admin · Botchelor", robots: { index: false, follow: false } };

/**
 * Admin: the spend tracker (lib/spend.ts). Costs (API and models, infrastructure, other) and income, month by month, and
 * each provider's live balance. Behind the admin password or an admin account, like the other panels.
 */
export default function AdminSpendPage() {
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
      <SpendPanel />
    </article>
  );
}
