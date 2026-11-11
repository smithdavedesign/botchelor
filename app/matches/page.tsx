import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import EmptyState from "@/app/EmptyState";
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

type Props = { searchParams: Promise<{ character?: string; page?: string | string[]; show?: string; all?: string }> };

/** The conversations: this many a page (?page=N). The new-match faces above are a row, not paged. */
const CONVERSATIONS_PAGE = 10;

/**
 * The next step as a badge, for the ones worth acting on (the thread's action bar has the button). `short` is for the
 * new-match faces, whose column fits a word or two on one line. A pair that didn't work out says why, by name
 * (David, 2026-11-11: matches "didn't appear" and nothing said what became of them).
 */
function dateBadge(t: Thread, first: string, short = false): string | null {
  switch (t.next?.kind) {
    // A status, not a button (2026-10-31 UX audit: "📅 Book their date" read as one); the thread's bar has the button.
    case "book":
      return short ? "📅 Agreed" : "📅 Date agreed";
    case "filming":
      return "🎬 On now";
    case "dated":
      // Their last date was a disaster (it aired).
      return t.next.aired ? (t.over ? (short ? "Went badly" : "Date went badly") : null) : short ? "🎬 Ready" : "🎬 Date ready";
    case "declined":
      return short ? "Passed" : `${t.next.by === "you" ? first : shortName(t.with.name)} passed`;
    default:
      return null;
  }
}

/**
 * Whether a thread sits under "Didn't work out" instead of the open list (David, 2026-11-01: by default, not the ones
 * that weren't feeling it or whose date ended badly). Not while it has something the viewer hasn't seen: a new match
 * or a text they haven't read stays in the open list, with why on its badge, so a match never vanishes before it's seen.
 */
const filedAway = (t: Thread) => t.over && !t.new_match && t.unread === 0;

/**
 * Matches (David, 2026-10-18): one of your characters at a time, like a dating app. New matches with no texts yet
 * are a row of faces; everyone else is a conversation, newest first, with the last text. Each opens the thread and
 * nothing else (/messages). A swipe match and anyone it has dated both count: they all text.
 */
export default async function MatchesPage({ searchParams }: Props) {
  const { character, page, show, all } = await searchParams;
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
  // Two lists, one at a time (David, 2026-11-11: "Show N that didn't work out" mixed them back in with everyone, so it
  // didn't filter): the open ones, and the ones that didn't work out (?show=over; ?all=1 is the old link to it).
  const showOver = show === "over" || all === "1";
  const filed = [...everyone.fresh, ...everyone.conversations].filter(filedAway).sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  const inbox = { fresh: everyone.fresh.filter((t) => !filedAway(t)), conversations: everyone.conversations.filter((t) => !filedAway(t)) };
  const openCount = inbox.fresh.length + inbox.conversations.length;
  const params = { character: me.id, show: showOver ? "over" : undefined };
  const first = shortName(me.name);
  const convos = pageOf(showOver ? filed : inbox.conversations, parsePage(page), CONVERSATIONS_PAGE);
  const thread = (t: Thread) => `${t.link}?as=${encodeURIComponent(me.id)}`;
  const listHref = (over: boolean) => pageHref("/matches", { character: me.id, show: over ? "over" : undefined }, "page", 1, "messages-title");
  const row = (t: Thread) => {
    const badge = dateBadge(t, first);
    return (
      <li key={t.with.id}>
        <Link href={thread(t)} className={`matches-row${t.unread ? " is-unread" : ""}`}>
          <Avatar seed={t.with.id} name={t.with.name} hue={t.with.hue} house={t.with.house} portraitSrc={t.with.portrait} size={56} />
          <span className="matches-row-body">
            <span className="matches-row-top">
              <strong className="matches-row-name">{shortName(t.with.name)}</strong>
              {t.new_match && !badge && <span className="badge matches-new">New match</span>}
              {badge && <span className="badge">{badge}</span>}
              <time className="matches-row-time" dateTime={t.at}>
                <When iso={t.at} />
              </time>
            </span>
            <span className="matches-row-preview">
              {t.last ? (
                <>
                  {t.last.mine && <span className="muted">{first}: </span>}
                  {t.last.text}
                </>
              ) : (
                <span className="muted">Matched, no texts</span>
              )}
            </span>
          </span>
          {t.unread > 0 && <span className="matches-dot" aria-label={`${t.unread} new`} />}
        </Link>
      </li>
    );
  };

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
      {(filed.length > 0 || showOver) && (
        <nav className="tabs matches-filter" aria-label="Which matches">
          <Link href={listHref(false)} aria-current={showOver ? undefined : "page"} scroll={false}>
            Open · {openCount}
          </Link>
          <Link href={listHref(true)} aria-current={showOver ? "page" : undefined} scroll={false}>
            Didn&apos;t work out · {filed.length}
          </Link>
        </nav>
      )}

      {showOver ? (
        <section aria-labelledby="messages-title">
          <h2 id="messages-title" className="matches-label">
            Didn&apos;t work out
          </h2>
          <p className="muted small matches-over-note">Someone passed on a date, or their last date went badly. Every thread is still here.</p>
          {filed.length ? <ul className="matches-list">{convos.items.map(row)}</ul> : null}
          <Pager page={convos.page} pages={convos.pages} label="Didn't work out pages" href={(n) => pageHref("/matches", params, "page", n, "messages-title")} prev="Newer" next="Older" scroll={false} />
          {filed.length ? null : (
            <EmptyState emoji="🌱" title="Nothing here" action={{ href: listHref(false), label: `Back to ${first}'s matches` }}>
              {`All of ${first}'s matches are still open.`}
            </EmptyState>
          )}
        </section>
      ) : (
        <>
          {/* 2026-10-25 page review: the mixer leads only an empty inbox (somewhere to go); with chats, it follows them. */}
          {!taken.has(me.id) && !openCount && <MixerJoin characterId={me.id} first={first} />}

          {inbox.fresh.length > 0 && (
            <section className="matches-fresh" aria-labelledby="fresh-title">
              <h2 id="fresh-title" className="matches-label">
                New matches
              </h2>
              <ul className="matches-faces">
                {inbox.fresh.map((t) => {
                  const badge = dateBadge(t, first, true);
                  return (
                    <li key={t.with.id}>
                      <Link href={thread(t)} className="matches-face" title={dateBadge(t, first) ?? undefined}>
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
            {inbox.conversations.length ? <ul className="matches-list">{convos.items.map(row)}</ul> : null}
            <Pager page={convos.page} pages={convos.pages} label="Messages pages" href={(n) => pageHref("/matches", params, "page", n, "messages-title")} prev="Newer" next="Older" scroll={false} />
            {inbox.conversations.length ? null : (
              <EmptyState
                emoji="💌"
                title={inbox.fresh.length ? "No texts yet" : filed.length ? "Nothing open right now" : `No matches yet for ${first}`}
                action={{ href: `/swipe?character=${encodeURIComponent(me.id)}`, label: `Swipe for ${first}` }}
                secondary={filed.length ? { href: listHref(true), label: `See the ${filed.length} that didn't work out` } : { href: "/companion", label: "Talk to a companion" }}
              >
                {inbox.fresh.length
                  ? `${first}'s matches text each other soon after they match.`
                  : "A like both ways is a match, and the two start texting."}
              </EmptyState>
            )}
          </section>
          {!taken.has(me.id) && openCount > 0 && <MixerJoin characterId={me.id} first={first} />}
        </>
      )}
    </article>
  );
}
