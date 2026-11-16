import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import EmptyState from "@/app/EmptyState";
import Pager from "@/app/Pager";
import When from "@/app/When";
import TalkButton from "@/app/companion/TalkButton";
import CharacterTabs from "@/app/CharacterTabs";
import RememberCharacter from "@/app/RememberCharacter";
import { CHAT_FILTERS, chatFilter, filterChat, loadChat, newsOfRows, rowsOfCharacter, type ChatFace, type ChatFilter, type ChatInbox, type ChatRow } from "@/lib/chat-inbox";
import { companionAccessFromCookies, companionGuestFromCookies } from "@/lib/companion-access";
import { companionOpen } from "@/lib/companion-shared";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { shortName } from "@/lib/names";
import { pageHref, pageOf, parsePage } from "@/lib/paging";
import { seasonCastCards } from "@/lib/season-cast";
import { shared } from "@/lib/shared-cache";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chat · Botchelor",
  description: "Every text in one place: the characters texting you, and your characters' own threads.",
  robots: { index: false, follow: false },
};

type Props = { searchParams?: Promise<{ show?: string | string[]; page?: string | string[]; character?: string | string[] }> };

/** Threads a page (?page=N). */
const CHAT_PAGE = 20;
/** The faces an empty inbox offers: people to text now. */
const CAST_FACES = 3;

const FILTER_LABEL: Record<ChatFilter, string> = { all: "All", you: "With you", dating: "Their dating" };
const EMPTY: ChatInbox = { rows: [], counts: { all: 0, you: 0, dating: 0 }, characters: [], unlisted: 0 };

/** This season's house cast, who anyone may text (lib/companion.ts companionEligible): the same few for everyone. */
const castFaces = async (): Promise<ChatFace[]> =>
  shared("chat:cast-faces", async () =>
    (await seasonCastCards(await getDb()))
      .filter((c) => !c.fan)
      .slice(0, CAST_FACES)
      .map((c) => ({ id: c.id, name: c.name, hue: c.hue, house: true, portrait: c.portrait })),
  ).catch(() => []);

function Row({ r }: { r: ChatRow }) {
  const news = r.unread > 0 || r.new_match;
  return (
    <li>
      <Link href={r.href} className={`matches-row chat-row${news ? " is-unread" : ""}`} data-chat-kind={r.kind} data-track="chat-open" data-track-kind={r.kind}>
        {/* A thread with you is one face; your character's thread is the two of them, yours behind. */}
        <span className={`chat-faces${r.mine ? " is-pair" : ""}`}>
          {r.mine && <Avatar seed={r.mine.id} name={r.mine.name} hue={r.mine.hue} house={false} portraitSrc={r.mine.portrait} size={40} decorative />}
          <Avatar seed={r.who.id} name={r.who.name} hue={r.who.hue} house={r.who.house} portraitSrc={r.who.portrait} size={r.mine ? 40 : 56} decorative />
        </span>
        <span className="matches-row-body">
          <span className="matches-row-top">
            <strong className="matches-row-name">{r.title}</strong>
            <span className="chat-kind">{r.says}</span>
            {r.new_match && <span className="badge matches-new">New match</span>}
            <time className="matches-row-time" dateTime={r.at}>
              <When iso={r.at} />
            </time>
          </span>
          <span className="matches-row-preview">
            {r.last ? (
              <>
                {r.last.by && <span className="muted">{r.last.by}: </span>}
                {r.last.text}
              </>
            ) : (
              <span className="muted">{r.kind === "dating" ? "Matched, no texts yet" : "No texts yet"}</span>
            )}
          </span>
        </span>
        {news && <span className="matches-dot" aria-label={r.unread > 0 ? `${r.unread} new` : "New match"} />}
      </Link>
    </li>
  );
}

/**
 * Chat (lib/chat-inbox.ts): every thread the viewer has, newest first: the characters texting them (their own after a
 * date, the cast, anyone they've started a thread with) and their characters' threads with other characters. Each row
 * says which it is and opens the thread's own page. Someone with nothing yet gets three of the cast to text now and
 * the way to a character of their own.
 *
 * Someone with several characters gets their faces above the list (lib/current-character.ts): "All" first and the
 * default, since nobody should miss a text because the wrong character was picked; a face narrows the list to that
 * character's threads (?character=) and is remembered for the next door. Each face carries what's new for it.
 */
export default async function ChatPage({ searchParams }: Props = {}) {
  const sp = (await searchParams) ?? {};
  const filter = chatFilter(sp.show);
  const store = await cookies();
  const auth = authFromCookieStore(store);
  const db = await getDb();
  // Threads with the viewer are theirs where companions are open to them (signed in, or a guest on a signed identity).
  const access = await companionAccessFromCookies(db, auth, store).catch(() => null);
  const [inbox, faces] = await Promise.all([
    auth ? loadChat(db, { userId: auth.userId, withYou: access !== null }).catch(() => EMPTY) : EMPTY,
    castFaces(),
  ]);
  const hasCharacter = inbox.characters.length > 0;
  // Who can start a thread right now: someone companions are open to, or a visitor who may try as a guest (their first
  // text makes them an identity). Otherwise, once companions are open to everyone, an account comes first.
  const canText = access !== null || companionGuestFromCookies(auth, store);
  const textDoor = canText || companionOpen();
  // One of their characters, when the address asks for it (never the remembered one: Chat opens on everything).
  const asked = Array.isArray(sp.character) ? sp.character[0] : sp.character;
  const only = inbox.characters.find((c) => c.id === asked) ?? null;
  const mineRows = only ? rowsOfCharacter(inbox.rows, only.id) : inbox.rows;
  const counts: Record<ChatFilter, number> = only
    ? { all: mineRows.length, you: mineRows.filter((r) => r.kind === "you").length, dating: mineRows.filter((r) => r.kind === "dating").length }
    : inbox.counts;
  const rows = filterChat(mineRows, filter);
  const shown = pageOf(rows, parsePage(sp.page), CHAT_PAGE);
  const href = (f: ChatFilter, n = 1) => pageHref("/chat", { character: only?.id, show: f === "all" ? undefined : f }, "page", n);
  const lead = only ?? inbox.characters[0] ?? null;
  const first = lead ? shortName(lead.name) : null;
  const findMatch = lead ? `/swipe?character=${encodeURIComponent(lead.id)}` : null;
  const news = newsOfRows(inbox.rows, inbox.characters.map((c) => c.id));

  return (
    <article className="chat-page matches-page">
      <header className="matches-head">
        <h1>Chat</h1>
        {/* The ways to start something, beside a list; an empty inbox carries its own below, once. */}
        {inbox.counts.all > 0 && (
          <p className="chat-start">
            {textDoor && (
              <Link className="button" href="/companion" data-track="chat-text-someone">
                Text someone
              </Link>
            )}
            {findMatch ? (
              <Link className="button secondary" href={findMatch} data-track="chat-find-match">
                Find a match
              </Link>
            ) : (
              <Link className="button secondary" href="/create?next=%2Fchat" data-track="chat-make">
                Make your character
              </Link>
            )}
          </p>
        )}
      </header>
      <p className="muted small chat-lede">
        Every text in one place: the characters texting you, and {first ? `${inbox.characters.length > 1 ? "your characters'" : `${first}'s`} own threads` : "your character's own threads once you have one"}.
      </p>
      {only && <RememberCharacter id={only.id} />}
      {/* Whose chats (lib/current-character.ts): nothing for someone with one character or none. */}
      <CharacterTabs characters={inbox.characters} current={only?.id ?? ""} href="/chat?character=" label="Whose chats" news={news} all={{ href: "/chat", label: "All" }} />
      {inbox.counts.all > 0 && (
        <nav className="segmented chat-filter" aria-label="Which chats">
          {CHAT_FILTERS.map((f) => (
            <Link key={f} href={href(f)} className="segmented-tab" aria-current={f === filter ? "page" : undefined} scroll={false}>
              {FILTER_LABEL[f]} <span className="segmented-count">{counts[f]}</span>
            </Link>
          ))}
        </nav>
      )}

      {rows.length > 0 ? (
        <>
          <ul className="matches-list chat-list">
            {shown.items.map((r) => (
              <Row key={r.key} r={r} />
            ))}
          </ul>
          <Pager page={shown.page} pages={shown.pages} label="Chat pages" href={(n) => href(filter, n)} prev="Newer" next="Older" scroll={false} />
        </>
      ) : inbox.counts.all > 0 ? (
        // Threads of the other kind only: say what this kind is and how one starts.
        filter === "dating" ? (
          <EmptyState emoji="💌" title={hasCharacter ? "No matches texting yet" : "This is where your character's texts go"} action={findMatch ? { href: findMatch, label: "Find a match" } : { href: "/create?next=%2Fchat", label: "Make your character" }} secondary={{ href: href("all"), label: "All chats" }}>
            {hasCharacter ? "A like both ways is a match, and the two start texting. Every date partner texts here too." : "Make a character and its matches and date partners text each other here."}
          </EmptyState>
        ) : (
          <EmptyState emoji="💬" title="Nobody is texting you yet" action={textDoor ? { href: "/companion", label: "Text someone" } : undefined} secondary={{ href: href("all"), label: "All chats" }}>
            Text any of the cast, or your own character: it texts you after its dates.
          </EmptyState>
        )
      ) : (
        <section className="card chat-empty" aria-labelledby="chat-empty-title">
          <h2 id="chat-empty-title">No texts yet</h2>
          <p className="muted">
            {faces.length > 0 && textDoor ? "Text one of the cast now. They're AI characters on a dating show, and they'll tell you how their week is going." : "Texts land here once you have someone to text."}
            {!hasCharacter && " Or make your own character: it goes on dates, and texts you after each one."}
          </p>
          {faces.length > 0 && (
            <ul className="chat-cast">
              {faces.map((c) => (
                <li key={c.id} className="chat-cast-face">
                  <Link href={`/characters/${c.id}`} className="chat-cast-who" title={c.name}>
                    <Avatar seed={c.id} name={c.name} hue={c.hue} house portraitSrc={c.portrait} size={72} />
                    <strong>{shortName(c.name)}</strong>
                  </Link>
                  {canText ? (
                    <TalkButton characterId={c.id} name={shortName(c.name)} label={`Text ${shortName(c.name)}`} className="button secondary small" track="verb-text" />
                  ) : (
                    textDoor && (
                      <Link className="button secondary small" href="/account?next=%2Fchat">
                        Sign in to text
                      </Link>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="cta-row chat-empty-actions">
            {hasCharacter && findMatch ? (
              <Link className="button" href={findMatch} data-track="chat-find-match">
                Find {first} a match
              </Link>
            ) : (
              <Link className="button" href="/create?next=%2Fchat" data-track="chat-make">
                Make your character
              </Link>
            )}
            {textDoor && (
              <Link className="button secondary" href="/companion" data-track="chat-text-someone">
                Text someone
              </Link>
            )}
          </p>
        </section>
      )}

      {inbox.unlisted > 0 && (
        <p className="muted small chat-foot">
          Showing your {inbox.characters.length - inbox.unlisted} most recently active characters&apos; threads. <Link href="/matches">Every character&apos;s matches →</Link>
        </p>
      )}
      {hasCharacter && inbox.counts.dating > 0 && inbox.unlisted === 0 && (
        <p className="muted small chat-foot">
          Matches that didn&apos;t work out are kept on <Link href="/matches">{first && inbox.characters.length === 1 ? `${first}'s matches` : "Matches"}</Link>.
        </p>
      )}
    </article>
  );
}
