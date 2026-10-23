import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { listMyDatingProfiles } from "@/lib/dating";
import { userIdFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";
import CastPreview from "@/app/CastPreview";
import CharacterTabs from "@/app/CharacterTabs";
import { unreadTexts } from "@/lib/inbox";
import { takenWith } from "@/lib/partners";
import { deckFor } from "@/lib/swipes";
import { withOrigins } from "@/lib/origin";
import SwipeDeck from "./SwipeDeck";
import CharacterName from "@/app/CharacterName";

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
 * 2026-10-18): no site header or footer, a slim bar with ✕, whose deck it is and 💬 Matches. To switch whose deck it
 * is: your characters as a row of faces, as on /matches (David, 2026-10-22), a taken one dimmed and tagged 💍 Taken.
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
          <Link className="button" href="/create?next=%2Fswipe">
            Make a character
          </Link>
          <CastPreview line="This season's cast is in the deck, and they always like back:" />
        </section>
      </article>
    );
  }
  // A taken one (lib/partners.ts: with someone and wanting one partner) is out of the deck (lib/swipes.ts cantSwipe), so
  // without one asked for, the deck opens on one that can swipe. Picking a taken one still says why it can't.
  const [taken, texts] = await Promise.all([takenWith(db, mine.map((c) => c.id)), unreadTexts(db, viewerId).catch(() => 0)]);
  const me = mine.find((c) => c.id === character) ?? mine.find((c) => !taken.has(c.id)) ?? mine[0];
  const deck = await deckFor(db, viewerId, me.id);
  // Dealing isn't seeing: the deck reports each card as it comes on top, under this visit's id (lib/swipes.ts logShownCard).
  const serveId = crypto.randomUUID();
  const first = shortName(me.name);
  const matchesHref = `/matches?character=${encodeURIComponent(me.id)}`;
  // The same row of faces under the phone's slim bar and in the desktop's intro (only one of them shows at a time).
  const meRef = { id: me.id, name: me.name, hue: me.hue, portrait: me.portrait };
  const faces = <CharacterTabs characters={mine} current={me.id} href="/swipe?character=" label="Whose deck" taken={taken} takenNote="can't swipe" />;

  return (
    <article className="swipe-page swipe-fullscreen">
      <div className="swipe-topbar">
        <Link href="/" className="swipe-topbar-btn" aria-label="Close the deck">
          ✕
        </Link>
        <span className="swipe-topbar-name">
          <CharacterName character={meRef} label={first} link={false} size={24} />
        </span>
        <Link href={matchesHref} className="swipe-topbar-btn" aria-label={texts ? `Matches, ${texts} unread texts` : "Matches"}>
          💬{texts > 0 && <span className="nav-count">{texts > 99 ? "99+" : texts}</span>}
        </Link>
      </div>
      {mine.length > 1 && <div className="swipe-faces">{faces}</div>}
      <div className="swipe-intro">
        <p className="kicker">Swipe</p>
        <div className="matches-head">
          <h1>
            Who should <CharacterName character={meRef} label={first} size={30} /> meet?
          </h1>
        </div>
        {faces}
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
