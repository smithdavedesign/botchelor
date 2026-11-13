import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import Icon from "@/app/Icon";
import { billingOn, subscriptionState } from "@/lib/adult/billing";
import { afterDarkTitle } from "@/lib/adult/discreet";
import { canAfterDark } from "@/lib/adult/entitlement";
import { getPrivacy, lockedForCookies } from "@/lib/adult/privacy";
import { writerOptions } from "@/lib/adult/writer";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import PrivacyCard from "../PrivacyCard";
import WriterPicker from "../WriterPicker";
import { currentView } from "../view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: afterDarkTitle((await currentView()).neutralTitle, "Account · After Dark · Botchelor"), robots: { index: false, follow: false } };
}

/** "October 24, 2026", in UTC. */
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const PROCESSOR = { ccbill: "CCBill", segpay: "Segpay", verotel: "Verotel" } as const;

/**
 * After Dark's Account (the design kit's After Dark header, 2026-11-12): what's After Dark's own to set. Privacy (blur,
 * the neutral title, the PIN) and the writer used to sit on the hub; the subscription and tokens were on the show's
 * Account and the tokens page. Everything else (profile, theme, notifications) is the show's Account, one link away.
 * Not found for anyone After Dark isn't open to, as the hub.
 */
export default async function AfterDarkAccountPage() {
  const db = await getDb();
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const entitled = await canAfterDark(db, auth);
  if (!entitled.ok) notFound();
  if (await lockedForCookies(db, auth!.userId, store)) notFound();
  const owner = auth!.userId;
  const [privacy, writer, sub] = await Promise.all([getPrivacy(db, owner), writerOptions(db, owner), subscriptionState(db, owner)]);
  // Why it's open, when it isn't a subscription: an admin, a beta pass, a free taste (lib/adult/entitlement.ts).
  const why = entitled.why;
  return (
    <div className="after-dark-mode">
      <article className="after-dark">
        <p className="kicker">
          <Icon name="moon" /> After Dark · private
        </p>
        <h1>Account</h1>
        <section className="card" data-ad-subscription>
          <h2>Subscription and tokens</h2>
          {sub.status === "active" ? (
            <p data-subscription="active">Subscribed: renews monthly{sub.periodEnd ? `, next on ${day(sub.periodEnd)}` : ""}.</p>
          ) : sub.status === "cancelled" ? (
            <p data-subscription="cancelled">Cancelled: no more charges. Open until {sub.periodEnd ? day(sub.periodEnd) : "the end of the month"}.</p>
          ) : why === "admin" ? (
            <p className="muted">Open to you as an admin: nothing to pay.</p>
          ) : (
            <p className="muted">Open to you without a subscription{why === "taste" ? " (a free taste)" : ""}.</p>
          )}
          <p className="ad-panel-actions">
            <Link className="button-ghost small" href="/after-dark/tokens">
              ◈ Tokens: what they buy, and more
            </Link>
            {sub.status !== "active" && why !== "admin" && billingOn() && (
              <Link className="button small" href="/after-dark/subscribe">
                {sub.status === "none" ? "Subscribe" : "Subscribe again"}
              </Link>
            )}
          </p>
          {sub.status === "active" && (
            <p className="muted small">
              {sub.cancelUrl && sub.processor && (
                <>
                  <a href={sub.cancelUrl} rel="noopener noreferrer" target="_blank" data-cancel-processor>
                    Cancel with {PROCESSOR[sub.processor]}
                  </a>
                  {" · "}
                </>
              )}
              <Link prefetch={false} href="/cancel">
                How to cancel
              </Link>
            </p>
          )}
        </section>
        <div id="privacy">
          <PrivacyCard initial={privacy} />
        </div>
        <WriterPicker initial={writer} />
        <p className="muted small">
          Your profile, theme and notifications are on the show&apos;s{" "}
          <Link prefetch={false} href="/account">
            Account
          </Link>
          .
        </p>
      </article>
    </div>
  );
}
