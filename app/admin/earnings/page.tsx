import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { showEarnings, type ShowEarnings } from "@/lib/money/earnings";
import AdminGate from "../AdminGate";
import { signedInAdmin } from "../signed-in-admin";
import RecordPayout from "./RecordPayout";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Earnings · Admin · Botchelor", robots: { index: false, follow: false } };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Admin: creators' earnings and the show's (lib/money/earnings.ts showEarnings), the owner's side of /earnings. Every
 * paid tip and template sale, Stripe's estimated fees, the creators' share and the show's, and each creator's balance
 * with where they asked to be paid. Paying is by hand; "Record payout" takes it off their balance.
 */
export default async function AdminEarningsPage() {
  const admin = await signedInAdmin();
  const e: ShowEarnings | null = admin ? await getDb().then((db) => showEarnings(db)).catch(() => null) : null;
  return (
    <article className="admin-wide">
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Earnings
      </p>
      <h1>Creators&apos; earnings</h1>
      <p className="muted">
        Paid tips and template sales. Tips go to the creator after Stripe&apos;s fee (estimated at 2.9% + 30¢); a template sale pays
        its creator 70% of the price. Pay by hand (PayPal, Wise, a bank), then record it here so their balance goes down. Creators see
        their own side at <Link href="/earnings">/earnings</Link>.
      </p>
      <AdminGate admin={admin} areas={[{ href: "/admin/earnings", label: "Earnings" }]}>
        {e ? (
          <>
            <div className="admin-tiles" data-show-earnings>
              <p>
                <strong>{dollars(e.gross_cents)}</strong> taken in
              </p>
              <p>
                <strong>{dollars(e.fees_cents)}</strong> Stripe fees (est.)
              </p>
              <p>
                <strong>{dollars(e.creators_cents)}</strong> creators&apos; share
              </p>
              <p>
                <strong>{dollars(e.show_cents)}</strong> the show keeps
              </p>
              <p>
                <strong>{dollars(e.paid_out_cents)}</strong> paid out
              </p>
              <p>
                <strong data-owed-all>{dollars(e.owed_cents)}</strong> still owed
              </p>
            </div>
            <h2>Balances</h2>
            {e.creators.length === 0 ? (
              <p className="muted">No creator has earned anything yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th>Tips</th>
                    <th>Sales</th>
                    <th>Earned</th>
                    <th>Paid out</th>
                    <th>Owed</th>
                    <th>Send to</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {e.creators.map((c) => (
                    <tr key={c.user_id} data-creator={c.user_id}>
                      <td>{c.handle ? `@${c.handle}` : <code>{c.user_id.slice(0, 8)}</code>}</td>
                      <td>{c.tips}</td>
                      <td>{c.sales}</td>
                      <td>{dollars(c.earned_cents)}</td>
                      <td>{dollars(c.paid_out_cents)}</td>
                      <td>
                        <strong>{dollars(c.owed_cents)}</strong>
                      </td>
                      <td>{c.method ? `${c.method.method}: ${c.method.handle}` : <span className="muted">not set</span>}</td>
                      <td>{c.owed_cents > 0 && <RecordPayout userId={c.user_id} owedCents={c.owed_cents} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h2>Recent</h2>
            <ul className="plain">
              {e.recent.map((l, i) => (
                <li key={i}>
                  {l.kind === "tip" ? "Tip" : "Template sale"}
                  {l.character ? ` · ${l.character.name}` : ""} · {dollars(l.gross_cents)} → {dollars(l.share_cents)} to the creator ·{" "}
                  <span className="muted small">{l.at.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">Couldn&apos;t read the earnings just now.</p>
        )}
      </AdminGate>
    </article>
  );
}
