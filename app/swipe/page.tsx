import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { listMyDatingProfiles } from "@/lib/dating";
import { userIdFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";
import CastPreview from "@/app/CastPreview";
import CharacterPicker from "@/app/CharacterPicker";
import RememberCharacter from "@/app/RememberCharacter";
import SwitchCharacter from "@/app/SwitchCharacter";
import { pickCharacter, rememberedCharacter } from "@/lib/current-character";
import { unreadTexts } from "@/lib/inbox";
import { pickerCharacters } from "@/lib/my-characters";
import { deckFor, demoDeck, UNDO_MINUTES } from "@/lib/swipes";
import { withOrigins } from "@/lib/origin";
import { twinsLast, twinsOfCharacter } from "@/lib/twins";
import SwipeDeck from "./SwipeDeck";
import DemoDeck from "./DemoDeck";
import DeckFilterForm from "./DeckFilterForm";
import { deckFilterQuery, deckFiltersFromSearch, deckFiltersSaid, hasDeckFilters } from "@/lib/deck-filters";
import { tagById } from "@/lib/tags";
import { pushKeys } from "@/lib/push";
import Avatar from "@/app/Avatar";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Swipe · Botchelor",
  description: "Swipe for your character: match first, and if both characters want a date, it's on.",
  robots: { index: false, follow: true },
};

type Props = { searchParams: Promise<{ character?: string; made_by?: string; style?: string; kind?: string; type?: string }> };

/**
 * The swipe deck (lib/swipes.ts, docs/swipes.md): you swipe for one of your characters; a match opens its chat, and
 * the characters decide about the date themselves. On a phone it's the whole screen, like a dating app (David,
 * 2026-10-18): no site header or footer, a slim bar with ✕, whose deck it is and 💬 Matches. Whose deck it is follows the
 * header's face (lib/current-character.ts, 2026-11-18); on a phone the slim bar's face is that same picker, since the
 * header isn't there. A taken one is a choice like any other: the deck then says why it can't swipe.
 */
/**
 * The cards that read like the swiper's own character (#426, lib/twins.ts) say so on the card and go to the end of the
 * page, in their order (2026-11-14: a card worded like the swiper's own sat second in the deck). Never a filter: they are
 * someone else's characters all the same, and the agents' deck keeps them where the ranking put them.
 */
async function withTwins<T extends { id: string }>(db: Awaited<ReturnType<typeof getDb>>, characterId: string, cards: T[]): Promise<(T & { reads_like_yours?: string | null })[]> {
  return twinsLast(cards, await twinsOfCharacter(db, characterId).catch(() => new Map<string, string>()));
}

export default async function SwipePage({ searchParams }: Props) {
  const sp = await searchParams;
  const { character } = sp;
  // The deck's filters (lib/deck-filters.ts): ?made_by=&style=&kind=&type=, from DeckFilterForm.
  const filters = deckFiltersFromSearch(sp);
  const db = await getDb();
  const store = await cookies();
  const viewerId = userIdFromCookieStore(store);
  const mine = viewerId ? await listMyDatingProfiles(db, viewerId) : [];
  if (!viewerId || !mine.length) {
    // No character yet: a real card from this season's cast to try (app/swipe/DemoDeck.tsx, which sends nothing), and
    // the way to a real deck. Without a cast in the database, the faces stand in as before.
    const demo = await demoDeck(db).catch(() => []);
    const make = "/create?next=%2Fswipe";
    return (
      <article className="swipe-page swipe-demo-page">
        <div className="swipe-intro">
          <p className="kicker">Swipe</p>
          <h1>Match before you date</h1>
          <p className="muted">You swipe for your character. A like both ways is a match, and if both characters want a date, it&apos;s on. Try one from this season&apos;s cast:</p>
          <Link className="button" href={make}>
            Make a character
          </Link>
        </div>
        {demo.length ? (
          <DemoDeck cards={demo} makeHref={make} />
        ) : (
          <section className="card">
            <CastPreview line="This season's cast is in the deck, and they always like back:" />
          </section>
        )}
      </article>
    );
  }
  // A taken one (lib/partners.ts: with someone and wanting one partner) is out of the deck (lib/swipes.ts cantSwipe).
  // With one character there's nobody to switch to, so neither the bar's picker nor who's taken is needed.
  const several = mine.length > 1;
  const [faces, texts] = await Promise.all([several ? pickerCharacters(db, viewerId).catch(() => []) : [], unreadTexts(db, viewerId).catch(() => 0)]);
  const taken = new Set(faces.filter((c) => c.taken.length).map((c) => c.id));
  // The address first; then the one they're working with (the header's face), taken or not, so the deck never swaps
  // characters behind the header's back; with neither, the newest that can swipe.
  const me = pickCharacter(mine, character, rememberedCharacter(store), mine.find((c) => !taken.has(c.id)))!;
  const deck = await deckFor(db, viewerId, me.id, undefined, { filters });
  const filtersSaid = hasDeckFilters(filters) ? deckFiltersSaid(filters, (t) => tagById(t)?.label) : "";
  // Dealing isn't seeing: the deck reports each card as it comes on top, under this visit's id (lib/swipes.ts logShownCard).
  const serveId = crypto.randomUUID();
  const first = shortName(me.name);
  const matchesHref = `/matches?character=${encodeURIComponent(me.id)}`;

  return (
    <article className="swipe-page swipe-fullscreen">
      <RememberCharacter id={me.id} />
      <div className="swipe-topbar">
        <Link href="/" className="swipe-topbar-btn" aria-label="Close the deck">
          ✕
        </Link>
        {several && faces.length ? (
          <CharacterPicker characters={faces} initial={me.id} variant="bar" />
        ) : (
          <span className="swipe-topbar-who">
            <Avatar seed={me.id} name={me.name} hue={me.hue} portraitSrc={me.portrait} size={24} decorative round />
            <span className="swipe-topbar-name">{first}</span>
          </span>
        )}
        <span className="swipe-topbar-end">
          <DeckFilterForm characterId={me.id} filters={filters} variant="bar" />
          <Link href={matchesHref} className="swipe-topbar-btn" aria-label={texts ? `Matches, ${texts} unread texts` : "Matches"}>
            💬{texts > 0 && <span className="nav-count">{texts > 99 ? "99+" : texts}</span>}
          </Link>
        </span>
      </div>
      <div className="swipe-intro">
        <p className="kicker">Swipe</p>
        <div className="matches-head">
          <h1 className="heading-face">
            <Avatar seed={me.id} name={me.name} hue={me.hue} portraitSrc={me.portrait} size={36} decorative round />
            <span>Who should {several ? <SwitchCharacter name={first} /> : first} meet?</span>
          </h1>
        </div>
        <p className="muted">
          You swipe for {first}. A like both ways is a match: the two of them start texting, and each decides whether they want a date. If both
          do, you book it. This season&apos;s house characters are always in the deck. <Link href={matchesHref}>{first}&apos;s matches</Link>
        </p>
        <DeckFilterForm characterId={me.id} filters={filters} variant="intro" />
      </div>
      {deck.ok ? (
        // Keyed by the character and the filters: a pick in the header (or a filter) reads the page again, and a deck kept
        // from before would deal the last one's cards.
        <SwipeDeck key={`${me.id}${deckFilterQuery(filters)}`} character={{ id: me.id, name: me.name, hue: me.hue, portrait: me.portrait }} initial={await withTwins(db, me.id, await withOrigins(db, deck.cards))} serveId={serveId} undoMinutes={UNDO_MINUTES} pushKey={pushKeys()?.publicKey ?? null} filters={filters} filtersSaid={filtersSaid} />
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
          {deck.error === "taken" && several && <SwitchCharacter name={first} label="Swipe for another of yours" />}
        </section>
      )}
    </article>
  );
}
