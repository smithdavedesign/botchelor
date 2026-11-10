import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
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

/**
 * The Companion Plan (lib/paid-plans.ts, lib/companion-plan.ts): the price and what renews said in full before anyone pays,
 * Subscribe, and for a subscriber where their plan stands and where to cancel.
 */
export default async function CompanionPlanPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const auth = authFromCookieStore(await cookies());
  const db = await getDb();
  if (!companionOpen() && !(auth?.authenticated && (await isAdmin(db, auth.userId)))) notFound();
  const price = planPrice("companion");
  const onSale = planLink("companion") !== null;
  const a = auth?.authenticated ? await companionAllowance(db, auth.userId) : null;
  const subscribed = a && (a.plan === "active" || a.plan === "cancelled");
  return (
    <article className="companion-page plan-page">
      <header>
        <p className="kicker">Companions</p>
        <h1>Companion Plan</h1>
        <p className="plan-price">{price}</p>
        <p className="muted">Talk with every companion as much as you like: the house cast, your own characters and the show&apos;s cast.</p>
      </header>

      {checkout === "success" && !subscribed && <PlanWait />}

      <section className="card plan-card" aria-labelledby="plan-what">
        <h2 id="plan-what">What you get</h2>
        <ul>
          <li>No daily limit on messages with any companion (fair use: {COMPANION_FAIR_USE_PER_MONTH.toLocaleString("en-US")} a month).</li>
          <li>
            {COMPANION_EXTRAS.voice.included} voice notes a month: tap 🔊 on any reply to hear it in their own voice (after that, a token buys{" "}
            {COMPANION_EXTRAS.voice.bundle}).
          </li>
          {liveCallsOn(process.env, { admin: false, guest: false }) && (
            <li>
              {extraTerms("minute").included} minutes of live calls a month, where you can talk over each other (after that, a token buys{" "}
              {extraTerms("minute").bundle} minutes; calls that take turns are free).
            </li>
          )}
          <li>Everything the free tier has stays the same: their memory of you (you can see and change all of it), another reply whenever you like, how much they say.</li>
        </ul>
        <p className="muted small">
          Without it: {companionFreePerDay()} free replies a day across every companion, and voice notes at {COMPANION_EXTRAS.voice.bundle} for a token.{" "}
          <Link href="/terms#companion-extras">How extras work</Link>.
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
          <p className="small">
            {price}, charged now and every month after until you cancel. Cancel any time in Stripe&apos;s billing portal (the link is on this page and in your
            receipt): the plan runs to the end of the month you paid for, and there are no partial refunds. <Link href="/terms#companion-plan">The plan&apos;s terms</Link>.
          </p>
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
        </section>
      )}
    </article>
  );
}
