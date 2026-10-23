import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { listMyDatingProfiles } from "@/lib/dating";
import { userIdFromCookieStore } from "@/lib/http";
import { characterToOpen, listThreads, newsByCharacter, type Thread } from "@/lib/inbox";
import { shortName } from "@/lib/names";
import { takenWith } from "@/lib/partners";
import CharacterTabs from "@/app/CharacterTabs";
import CastPreview from "@/app/CastPreview";
import Pager from "@/app/Pager";
import { pageHref, pageOf, parsePage } from "@/lib/paging";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Matches · Botchelor",
  description: "Your character's matches and texts.",
  robots: { index: false, follow: false },
};

type Props = { searchParams: Promise<{ character?: string; page?: string | string[] }> };

/** The conversations: this many a page (?page=N). The new-match faces above are a row, not paged. */
const CONVERSATIONS_PAGE = 10;

/** "now", "12m", "3h", "Tue", "Oct 12": how long ago, as a messaging app's list says it. */
function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  const d = new Date(iso);
  if (mins < 6 * 24 * 60) return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The next step as a badge, for the ones worth acting on (the thread's action bar has the button). */
function dateBadge(t: Thread): string | null {
  switch (t.next?.kind) {
    case "book":
      return "📅 Book their date";
    case "filming":
      return "🎬 On now";
    case "dated":
      return t.next.aired ? null : "🎬 Date ready";
    case "declined":
      return "Not this time";
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
  const { character, page } = await searchParams;
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
  const inbox = (await listThreads(db, viewerId, me.id)) ?? { fresh: [], conversations: [] };
  const first = shortName(me.name);
  const now = Date.now();
  const convos = pageOf(inbox.conversations, parsePage(page), CONVERSATIONS_PAGE);
  const thread = (t: Thread) => `${t.link}?as=${encodeURIComponent(me.id)}`;

  return (
    <article className="matches-page">
      <header className="matches-head">
        <h1>{first}&apos;s matches</h1>
      </header>
      <CharacterTabs characters={mine} current={me.id} href="/matches?character=" label="Whose matches" news={news} taken={taken} takenNote="closed to other dates" />
      <p className="matches-sub">
        <Link href={`/characters/${encodeURIComponent(me.id)}`}>{first}&apos;s card</Link> ·{" "}
        <Link href={`/swipe?character=${encodeURIComponent(me.id)}`}>Swipe for {first}</Link>
      </p>

      {inbox.fresh.length > 0 && (
        <section className="matches-fresh" aria-labelledby="fresh-title">
          <h2 id="fresh-title" className="matches-label">
            New matches
          </h2>
          <ul className="matches-faces">
            {inbox.fresh.map((t) => (
              <li key={t.with.id}>
                <Link href={thread(t)} className="matches-face">
                  <Avatar seed={t.with.id} name={t.with.name} hue={t.with.hue} house={t.with.house} portraitSrc={t.with.portrait} size={68} />
                  <span className="matches-face-name">{shortName(t.with.name)}</span>
                  {t.new_match && !dateBadge(t) && <span className="badge matches-face-badge matches-new">New</span>}
                  {dateBadge(t) && <span className="badge matches-face-badge">{dateBadge(t)}</span>}
                </Link>
              </li>
            ))}
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
                          {ago(t.last!.at, now)}
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
        <Pager page={convos.page} pages={convos.pages} label="Messages pages" href={(n) => pageHref("/matches", { character: me.id }, "page", n, "messages-title")} prev="Newer" next="Older" scroll={false} />
        {inbox.conversations.length ? null : (
          <p className="muted matches-empty">
            {inbox.fresh.length
              ? `No texts yet. ${first}'s matches text each other soon after they match.`
              : `No matches yet. Swipe for ${first}: a like both ways is a match, and the two start texting.`}{" "}
            <Link href={`/swipe?character=${encodeURIComponent(me.id)}`}>Swipe for {first}</Link>
          </p>
        )}
      </section>
    </article>
  );
}
