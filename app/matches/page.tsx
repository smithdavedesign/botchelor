import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import When from "@/app/When";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { listMyDatingProfiles } from "@/lib/dating";
import { userIdFromCookieStore } from "@/lib/http";
import { characterToOpen, listThreads, newsByCharacter, type Thread } from "@/lib/inbox";
import { shortName } from "@/lib/names";
import { takenWith } from "@/lib/partners";
import CharacterTabs from "@/app/CharacterTabs";
import MixerJoin from "@/app/MixerJoin";
import CastPreview from "@/app/CastPreview";
import Pager from "@/app/Pager";
import { pageHref, pageOf, parsePage } from "@/lib/paging";
import CharacterName from "@/app/CharacterName";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Matches · Botchelor",
  description: "Your character's matches and texts.",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ character?: string; page?: string | string[]; all?: string }> };

/** The conversations: this many a page (?page=N). The new-match faces above are a row, not paged. */
const CONVERSATIONS_PAGE = 10;

/**
 * The next step as a badge, for the ones worth acting on (the thread's action bar has the button). `short` is for the
 * new-match faces, whose column fits a word or two on one line.
 */
function dateBadge(t: Thread, short = false): string | null {
  switch (t.next?.kind) {
    // A status, not a button (2026-10-31 UX audit: "📅 Book their date" read as one); the thread's bar has the button.
    case "book":
      return short ? "📅 Agreed" : "📅 Date agreed";
    case "filming":
      return "🎬 On now";
    case "dated":
      // Shown with the ones that didn't work out (?all=1): their last date was a disaster.
      return t.next.aired ? (t.over ? (short ? "Over" : "Didn't work out") : null) : short ? "🎬 Ready" : "🎬 Date ready";
    case "declined":
      return short ? "Passed" : "Not this time";
    default:
      return null;
  }
}

/**
 * Matches (David, 2026-10-18): one of your characters at a time, like a dating app. New matches with no texts yet
 * are a row of faces; everyone else is a conversation, newest first, with the last text. Each opens the thread and
 * nothing else (/messages). A swipe match and anyone it has dated both count: they all text.
 */
export default async function MatchesPage({ searchParams }: Props) {
  const { character, page, all } = await searchParams;
  const db = await getDb();
  const viewerId = userIdFromCookieStore(await cookies());
  const mine = viewerId ? await listMyDatingProfiles(db, viewerId) : [];
  if (!viewerId || !mine.length) {
    return (
      <article className="matches-page">
        <h1>Matches</h1>
        <section className="card">
          <p>Make a character first: you swipe for them, and every match and every date partner texts them here.</p>
          <Link className="button" href="/create?next=%2Fmatches">
            Make a character
          </Link>
          <CastPreview line="Who'd be texting you: this season's cast, and every character you match with." />
        </section>
      </article>
    );
  }
  // Without one asked for, open on the character the newest news is about (the nav's count can be anyone's). The taken
  // ones are marked on the faces, the same as on /swipe.
  const ids = mine.map((c) => c.id);
  const [news, taken] = await Promise.all([newsByCharacter(db, viewerId, ids), takenWith(db, ids)]);
  const me = mine.find((c) => c.id === character) ?? characterToOpen(mine, news) ?? mine[0];
  const everyone = (await listThreads(db, viewerId, me.id)) ?? { fresh: [], conversations: [] };
  // The ones that didn't work out (someone passed, or the date was a disaster) stay out of the main list unless asked
  // for (?all=1; David, 2026-11-01).
  const showAll = all === "1";
  const over = [...everyone.fresh, ...everyone.conversations].filter((t) => t.over).length;
  const inbox = showAll ? everyone : { fresh: everyone.fresh.filter((t) => !t.over), conversations: everyone.conversations.filter((t) => !t.over) };
  const params = { character: me.id, all: showAll ? "1" : undefined };
  const first = shortName(me.name);
  const convos = pageOf(inbox.conversations, parsePage(page), CONVERSATIONS_PAGE);
  const thread = (t: Thread) => `${t.link}?as=${encodeURIComponent(me.id)}`;

  return (
    <article className="matches-page">
      {/* 2026-10-31 UX audit: the name was said three times up here. With two or more characters the tabs below say whose
          matches these are; with one, the heading does, and its face opens their card. */}
      <header className="matches-head">
        <h1>
          {mine.length > 1 ? (
            "Matches"
          ) : (
            <>
              <CharacterName character={me} label={first} size={32} />
              &apos;s matches
            </>
          )}
        </h1>
        <Link className="button secondary matches-swipe" href={`/swipe?character=${encodeURIComponent(me.id)}`}>
          Swipe for {first}
        </Link>
      </header>
      <CharacterTabs characters={mine} current={me.id} href="/matches?character=" label="Whose matches" news={news} taken={taken} takenNote="closed to other dates" />
      {/* 2026-10-25 page review: the mixer leads only an empty inbox (somewhere to go); with chats, it follows them. */}
      {!taken.has(me.id) && !inbox.conversations.length && !inbox.fresh.length && <MixerJoin characterId={me.id} first={first} />}

      {inbox.fresh.length > 0 && (
        <section className="matches-fresh" aria-labelledby="fresh-title">
          <h2 id="fresh-title" className="matches-label">
            New matches
          </h2>
          <ul className="matches-faces">
            {inbox.fresh.map((t) => {
              const badge = dateBadge(t, true);
              return (
                <li key={t.with.id}>
                  <Link href={thread(t)} className="matches-face" title={dateBadge(t) ?? undefined}>
                    <Avatar seed={t.with.id} name={t.with.name} hue={t.with.hue} house={t.with.house} portraitSrc={t.with.portrait} size={68} />
                    <span className="matches-face-name">{shortName(t.with.name)}</span>
                    {t.new_match && !badge && <span className="badge matches-face-badge matches-new">New</span>}
                    {badge && <span className="badge matches-face-badge">{badge}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="messages-title">
        <h2 id="messages-title" className="matches-label">
          Messages
        </h2>
        {inbox.conversations.length ? (
          <ul className="matches-list">
            {convos.items.map((t) => {
              const badge = dateBadge(t);
              return (
                <li key={t.with.id}>
                  <Link href={thread(t)} className={`matches-row${t.unread ? " is-unread" : ""}`}>
                    <Avatar seed={t.with.id} name={t.with.name} hue={t.with.hue} house={t.with.house} portraitSrc={t.with.portrait} size={56} />
                    <span className="matches-row-body">
                      <span className="matches-row-top">
                        <strong className="matches-row-name">{shortName(t.with.name)}</strong>
                        {t.new_match && !badge && <span className="badge matches-new">New match</span>}
                        {badge && <span className="badge">{badge}</span>}
                        <time className="matches-row-time" dateTime={t.last!.at}>
                          <When iso={t.last!.at} />
                        </time>
                      </span>
                      <span className="matches-row-preview">
                        {t.last!.mine && <span className="muted">{first}: </span>}
                        {t.last!.text}
                      </span>
                    </span>
                    {t.unread > 0 && <span className="matches-dot" aria-label={`${t.unread} new`} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
        <Pager page={convos.page} pages={convos.pages} label="Messages pages" href={(n) => pageHref("/matches", params, "page", n, "messages-title")} prev="Newer" next="Older" scroll={false} />
        {inbox.conversations.length ? null : (
          <p className="muted matches-empty">
            {inbox.fresh.length
              ? `No texts yet. ${first}'s matches text each other soon after they match.`
              : over
                ? `Nothing open right now. Swipe for ${first}: a like both ways is a match, and the two start texting.`
                : `No matches yet. Swipe for ${first}: a like both ways is a match, and the two start texting.`}{" "}
            <Link href={`/swipe?character=${encodeURIComponent(me.id)}`}>Swipe for {first}</Link>
          </p>
        )}
        {over > 0 && (
          <p className="muted small matches-over">
            <Link href={pageHref("/matches", { character: me.id, all: showAll ? undefined : "1" }, "page", 1, "messages-title")} scroll={false}>
              {showAll ? `Hide the ${over} that didn't work out` : `Show ${over} that didn't work out`}
            </Link>
          </p>
        )}
      </section>
      {!taken.has(me.id) && (inbox.conversations.length > 0 || inbox.fresh.length > 0) && <MixerJoin characterId={me.id} first={first} />}
    </article>
  );
}
