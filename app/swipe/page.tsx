import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { listMyDatingProfiles } from "@/lib/dating";
import { userIdFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";
import CharacterPicker from "@/app/CharacterPicker";
import { unreadTexts } from "@/lib/inbox";
import { deckFor } from "@/lib/swipes";
import { withOrigins } from "@/lib/origin";
import SwipeDeck from "./SwipeDeck";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Swipe · Botchelor",
  description: "Swipe for your character: match first, and if both characters want a date, it's on.",
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<{ character?: string }> };

/**
 * The swipe deck (lib/swipes.ts, docs/swipes.md): you swipe for one of your characters; a match opens its chat, and
 * the characters decide about the date themselves. On a phone it's the whole screen, like a dating app (David,
 * 2026-10-18): no site header or footer, a slim bar with ✕, whose deck it is and 💬 Matches.
 */
export default async function SwipePage({ searchParams }: Props) {
  const { character } = await searchParams;
  const db = await getDb();
  const viewerId = userIdFromCookieStore(await cookies());
  const mine = viewerId ? await listMyDatingProfiles(db, viewerId) : [];
  if (!viewerId || !mine.length) {
    return (
      <article>
        <p className="kicker">Swipe</p>
        <h1>Match before you date</h1>
        <section className="card">
          <p>Make a character first: you swipe for them, and if both characters want a date, it&apos;s on.</p>
          <Link className="button" href="/create">
            Make a character
          </Link>
        </section>
      </article>
    );
  }
  const me = mine.find((c) => c.id === character) ?? mine[0];
  const [deck, texts] = await Promise.all([deckFor(db, viewerId, me.id), unreadTexts(db, viewerId).catch(() => 0)]);
  // Dealing isn't seeing: the deck reports each card as it comes on top, under this visit's id (lib/swipes.ts logShownCard).
  const serveId = crypto.randomUUID();
  const first = shortName(me.name);
  const matchesHref = `/matches?character=${encodeURIComponent(me.id)}`;

  return (
    <article className="swipe-page swipe-fullscreen">
      <div className="swipe-topbar">
        <Link href="/" className="swipe-topbar-btn" aria-label="Close the deck">
          ✕
        </Link>
        {mine.length > 1 ? (
          <CharacterPicker characters={mine} current={me.id} href="/swipe?character=" label="Swipe for" />
        ) : (
          <span className="swipe-topbar-name">{first}</span>
        )}
        <Link href={matchesHref} className="swipe-topbar-btn" aria-label={texts ? `Matches, ${texts} unread texts` : "Matches"}>
          💬{texts > 0 && <span className="nav-count">{texts > 99 ? "99+" : texts}</span>}
        </Link>
      </div>
      <div className="swipe-intro">
        <p className="kicker">Swipe</p>
        <div className="matches-head">
          <h1>Who should {first} meet?</h1>
          <CharacterPicker characters={mine} current={me.id} href="/swipe?character=" label="Swipe for" />
        </div>
        <p className="muted">
          You swipe for {first}. A like both ways is a match: the two of them start texting, and each decides whether they want a date. If both
          do, you book it. This season&apos;s house characters are always in the deck. <Link href={matchesHref}>{first}&apos;s matches</Link>
        </p>
      </div>
      {deck.ok ? (
        <SwipeDeck character={{ id: me.id, name: me.name, hue: me.hue, portrait: me.portrait }} initial={await withOrigins(db, deck.cards)} serveId={serveId} />
      ) : (
        <section className="card">
          <h2>{deck.error === "profile_incomplete" ? `Finish ${first}'s dating profile` : `${first} can't swipe right now`}</h2>
          <p>{deck.error === "profile_incomplete" ? `The deck shows a dating profile, like any dating app. ${first} still needs:` : deck.message}</p>
          {deck.missing && (
            <ul className="list">
              {deck.missing.map((m) => (
                <li key={m}>{m.replace(/ \(extras\.\w+\)$/, "")}</li>
              ))}
            </ul>
          )}
          {deck.error === "profile_incomplete" && (
            <Link className="button" href={`/characters/${me.id}/edit`}>
              Fill in {first}&apos;s profile
            </Link>
          )}
        </section>
      )}
    </article>
  );
}
