import type { Metadata } from "next";
import Link from "next/link";
import PhoneActionBar from "@/app/PhoneActionBar";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { sessionsSignable } from "@/lib/auth";
import { authFromCookieStore, signedIdentityFromCookieStore } from "@/lib/http";
import { companionAllowed, listCompanions } from "@/lib/companion";
import { companionAllowance, companionFreePerDay, type CompanionAllowance } from "@/lib/companion-plan";
import { COMPANION_GUEST_THREADS, companionGuestReplies, companionGuestsOpen, companionOpen } from "@/lib/companion-shared";
import { planLink, planPrice } from "@/lib/paid-plans";
import CompanionBrowser, { type CompanionFilters } from "./CompanionBrowser";

export const metadata: Metadata = { title: "Companions · Botchelor", robots: { index: false, follow: false } };

/** What talking costs, said before anyone starts (docs/companions.md: the price shown up front, the count in view). */
function PlanLine({ a }: { a: CompanionAllowance }) {
  if (a.admin) return <p className="companion-plan-line muted small">Admin: no limit.</p>;
  if (a.unlimited) {
    return (
      <p className="companion-plan-line small">
        💬 <strong>Companion Plan</strong>: no daily limit{a.plan === "cancelled" && a.plan_ends ? `, until ${new Date(a.plan_ends).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}` : ""}.{" "}
        <Link href="/companion/plan">Your plan</Link>
      </p>
    );
  }
  return (
    <p className="companion-plan-line small">
      Free: {a.per_day} replies a day across every companion ({a.left} left today).
      {a.on_sale && (
        <>
          {" "}
          <Link href="/companion/plan">The Companion Plan</Link> has no daily limit, {a.price}.
        </>
      )}
    </p>
  );
}

/**
 * Companions (lib/companion.ts; docs/companions.md): your one-to-one threads with the characters, and who else you could
 * talk with: your own characters, the house cast and the show's own open cast.
 */
export default async function CompanionsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const sp = (await searchParams) ?? {};
  const pick = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : (sp[k] as string | undefined));
  const initial: CompanionFilters = { q: pick("q")?.slice(0, 80), who: pick("who"), pronouns: pick("pronouns"), sort: pick("sort") };
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const db = await getDb();
  // Open to everyone, a visitor without an account tries it first (2026-11-07 audit, item 6): a few free replies, on a
  // signed identity (or none yet: their first Talk makes a signed one), then a free account keeps it going.
  if (!auth?.authenticated && companionGuestsOpen() && (auth ? signedIdentityFromCookieStore(store) : sessionsSignable())) {
    const [{ threads, yours, cast }, allowance] = await Promise.all([
      listCompanions(db, auth?.userId ?? ""),
      auth ? companionAllowance(db, auth.userId, new Date(), process.env, { guest: true }) : null,
    ]);
    const cap = companionGuestReplies();
    const left = allowance?.left ?? cap;
    return (
      <article className="companion-page page-wide">
        <header>
          <p className="kicker">Companions</p>
          <h1>Talk with a character, one to one</h1>
          <p className="muted">
            Off the show, just the two of you. They remember what you tell them (you can see and change all of it), and they have their own week on the show
            to tell you about. Every companion is an AI character, not a real person.
          </p>
          <p className="companion-plan-line small">
            {left > 0 ? (
              <>
                Try it now, no account needed: <strong>{left} free {left === 1 ? "reply" : "replies"}</strong>
                {left < cap ? " left" : ""}.
              </>
            ) : (
              <>That&apos;s the free replies without an account.</>
            )}{" "}
            <Link href="/account?next=%2Fcompanion">A free account</Link> keeps it going: {companionFreePerDay()} replies a day across every companion.
            {planLink("companion") && ` The Companion Plan has no daily limit, ${planPrice("companion")}.`}
          </p>
        </header>
        <CompanionBrowser threads={threads} others={[...yours, ...cast]} signIn={left <= 0 || threads.length >= COMPANION_GUEST_THREADS} initial={initial} />
        <p className="muted small">
          PG, like the show. If you&apos;re having a hard time, <Link href="/safety">help is here</Link>.
        </p>
      </article>
    );
  }
  // Open to everyone but guests are off (or an unsigned identity): who they could talk with and what it costs, sign in first.
  if (!auth?.authenticated && companionOpen()) {
    const { cast } = await listCompanions(db, "");
    return (
      <article className="companion-page page-wide">
        <header>
          <p className="kicker">Companions</p>
          <h1>Talk with a character, one to one</h1>
          <p className="muted">
            Off the show, just the two of you. They remember what you tell them (you can see and change all of it), and they have their own week on the show
            to tell you about. Every companion is an AI character, not a real person.
          </p>
          <p className="companion-plan-line small">
            Free: {companionFreePerDay()} replies a day across every companion.
            {planLink("companion") && ` The Companion Plan has no daily limit, ${planPrice("companion")}.`}
          </p>
          <p className="cta-row" id="companion-cta">
            <Link className="button" href="/account?next=%2Fcompanion">
              Sign in to start
            </Link>
          </p>
        </header>
        <PhoneActionBar watch="companion-cta">
          <Link className="button" href="/account?next=%2Fcompanion">
            Sign in to start talking
          </Link>
        </PhoneActionBar>
        <CompanionBrowser threads={[]} others={cast} signIn initial={initial} />
      </article>
    );
  }
  if (!(await companionAllowed(db, auth))) notFound();
  const [{ threads, yours, cast }, allowance] = await Promise.all([listCompanions(db, auth!.userId), companionAllowance(db, auth!.userId)]);
  return (
    <article className="companion-page page-wide">
      <header>
        <p className="kicker">Companions</p>
        <h1>Talk with a character, one to one</h1>
        <p className="muted">
          Off the show, just the two of you. They remember what you tell them (you can see and change all of it), they have their own week on the show to
          tell you about, and only you see the conversation. Every companion is an AI character, not a real person.
        </p>
        <PlanLine a={allowance} />
      </header>
      <CompanionBrowser threads={threads} others={[...yours, ...cast]} initial={initial} />
      <p className="muted small">
        PG, like the show. If you&apos;re having a hard time, <Link href="/safety">help is here</Link>.
      </p>
    </article>
  );
}
