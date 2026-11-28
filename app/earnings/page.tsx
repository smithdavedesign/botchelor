import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { getT } from "@/lib/i18n/server";
import { earningsOf, PAYOUT_MINIMUM_CENTS, type Earnings } from "@/lib/money/earnings";
import PayoutMethodForm from "./PayoutMethodForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your earnings · Botchelor", robots: { index: false, follow: false } };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * A creator's earnings (lib/money/earnings.ts; David, 2026-11-28): what their characters made from tips and template
 * sales, their share under the terms, what's been paid out and what's still owed, and where to send it. The owner's
 * view of the same numbers is /admin/earnings.
 */
export default async function EarningsPage() {
  const t = await getT();
  const auth = authFromCookieStore(await cookies());
  let e: Earnings | null = null;
  if (auth) e = await getDb().then((db) => earningsOf(db, auth.userId)).catch(() => null);
  return (
    <article className="earnings">
      <h1>{t("Your earnings")}</h1>
      <p className="muted">{t("What your characters have earned from tips and template sales, your share, and what we still owe you.")}</p>
      <div className="earnings-tiles" data-earnings>
        <div className="card">
          <p className="kicker">{t("Owed to you")}</p>
          <p className="earnings-big" data-owed>
            {dollars(e?.owed_cents ?? 0)}
          </p>
        </div>
        <div className="card">
          <p className="kicker">{t("Earned in all")}</p>
          <p className="earnings-big">{dollars(e?.earned_cents ?? 0)}</p>
        </div>
        <div className="card">
          <p className="kicker">{t("Paid out")}</p>
          <p className="earnings-big">{dollars(e?.paid_out_cents ?? 0)}</p>
        </div>
      </div>
      <p className="muted small">
        {t("Tips: {n} for {amount}.", { n: e?.tips.count ?? 0, amount: dollars(e?.tips.share_cents ?? 0) })}{" "}
        {t("Template sales: {n} for {amount}.", { n: e?.sales.count ?? 0, amount: dollars(e?.sales.share_cents ?? 0) })}
      </p>
      <p className="muted small">
        {t("Tips reach you after Stripe's fees, and a template sale pays you 70% of its price. We pay out by hand once a month, once you're owed {min} or more.", {
          min: dollars(PAYOUT_MINIMUM_CENTS),
        })}
      </p>

      <section className="card">
        <h2>{t("Where to send it")}</h2>
        {auth?.authenticated ? (
          <PayoutMethodForm initial={e?.method ?? null} />
        ) : (
          <p>
            {t("Make a free account to keep your earnings and say where to send them.")}{" "}
            <Link href={`/account?next=${encodeURIComponent("/earnings")}`}>{t("Sign in")}</Link>
          </p>
        )}
      </section>

      <section className="card">
        <h2>{t("Recent")}</h2>
        {!e?.recent.length ? (
          <p className="muted">
            {t("Nothing yet. When someone tips one of your characters or buys one as a template, it shows here.")} <Link href="/market">{t("The market")}</Link>
          </p>
        ) : (
          <ul className="plain earnings-lines">
            {e.recent.map((l, i) => (
              <li key={i}>
                <strong>{l.kind === "tip" ? t("Tip") : t("Template sale")}</strong>
                {l.character && (
                  <>
                    {" · "}
                    <Link href={`/characters/${l.character.id}`}>{l.character.name}</Link>
                  </>
                )}
                {" · "}
                {dollars(l.gross_cents)} → <span data-share>{dollars(l.share_cents)}</span>
                {l.note && <span className="muted"> · “{l.note}”</span>}
                <span className="muted small"> · {l.at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {e && e.payouts.length > 0 && (
        <section className="card">
          <h2>{t("Payouts")}</h2>
          <ul className="plain">
            {e.payouts.map((p) => (
              <li key={p.id}>
                {dollars(p.amount_cents)} <span className="muted small">· {p.paid_at.slice(0, 10)}</span>
                {p.note && <span className="muted"> · {p.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
