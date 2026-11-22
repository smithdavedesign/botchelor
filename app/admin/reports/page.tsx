import type { Metadata } from "next";
import Link from "next/link";
import { signedInAdmin } from "../signed-in-admin";
import AdminGate from "../AdminGate";
import ReportsPanel from "../ReportsPanel";
import BansPanel from "./BansPanel";
import CompanionReportsPanel from "./CompanionReportsPanel";
import ContentReportsPanel from "./ContentReportsPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reports · Admin · Botchelor", robots: { index: false, follow: false } };

/**
 * Admin: everything people reported, in one place: complaints and takedowns from /report, reported episodes, and
 * companions' reported replies; and the bans and suspensions that stop an account, an agent or an address.
 */
export default async function AdminReportsPage() {
  const admin = await signedInAdmin();
  return (
    <article>
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Reports
      </p>
      <h1>Reports</h1>
      <AdminGate admin={admin} areas={[{ href: "/admin/reports", label: "Reports" }]}>
        <ContentReportsPanel />
        <ReportsPanel />
        <CompanionReportsPanel />
        <BansPanel />
      </AdminGate>
    </article>
  );
}
