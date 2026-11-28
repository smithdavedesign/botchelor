import type { Metadata } from "next";
import Link from "next/link";
import NotOpenYet from "@/app/NotOpenYet";
import { cookies } from "next/headers";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import { isAdmin } from "@/lib/admins";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { listCompanions, type CompanionListItem } from "@/lib/companion";
import { COMPANION_EXTRAS, companionOpen, extraTerms } from "@/lib/companion-shared";
import { liveCallsOn } from "@/lib/companion-live";
import { liveFaceMode } from "@/lib/live-face";
import { COMPANION_FAIR_USE_PER_MONTH, companionAllowance, companionFreePerDay } from "@/lib/companion-plan";
import { DEEP_TURNS, RECENT_TURNS } from "@/lib/companion-prompt";
import { planLink, planPrice } from "@/lib/paid-plans";
import { STORY_TOKENS, stylesAudience } from "@/lib/writing-style";
import { fillNodes } from "@/app/fillNodes";
import { getLocale, getT } from "@/lib/i18n/server";
import { HTML_LANG } from "@/lib/i18n/locales";
import { english, type T } from "@/lib/i18n/translate";
import { PlanCheckout, PlanWait } from "./PlanCheckout";

export const metadata: Metadata = {
  title: "Companion Plan · Botchelor",
  description: "Talk with every Botchelor companion without a daily limit.",
  // Behind the 18+ gate for people, so out of search with its one address (2026-11-22 audit: indexable, no canonical).
  alternates: { canonical: "/companion/plan" },
  robots: { index: false, follow: true },
};

const day = (iso: string, lang = "en-US") => new Date(iso).toLocaleDateString(lang, { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

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
function Yes({ t = english }: { t?: T }) {
  return (
    <span className="money-yes">
      <Icon name="check" /> {t("Yes")}
    </span>
  );
}

/**
 * The Companion Plan (lib/paid-plans.ts, lib/companion-plan.ts): the price as the headline over the companions' faces,
 * and Subscribe in that same card, with the renewal said in full before anyone pays; for a subscriber, where their plan
 * stands and where to cancel. Then Free beside the plan in one table. Subscribe sat under the table until the
 * 2026-11-22 audit, about 1,300px down on a desktop and on a phone's third screen.
 */
export default async function CompanionPlanPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const lang = HTML_LANG[locale];
  const auth = authFromCookieStore(await cookies());
  const db = await getDb();
  if (!companionOpen() && !(auth?.authenticated && (await isAdmin(db, auth.userId))))
    // Closed: say so, never a 404 (mobile audit C21).
    return (
      <NotOpenYet title={t("The Companion Plan")}>
        {fillNodes(t("Unlimited one-to-one chats and calls with the characters. Companions aren't open yet: the characters are on {watch} in the meantime."), {
          watch: <Link href="/watch">{t("Watch")}</Link>,
        })}
      </NotOpenYet>
    );
  const price = planPrice("companion");
  const { amount, per: perEnglish } = priceParts(price);
  const per = perEnglish === "a month" ? t("a month") : perEnglish;
  const priceWords = per ? `${amount} ${per}` : amount;
  const onSale = planLink("companion") !== null;
  const [a, people] = await Promise.all([
    auth?.authenticated ? companionAllowance(db, auth.userId) : null,
    listCompanions(db, auth?.userId ?? "").catch(() => ({ threads: [] as CompanionListItem[], yours: [] as CompanionListItem[], cast: [] as CompanionListItem[] })),
  ]);
  const subscribed = a && (a.plan === "active" || a.plan === "cancelled");
  const faces = pickFaces(people);
  const companions = people.cast.length + people.threads.filter((c) => !c.yours).length;
  const live = liveCallsOn(process.env, { admin: false, guest: false });
  // With LIVE_FACE_PROVIDER `<renderer>:plan` the moving face on a live call is the plan's (lib/live-face).
  const facePlan = live && liveFaceMode() === "plan";
  const voice = COMPANION_EXTRAS.voice;
  const minutes = extraTerms("minute");
  const perDay = companionFreePerDay();
  // Narrated writing, stories and the longer memory (lib/writing-style.ts): said only while they're open to members.
  const depth = stylesAudience() === "members";
  return (
    <article className="companion-page plan-page money-page">
      <header className="money-hero">
        <p className="kicker">{t("Companions")}</p>
        <h1>{/* i18n-ok: the plan's name stays English */}Companion Plan</h1>
        <p className="money-price">
          <span className="money-price-amount">{amount}</span>
          {per && <span className="money-price-per">{per}</span>}
        </p>
        <p className="muted">{t("Talk with every companion as much as you like: the house cast, your own characters and the show's cast.")}</p>
        {faces.length > 0 && (
          <>
            <ul className="money-faces" aria-label={t("Some of the companions")}>
              {faces.map((c) => (
                <li key={c.id} className="money-face">
                  <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={44} />
                </li>
              ))}
            </ul>
            <p className="money-faces-line muted small">
              {fillNodes(companions === 1 ? t("1 companion to talk with. {meet}.") : t("{n} companions to talk with. {meet}.", { n: companions }), {
                meet: <Link href="/companion">{t("Meet them")}</Link>,
              })}
            </p>
          </>
        )}
        {!subscribed && (
          <div className="money-hero-buy" id="plan-buy">
            {!onSale ? (
              <p className="muted">{t("The plan isn't on sale right now.")}</p>
            ) : a?.admin ? (
              <p className="muted small">{t("You're an admin: companions have no limit for you.")}</p>
            ) : !auth?.authenticated ? (
              <p className="cta-row">
                <Link className="button" href="/account?next=%2Fcompanion%2Fplan">
                  {t("Sign in to subscribe")}
                </Link>
              </p>
            ) : (
              <PlanCheckout price={priceWords} />
            )}
            {/* The renewal terms in full, with the button (California's auto-renewal law: said plainly before anyone pays). */}
            <p className="small muted">
              {fillNodes(
                t("{price}, charged now and every month after until you cancel. Cancel any time in Stripe's billing portal (the link is on this page and in your receipt): the plan runs to the end of the month you paid for, and there are no partial refunds. {terms}.", { price: priceWords }),
                { terms: <Link href="/terms#companion-plan">{t("The plan's terms")}</Link> },
              )}
            </p>
          </div>
        )}
      </header>

      {checkout === "success" && !subscribed && <PlanWait />}

      {subscribed && (
        <section className="card plan-card" aria-labelledby="plan-yours">
          <h2 id="plan-yours">{t("Your plan")}</h2>
          <p>
            {a.plan === "cancelled"
              ? a.plan_ends
                ? t("Cancelled: it runs until {date}, then stops. Nothing more is charged.", { date: day(a.plan_ends, lang) })
                : t("Cancelled: it runs until the end of the month you paid for, then stops. Nothing more is charged.")
              : a.plan_ends
                ? t("It's on, and renews on {date}.", { date: day(a.plan_ends, lang) })
                : t("It's on.")}
          </p>
          {a.manage ? (
            <p>
              <a href={a.manage} rel="noopener">
                {a.plan === "cancelled" ? t("Keep it going, or change your card") : t("Cancel or change your card")}
              </a>{" "}
              <span className="muted small">({t("Stripe's billing portal: sign in with the email you paid with")})</span>
            </p>
          ) : (
            <p className="muted small">{t("To cancel, use the link in Stripe's receipt email.")}</p>
          )}
          <p>
            <Link href="/companion">{t("Talk with your companions")}</Link>
          </p>
        </section>
      )}

      {/* Try before paying (the 2026-11-28 simulation: nobody would pay $9.99 for a chat they hadn't seen). What one is
          like, plainly marked as an example we wrote, and the free way in. */}
      <section className="card plan-card plan-sample" aria-labelledby="plan-sample">
        <h2 id="plan-sample">{t("What it's like")}</h2>
        <p className="muted small">{t("An example we wrote to show the shape of it, not a real conversation.")}</p>
        <ol className="plan-sample-lines">
          <li>
            <strong>{t("Them:")}</strong> {t("You're back. I was halfway through telling you about the rooftop tour that went wrong.")}
          </li>
          <li>
            <strong>{t("You:")}</strong> {t("Wrong how?")}
          </li>
          <li>
            <strong>{t("Them:")}</strong> {t("The guide was afraid of heights. We did the whole thing from the gift shop. Best tour I've ever had.")}
          </li>
          <li>
            <strong>{t("You:")}</strong> {t("Would you go again?")}
          </li>
          <li>
            <strong>{t("Them:")}</strong> {t("Only if you came. You'd ask the right questions.")}
          </li>
        </ol>
        <p>
          {t("They remember what you told them, text you first if you let them, and stay in character. Try it free first: {n} replies a day, no card.", { n: perDay })}{" "}
          <Link href="/companion" data-track="plan-try-free">
            {t("Pick a companion")}
          </Link>
        </p>
      </section>

      <section className="card plan-card" aria-labelledby="plan-what">
        <h2 id="plan-what">{t("What you get")}</h2>
        {/* The roles are spelled out: a phone lays the table out as blocks (app/ux/money.css), and some browsers drop a
            table's meaning once its parts stop displaying as one. */}
        <table className="money-compare" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader">
                <span className="sr-only">{t("What")}</span>
              </th>
              <th scope="col" role="columnheader">
                {t("Free")}
              </th>
              <th scope="col" role="columnheader" className="is-plan">
                {/* i18n-ok: the plan's name */}Companion Plan
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            <tr role="row">
              <th scope="row" role="rowheader">
                {t("Replies a day")}
              </th>
              <td role="cell">{t("{n} a day across every companion", { n: perDay })}</td>
              <td role="cell" className="is-plan">
                {t("No daily limit")}
                <small>{t("fair use: {n} a month", { n: COMPANION_FAIR_USE_PER_MONTH.toLocaleString(lang) })}</small>
              </td>
            </tr>
            <tr role="row">
              <th scope="row" role="rowheader">
                {t("Voice notes")}
                <small>{t("tap 🔊 on any reply to hear it in their own voice")}</small>
              </th>
              <td role="cell">{t("One date from a pack buys {n}", { n: voice.bundle })}</td>
              <td role="cell" className="is-plan">
                {t("{n} a month included", { n: voice.included })}
                <small>{t("after that, one date from a pack buys {n}", { n: voice.bundle })}</small>
              </td>
            </tr>
            {live && (
              <tr role="row">
                <th scope="row" role="rowheader">
                  {t("Live calls")}
                  <small>{t("where you can talk over each other")}</small>
                </th>
                <td role="cell">{t("Calls that take turns are free")}</td>
                <td role="cell" className="is-plan">
                  {facePlan
                    ? t("{n} minutes a month, with their face moving as they talk", { n: minutes.included })
                    : t("{n} minutes a month", { n: minutes.included })}
                  <small>{t("after that, one date from a pack buys {n} minutes; calls that take turns are free", { n: minutes.bundle })}</small>
                </td>
              </tr>
            )}
            <tr role="row">
              <th scope="row" role="rowheader">
                {t("Their memory of you")}
                <small>{t("you can see and change all of it")}</small>
              </th>
              <td role="cell">
                <Yes t={t} />
                {depth && <small>{t("the last {n} messages kept word for word", { n: RECENT_TURNS })}</small>}
              </td>
              <td role="cell" className="is-plan">
                <Yes t={t} />
                {depth && <small>{t("twice as long: the last {n} messages kept word for word", { n: DEEP_TURNS })}</small>}
              </td>
            </tr>
            {/* Depth comes with the plan, never by the line (lib/writing-style.ts). */}
            {depth && (
              <tr role="row">
                <th scope="row" role="rowheader">
                  {t("Narrated writing")}
                  <small>{t("your dates and scenes told as prose, like a novel; pick it in your account")}</small>
                </th>
                <td role="cell">{t("The script: lines and a short action")}</td>
                <td role="cell" className="is-plan">
                  {t("Included")}
                  <small>{t("and stories of your dates (without the plan, {n} bought date each)", { n: STORY_TOKENS })}</small>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {/* What "a date from a pack" is, said once (the audit: the unit was never explained), and the two rows that were
            Yes on both sides ("Another reply whenever you like", "How much they say") as the line they were. */}
        <p className="muted small">
          {fillNodes(
            t("A date from a pack is one of the show's bought dates ({shop}): it sends a character on a date, or buys a bundle of the extras above. Everything that's free stays the same on the plan, like asking for another reply or choosing how much they say. {how}."),
            { shop: <Link href="/shop">{t("More dates")}</Link>, how: <Link href="/terms#companion-extras">{t("How extras work")}</Link> },
          )}
        </p>
      </section>
    </article>
  );
}
