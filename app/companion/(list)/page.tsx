import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import FaceRibbon from "@/app/FaceRibbon";
import NotOpenYet from "@/app/NotOpenYet";
import CharactersTabs from "@/app/characters/CharactersTabs";
import PhoneActionBar from "@/app/PhoneActionBar";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { sessionsSignable } from "@/lib/auth";
import { authFromCookieStore, signedIdentityFromCookieStore } from "@/lib/http";
import { companionAllowed, listCompanions } from "@/lib/companion";
import { companionAllowance, companionFreePerDay, type CompanionAllowance } from "@/lib/companion-plan";
import { COMPANION_GUEST_THREADS, companionGuestReplies, companionGuestsOpen, companionOpen } from "@/lib/companion-shared";
import { planLink, planPrice } from "@/lib/paid-plans";
import { companionPreview, type CompanionPreview } from "@/lib/companion-preview";
import { sharedStale } from "@/lib/shared-cache";
import type { Db } from "@/lib/db";
import CompanionBrowser, { type CompanionFilters } from "@/app/companion/CompanionBrowser";
import CompanionPhone from "@/app/companion/CompanionPhone";
import TalkButton from "@/app/companion/TalkButton";
import { fillNodes } from "@/app/fillNodes";
import { getLocale, getT } from "@/lib/i18n/server";
import { HTML_LANG } from "@/lib/i18n/locales";
import { english, type T } from "@/lib/i18n/translate";

/** "$9.99 a month" with its "a month" in the reader's language. */
const priceIn = (price: string, t: T) => price.replace(/ a month$/, ` ${t("a month")}`);

export const metadata: Metadata = { title: "Companions · Botchelor", robots: { index: false, follow: false } };

/** What talking costs, said before anyone starts (docs/companions.md: the price shown up front, the count in view). */
function PlanLine({ a, t = english, lang = "en-US" }: { a: CompanionAllowance; t?: T; lang?: string }) {
  if (a.admin) return <p className="companion-plan-line muted small">{t("Admin: no limit.")}</p>;
  if (a.unlimited) {
    return (
      <p className="companion-plan-line small">
        💬 <strong>{/* i18n-ok: the plan's name */}Companion Plan</strong>:{" "}
        {a.plan === "cancelled" && a.plan_ends
          ? t("no daily limit, until {date}.", { date: new Date(a.plan_ends).toLocaleDateString(lang, { month: "long", day: "numeric", timeZone: "UTC" }) })
          : t("no daily limit.")}{" "}
        <Link href="/companion/plan">{t("Your plan")}</Link>
      </p>
    );
  }
  return (
    <p className="companion-plan-line small">
      {t("Free: {n} replies a day across every companion ({left} left today).", { n: a.per_day, left: a.left ?? 0 })}
      {a.on_sale && (
        <>
          {" "}
          {fillNodes(t("{plan} has no daily limit, {price}.", { price: priceIn(a.price, t) }), {
            plan: <Link href="/companion/plan">{t("The Companion Plan")}</Link>,
          })}
        </>
      )}
    </p>
  );
}

/**
 * The phone's opener (lib/companion-preview.ts): the same for everyone and slow to change, so one copy kept for ten
 * minutes. A failure never costs the page; it shows without the phone.
 */
const phonePreview = (db: Db): Promise<CompanionPreview | null> => sharedStale("companion:phone", () => companionPreview(db), 10 * 60_000).catch(() => null);

/** The page's header, beside the phone when there is one (anyone without a conversation yet). */
function Hero({ preview, children }: { preview: CompanionPreview | null; children: ReactNode }) {
  if (!preview) return <>{children}</>;
  return (
    <div className="companion-hero">
      {children}
      <CompanionPhone preview={preview} />
    </div>
  );
}

/**
 * Companions (lib/companion.ts; docs/companions.md): your one-to-one threads with the characters, and who else you could
 * talk with: your own characters, the house cast and the show's own open cast.
 */
export default async function CompanionsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const sp = (await searchParams) ?? {};
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const pick = (k: string) => (Array.isArray(sp[k]) ? sp[k]?.[0] : (sp[k] as string | undefined));
  const initial: CompanionFilters = { q: pick("q")?.slice(0, 80), who: pick("who"), pronouns: pick("pronouns"), style: pick("style"), type: pick("type"), love: pick("love"), sort: pick("sort") };
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const db = await getDb();
  // Open to everyone, a visitor without an account tries it first (2026-11-07 audit, item 6): a few free replies, on a
  // signed identity (or none yet: their first Talk makes a signed one), then a free account keeps it going.
  if (!auth?.authenticated && companionGuestsOpen() && (auth ? signedIdentityFromCookieStore(store) : sessionsSignable())) {
    const [{ threads, yours, cast }, allowance, preview] = await Promise.all([
      listCompanions(db, auth?.userId ?? ""),
      auth ? companionAllowance(db, auth.userId, new Date(), process.env, { guest: true }) : null,
      phonePreview(db),
    ]);
    const cap = companionGuestReplies();
    const left = allowance?.left ?? cap;
    // "Try it now" with the button that does it: the phone's character (what it types is their real opener), else the
    // first of the cast, and the same button in thumb reach once it's scrolled away (2026-11-22: the first Talk was two
    // screens down on a phone). Once there's a conversation, it heads the list instead.
    const first = threads.length === 0 && left > 0 ? (preview ?? cast[0] ?? null) : null;
    const talkFirst = first ? t("Talk to {name}", { name: first.name.split(/\s+/)[0] }) : "";
    return (
      <article className="companion-page page-wide">
        <CharactersTabs current="companions" companions />
        <Hero preview={threads.length === 0 ? preview : null}>
          <header>
            <p className="kicker">{t("Companions")}</p>
            <h1>{t("Talk with a character, one to one")}</h1>
            <p className="muted">
              {t("Off the show, just the two of you. They remember what you tell them (you can see and change all of it), and they have their own week on the show to tell you about. Every companion is an AI character, not a real person.")}
            </p>
            <p className="companion-plan-line small">
              {left > 0 ? (
                fillNodes(t("Try it now, no account needed: {count}."), {
                  count: (
                    <strong>
                      {left < cap
                        ? left === 1
                          ? t("1 free reply left")
                          : t("{n} free replies left", { n: left })
                        : left === 1
                          ? t("1 free reply")
                          : t("{n} free replies", { n: left })}
                    </strong>
                  ),
                })
              ) : (
                t("That's the free replies without an account.")
              )}{" "}
              {fillNodes(t("{account} keeps it going: {n} replies a day across every companion.", { n: companionFreePerDay() }), {
                account: <Link href="/account?next=%2Fcompanion">{t("A free account")}</Link>,
              })}
              {planLink("companion") && ` ${t("The Companion Plan has no daily limit, {price}.", { price: priceIn(planPrice("companion"), t) })}`}
            </p>
            {first && (
              <div id="companion-cta">
                <TalkButton characterId={first.id} name={first.name} label={talkFirst} className="button" track="companion-hero" />
              </div>
            )}
          </header>
        </Hero>
        {/* The house cast in a ribbon for a visitor (the visual pop audit, 2026-11-20); a member's page stays their list. */}
        <FaceRibbon />
        {first && (
          <PhoneActionBar watch="companion-cta">
            <TalkButton characterId={first.id} name={first.name} label={talkFirst} className="button" track="companion-hero" />
          </PhoneActionBar>
        )}
        <CompanionBrowser threads={threads} others={[...yours, ...cast]} signIn={left <= 0 || threads.length >= COMPANION_GUEST_THREADS} initial={initial} />
        <p className="muted small">
          {fillNodes(t("PG, like the show. If you're having a hard time, {help}."), { help: <Link href="/safety">{t("help is here")}</Link> })}
        </p>
      </article>
    );
  }
  // Open to everyone but guests are off (or an unsigned identity): who they could talk with and what it costs, sign in first.
  if (!auth?.authenticated && companionOpen()) {
    const [{ cast }, preview] = await Promise.all([listCompanions(db, ""), phonePreview(db)]);
    return (
      <article className="companion-page page-wide">
        <CharactersTabs current="companions" companions />
        <Hero preview={preview}>
          <header>
            <p className="kicker">{t("Companions")}</p>
            <h1>{t("Talk with a character, one to one")}</h1>
            <p className="muted">
              {t("Off the show, just the two of you. They remember what you tell them (you can see and change all of it), and they have their own week on the show to tell you about. Every companion is an AI character, not a real person.")}
            </p>
            <p className="companion-plan-line small">
              {t("Free: {n} replies a day across every companion.", { n: companionFreePerDay() })}
              {planLink("companion") && ` ${t("The Companion Plan has no daily limit, {price}.", { price: priceIn(planPrice("companion"), t) })}`}
            </p>
            <p className="cta-row" id="companion-cta">
              <Link className="button" href="/account?next=%2Fcompanion">
                {t("Sign in to start")}
              </Link>
            </p>
          </header>
        </Hero>
        <FaceRibbon />
        <PhoneActionBar watch="companion-cta">
          <Link className="button" href="/account?next=%2Fcompanion">
            {t("Sign in to start talking")}
          </Link>
        </PhoneActionBar>
        <CompanionBrowser threads={[]} others={cast} signIn initial={initial} />
      </article>
    );
  }
  if (!(await companionAllowed(db, auth))) {
    // Closed, or open but only with an account here: say which, never a 404 (mobile audit C21).
    if (!companionOpen())
      return (
        <NotOpenYet
          title={t("Companions")}
          action={
            <Link className="button" href="/step-in" data-track="companion-closed-step-in">
              {t("Step into a date instead")}
            </Link>
          }
          extra={<FaceRibbon title={t("Who you'll be able to text")} />}
        >
          {fillNodes(
            t("One-to-one chats with the characters, off the show. They aren't open yet: the characters are on {watch} in the meantime, and you can step into a date with one of them, live, line by line."),
            { watch: <Link href="/watch">{t("Watch")}</Link> },
          )}
        </NotOpenYet>
      );
    return (
      <NotOpenYet
        title={t("Companions")}
        action={
          <Link className="button" href="/account?next=%2Fcompanion">
            {t("Sign in to start")}
          </Link>
        }
      >
        {t("One-to-one chats with the characters, off the show. They take a free account.")}
      </NotOpenYet>
    );
  }
  const [{ threads, yours, cast }, allowance, preview] = await Promise.all([listCompanions(db, auth!.userId), companionAllowance(db, auth!.userId), phonePreview(db)]);
  return (
    <article className="companion-page page-wide">
      <CharactersTabs current="companions" companions />
      <Hero preview={threads.length === 0 ? preview : null}>
        <header>
          <p className="kicker">{t("Companions")}</p>
          <h1>{t("Talk with a character, one to one")}</h1>
          <p className="muted">
            {t("Off the show, just the two of you. They remember what you tell them (you can see and change all of it), they have their own week on the show to tell you about, and only you see the conversation. Every companion is an AI character, not a real person.")}
          </p>
          <PlanLine a={allowance} t={t} lang={HTML_LANG[locale]} />
        </header>
      </Hero>
      <CompanionBrowser threads={threads} others={[...yours, ...cast]} initial={initial} />
      <p className="muted small">
        {fillNodes(t("PG, like the show. If you're having a hard time, {help}."), { help: <Link href="/safety">{t("help is here")}</Link> })}
      </p>
    </article>
  );
}
