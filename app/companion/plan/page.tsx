import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import { isAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { listCompanions, type CompanionListItem } from "@/lib/companion";
import { COMPANION_EXTRAS, companionOpen, extraTerms } from "@/lib/companion-shared";
import { liveCallsOn } from "@/lib/companion-live";
import { COMPANION_FAIR_USE_PER_MONTH, companionAllowance, companionFreePerDay } from "@/lib/companion-plan";
import { planLink, planPrice } from "@/lib/paid-plans";
import { PlanCheckout, PlanWait } from "./PlanCheckout";

export const metadata: Metadata = {
  title: "Companion Plan · Botchelor",
  description: "Talk with every Botchelor companion without a daily limit.",
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** How many companions' faces the hero shows. */
const FACES = 8;

/** "$9.99 a month" as a headline: the amount big, the rest beside it. A label with no leading amount is shown whole. */
function priceParts(label: string): { amount: string; per: string } {
  const m = /^(\$\s?[\d.,]+)\s*(.*)$/.exec(label.trim());
  return m ? { amount: m[1], per: m[2] } : { amount: label, per: "" };
}

/**
 * The faces under the price: the companions anyone can talk with (the house cast, the show's open cast, the ones you
 * already talk with), this month's cast first, then those with a face drawn, up to FACES. The same list the companions
 * page shows (lib/companion.ts listCompanions), no query of its own.
 */
function pickFaces(people: { threads: CompanionListItem[]; cast: CompanionListItem[] }): CompanionListItem[] {
  const everyone = [...people.cast, ...people.threads.filter((c) => !c.yours)];
  const rank = (c: CompanionListItem) => (c.on_show ? 0 : 1) + (c.portrait || c.house ? 0 : 2);
  return everyone
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .slice(0, FACES)
    .map(({ c }) => c);
}

/** A row of the comparison that both sides have. */
function Yes() {
  return (
    <span className="money-yes">
      <Icon name="check" /> Yes
    </span>
  );
}

/**
 * The Companion Plan (lib/paid-plans.ts, lib/companion-plan.ts): the price as the headline over the companions' faces,
 * Free beside the plan in one table, then Subscribe with the renewal said in full before anyone pays, and for a
 * subscriber where their plan stands and where to cancel.
 */
export default async function CompanionPlanPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const auth = authFromCookieStore(await cookies());
  const db = await getDb();
  if (!companionOpen() && !(auth?.authenticated && (await isAdmin(db, auth.userId)))) notFound();
  const price = planPrice("companion");
  const { amount, per } = priceParts(price);
  const onSale = planLink("companion") !== null;
  const [a, people] = await Promise.all([
    auth?.authenticated ? companionAllowance(db, auth.userId) : null,
    listCompanions(db, auth?.userId ?? "").catch(() => ({ threads: [] as CompanionListItem[], yours: [] as CompanionListItem[], cast: [] as CompanionListItem[] })),
  ]);
  const subscribed = a && (a.plan === "active" || a.plan === "cancelled");
  const faces = pickFaces(people);
  const companions = people.cast.length + people.threads.filter((c) => !c.yours).length;
  const live = liveCallsOn(process.env, { admin: false, guest: false });
  const voice = COMPANION_EXTRAS.voice;
  const minutes = extraTerms("minute");
  const perDay = companionFreePerDay();
  return (
    <article className="companion-page plan-page money-page">
      <header className="money-hero">
        <p className="kicker">Companions</p>
        <h1>Companion Plan</h1>
        <p className="money-price">
          <span className="money-price-amount">{amount}</span>
          {per && <span className="money-price-per">{per}</span>}
        </p>
        <p className="muted">Talk with every companion as much as you like: the house cast, your own characters and the show&apos;s cast.</p>
        {faces.length > 0 && (
          <>
            <ul className="money-faces" aria-label="Some of the companions">
              {faces.map((c) => (
                <li key={c.id} className="money-face">
                  <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={44} />
                </li>
              ))}
            </ul>
            <p className="money-faces-line muted small">
              {companions} {companions === 1 ? "companion" : "companions"} to talk with. <Link href="/companion">Meet them</Link>.
            </p>
          </>
        )}
      </header>

      {checkout === "success" && !subscribed && <PlanWait />}

      <section className="card plan-card" aria-labelledby="plan-what">
        <h2 id="plan-what">What you get</h2>
        <table className="money-compare">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">What</span>
              </th>
              <th scope="col">Free</th>
              <th scope="col" className="is-plan">
                Companion Plan
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Replies a day</th>
              <td>{perDay} a day across every companion</td>
              <td className="is-plan">
                No daily limit
                <small>fair use: {COMPANION_FAIR_USE_PER_MONTH.toLocaleString("en-US")} a month</small>
              </td>
            </tr>
            <tr>
              <th scope="row">
                Voice notes
                <small>tap 🔊 on any reply to hear it in their own voice</small>
              </th>
              <td>A token buys {voice.bundle}</td>
              <td className="is-plan">
                {voice.included} a month included
                <small>after that, a token buys {voice.bundle}</small>
              </td>
            </tr>
            {live && (
              <tr>
                <th scope="row">
                  Live calls
                  <small>where you can talk over each other</small>
                </th>
                <td>Calls that take turns are free</td>
                <td className="is-plan">
                  {minutes.included} minutes a month
                  <small>after that, a token buys {minutes.bundle} minutes; calls that take turns are free</small>
                </td>
              </tr>
            )}
            <tr>
              <th scope="row">
                Their memory of you
                <small>you can see and change all of it</small>
              </th>
              <td>
                <Yes />
              </td>
              <td className="is-plan">
                <Yes />
              </td>
            </tr>
            <tr>
              <th scope="row">Another reply whenever you like</th>
              <td>
                <Yes />
              </td>
              <td className="is-plan">
                <Yes />
              </td>
            </tr>
            <tr>
              <th scope="row">How much they say</th>
              <td>
                <Yes />
              </td>
              <td className="is-plan">
                <Yes />
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">
          Everything the free tier has stays the same on the plan. <Link href="/terms#companion-extras">How extras work</Link>.
        </p>
      </section>

      {subscribed ? (
        <section className="card plan-card" aria-labelledby="plan-yours">
          <h2 id="plan-yours">Your plan</h2>
          <p>
            {a.plan === "cancelled"
              ? `Cancelled: it runs until ${a.plan_ends ? day(a.plan_ends) : "the end of the month you paid for"}, then stops. Nothing more is charged.`
              : `It's on${a.plan_ends ? `, and renews on ${day(a.plan_ends)}` : ""}.`}
          </p>
          {a.manage ? (
            <p>
              <a href={a.manage} rel="noopener">
                {a.plan === "cancelled" ? "Keep it going, or change your card" : "Cancel or change your card"}
              </a>{" "}
              <span className="muted small">(Stripe&apos;s billing portal: sign in with the email you paid with)</span>
            </p>
          ) : (
            <p className="muted small">To cancel, use the link in Stripe&apos;s receipt email.</p>
          )}
          <p>
            <Link href="/companion">Talk with your companions</Link>
          </p>
        </section>
      ) : (
        <section className="card plan-card" aria-labelledby="plan-buy">
          <h2 id="plan-buy">Subscribe</h2>
          {!onSale ? (
            <p className="muted">The plan isn&apos;t on sale right now.</p>
          ) : a?.admin ? (
            <p className="muted small">You&apos;re an admin: companions have no limit for you.</p>
          ) : !auth?.authenticated ? (
            <p>
              <Link className="button" href="/account?next=%2Fcompanion%2Fplan">
                Sign in to subscribe
              </Link>
            </p>
          ) : (
            <PlanCheckout price={price} />
          )}
          {/* The renewal terms in full, with the button (California's auto-renewal law: said plainly before anyone pays). */}
          <p className="small muted">
            {price}, charged now and every month after until you cancel. Cancel any time in Stripe&apos;s billing portal (the link is on this page and in your
            receipt): the plan runs to the end of the month you paid for, and there are no partial refunds. <Link href="/terms#companion-plan">The plan&apos;s terms</Link>.
          </p>
        </section>
      )}
    </article>
  );
}
