"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Avatar from "@/app/Avatar";
import { shortName } from "@/lib/names";
import { useT } from "@/app/I18nProvider";
import type { DeckCard as BaseCard, MatchView } from "@/lib/swipes";
import type { Origin } from "@/lib/origin";
import OriginBadge from "@/app/OriginBadge";
import PushToggle from "@/app/notifications/PushToggle";
import { kindLabel } from "@/lib/kinds";
import { deckFilterQuery, NO_DECK_FILTERS, type DeckFilters } from "@/lib/deck-filters";

/** A deck card with who made it (lib/origin.ts withOrigins). */
export type DeckCard = BaseCard & { origin?: Origin };

type Props = {
  character: { id: string; name: string; hue: number | null; portrait: string | null };
  initial: DeckCard[];
  /** This visit's deck session (app/swipe/page.tsx): each card shown on top is reported under it. */
  serveId: string;
  /** The site's push key (lib/push.ts), for "Tell me when they text" on a match; null when push isn't set up. */
  pushKey?: string | null;
  /** The deck's filters (lib/deck-filters.ts): the next cards are fetched with them, and an empty deck says so. */
  filters?: DeckFilters;
  /** The filters in words, for the empty deck ("made by people, anime"); "" with none. */
  filtersSaid?: string;
};

/** How far a card has to be dragged to count as a swipe. */
const THRESHOLD = 110;
/** Fetch more cards when this few are left. */
const REFILL_AT = 3;
/** How long a swipe waits for its card's impression to land first (it's almost always in by then). */
const SEEN_WAIT_MS = 1500;
/** The kind badge is for anything but human (most of the cast): the label to skip. */
const HUMAN = kindLabel({ kind: "human" });

/**
 * The swipe deck (lib/swipes.ts): one card at a time, the next peeking behind it. Drag it right to like, left to pass,
 * or use the buttons or the arrow keys. A match shows "It's a match!" and opens their thread; every match is on
 * /matches. The characters decide about a date themselves.
 *
 * A swipe is final on the web (Dave, 2026-11-28: "no take backs"; the Undo line under the deck pushed the whole page up on a
 * phone). Unmatching is in their messages (David, 2026-10-31).
 *
 * What's seen is what the preference data records (lib/swipes.ts logShownCard): each card is reported once, when it
 * comes on top, with its place in what this person has seen this visit. The hand that was dealt is never logged.
 */
export default function SwipeDeck({ character, initial, serveId, pushKey = null, filters = NO_DECK_FILTERS, filtersSaid = "" }: Props) {
  const t = useT();
  const [cards, setCards] = useState(initial);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const [matched, setMatched] = useState<DeckCard | null>(null);
  const [matchPage, setMatchPage] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(initial.length === 0);
  const startX = useRef<number | null>(null);
  /** A card on its way out (its 220ms): nothing else is decided meanwhile. */
  const busy = useRef(false);
  /** Swipes reach the server one at a time, in the order they were made; the deck doesn't wait for them. */
  const sending = useRef<Promise<void>>(Promise.resolve());
  /** Cards swiped this visit, so a refill that crosses a swipe still on its way can't deal one back. */
  const gone = useRef(new Set<string>());
  const refilling = useRef(false);
  const keep = useRef<HTMLButtonElement>(null);
  const first = shortName(character.name);
  const top = cards[0] ?? null;
  const next = cards[1] ?? null;

  const filterQuery = deckFilterQuery(filters);
  const refill = useCallback(async () => {
    if (refilling.current) return;
    refilling.current = true;
    try {
      const res = await fetch(`/api/swipes?character_id=${encodeURIComponent(character.id)}${filterQuery}`, { headers: { accept: "application/json" } });
      if (!res.ok) return;
      const data = (await res.json()) as { cards: DeckCard[] };
      if (!data.cards.length) setExhausted(true);
      setCards((shown) => {
        const have = new Set(shown.map((c) => c.id));
        return [...shown, ...data.cards.filter((c) => !have.has(c.id) && !gone.current.has(c.id))];
      });
    } catch {
      // The deck still shows what it has; another swipe tries again.
    } finally {
      refilling.current = false;
    }
  }, [character.id, filterQuery]);

  useEffect(() => {
    if (!exhausted && cards.length <= REFILL_AT) void refill();
  }, [cards.length, exhausted, refill]);

  // The card on top is the one being seen: reported once per visit (POST /api/swipes/seen), ranked in the order seen.
  const seen = useRef<{ serve: string; sent: Map<string, Promise<void>> }>({ serve: serveId, sent: new Map() });
  const topId = top?.id ?? null;
  useEffect(() => {
    if (!topId) return;
    if (seen.current.serve !== serveId) seen.current = { serve: serveId, sent: new Map() };
    const sent = seen.current.sent;
    if (sent.has(topId)) return;
    const report = fetch("/api/swipes/seen", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ character_id: character.id, card_id: topId, serve_id: serveId, rank: sent.size + 1 }),
      keepalive: true,
    }).then(
      () => undefined,
      () => undefined, // best effort: a lost impression never gets in the way of swiping
    );
    sent.set(topId, report);
  }, [topId, character.id, serveId]);

  const decide = useCallback(
    async (like: boolean) => {
      const card = cards[0];
      // `gone`: a second key press can land before the deck re-renders, with this card still first in its hand.
      if (!card || busy.current || gone.current.has(card.id)) return;
      busy.current = true;
      setError(null);
      setLeaving(like ? "right" : "left");
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      await new Promise((r) => setTimeout(r, still ? 0 : 220));
      gone.current.add(card.id);
      setCards((c) => c.slice(1));
      setLeaving(null);
      setDragX(0);
      setStatus(like ? t("Liked {name}.", { name: card.name }) : t("Passed on {name}.", { name: card.name }));
      // The next card can be swiped now (2026-10-31, live on a phone: a swipe within a second or so of the last one was
      // dropped while that one's request was out). This one's request goes in behind any still on their way.
      busy.current = false;
      const send = async () => {
        try {
          // Its impression goes in before its swipe: a like on the house cast is a match at once, and a match leaves the deck.
          await Promise.race([seen.current.sent.get(card.id), new Promise((r) => setTimeout(r, SEEN_WAIT_MS))]);
          const res = await fetch("/api/swipes", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ character_id: character.id, target_id: card.id, like }),
          });
          const data = (await res.json().catch(() => ({}))) as { message?: string; match?: MatchView | null };
          if (!res.ok) {
            gone.current.delete(card.id); // the server says what's dealt again
            setError(data.message ?? t("The swipe on {name} didn't go through.", { name: card.name }));
          } else if (data.match) {
            const m = data.match;
            setMatched(card);
            setMatchPage(`/messages/${m.lo}/${m.hi}?as=${encodeURIComponent(character.id)}`);
            setStatus(t("It's a match: {a} and {b}.", { a: first, b: card.name }));
          }
        } catch {
          gone.current.delete(card.id);
          setError(t("Network error: the swipe on {name} didn't go through.", { name: card.name }));
        }
      };
      sending.current = sending.current.then(send);
      await sending.current;
    },
    [cards, character.id, first, t],
  );

  // "It's a match!": the way out is focused, and Esc closes it.
  useEffect(() => {
    if (!matched) return;
    keep.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMatched(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [matched]);

  const onDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (busy.current || e.button !== 0) return;
    e.preventDefault(); // no text selection or native drag; vertical scrolling still works (touch-action: pan-y)
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (startX.current !== null) setDragX(e.clientX - startX.current);
  };
  const onUp = () => {
    if (startX.current === null) return;
    startX.current = null;
    setDragging(false);
    if (Math.abs(dragX) > THRESHOLD) void decide(dragX > 0);
    else setDragX(0);
  };
  // The browser took the gesture (a finger scrolling the profile, say): the card goes back, and it's never a swipe.
  const onCancel = () => {
    startX.current = null;
    setDragging(false);
    setDragX(0);
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      void decide(true);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      void decide(false);
    }
  };

  const x = leaving === "right" ? 700 : leaving === "left" ? -700 : dragX;
  const lean = Math.max(-1, Math.min(1, x / THRESHOLD));

  return (
    <>
      <div className="swipe-deck" tabIndex={0} onKeyDown={onKey} aria-label={t("{name}'s swipe deck. Right arrow likes, left arrow passes.", { name: first })}>
        {top ? (
          <div className="swipe-stack">
            {next && <Card card={next} className="swipe-card swipe-next" behind />}
            <Card
              key={top.id}
              card={top}
              className={`swipe-card swipe-top${dragging ? " is-dragging" : ""}`}
              style={{ transform: `translateX(${x}px) rotate(${x / 18}deg)` }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onCancel}
            >
              <span className="swipe-stamp swipe-stamp-like" style={{ opacity: Math.max(0, lean) }} aria-hidden="true">
                {t("Like")}
              </span>
              <span className="swipe-stamp swipe-stamp-nope" style={{ opacity: Math.max(0, -lean) }} aria-hidden="true">
                {t("Pass")}
              </span>
            </Card>
          </div>
        ) : (
          <div className="swipe-empty card">
            <p className="swipe-empty-icon" aria-hidden="true">
              💌
            </p>
            <p>
              <strong>{filtersSaid ? t("Nobody else here fits these filters.") : t("That's everyone for now.")}</strong>
            </p>
            <p className="muted small">
              {filtersSaid ? (
                <>
                  {t("Showing only {filters}.", { filters: filtersSaid })} <Link href={`/swipe?character=${encodeURIComponent(character.id)}`}>{t("Clear the filters")}</Link>
                </>
              ) : (
                <>
                  {t("New characters join the deck every day.")} <Link href={`/matches?character=${encodeURIComponent(character.id)}`}>{t("See {name}'s matches", { name: first })}</Link>
                </>
              )}
            </p>
          </div>
        )}
        {top && (
          <div className="swipe-actions">
            <button type="button" className="swipe-btn swipe-btn-nope" onClick={() => void decide(false)} aria-label={t("Pass on {name}", { name: top.name })}>
              ✕
            </button>
            <button type="button" className="swipe-btn swipe-btn-like" onClick={() => void decide(true)} aria-label={t("Like {name}", { name: top.name })}>
              ♥
            </button>
          </div>
        )}
        {top && (
          <p className="swipe-keys muted small" aria-hidden="true">
            ← {t("Pass")} · {t("Like")} →
          </p>
        )}
        <p className="sr-only" role="status">
          {status}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      {matched && (
        <div className="swipe-match-overlay" role="dialog" aria-modal="true" aria-labelledby="its-a-match">
          <div className="swipe-match-card">
            <div className="swipe-match-avatars">
              <Avatar seed={character.id} name={character.name} hue={character.hue} portraitSrc={character.portrait} size={88} />
              <Avatar seed={matched.id} name={matched.name} hue={matched.hue} house={matched.house} portraitSrc={matched.portrait} size={88} />
            </div>
            <h2 id="its-a-match">{t("It's a match!")}</h2>
            <p>
              {/* Full names when the first names are the same ("Marisol and Marisol" read as a typo). */}
              {t("{a} and {b} are texting now. If they both want a date, you'll be able to book it.", shortName(matched.name) === first ? { a: character.name, b: matched.name } : { a: first, b: shortName(matched.name) })}
            </p>
            <p className="swipe-match-buttons">
              <Link className="button" href={matchPage}>
                {t("Read their chat")}
              </Link>
              <button ref={keep} type="button" className="button-ghost" onClick={() => setMatched(null)}>
                {t("Keep swiping")}
              </button>
            </p>
            {/* J3: the peak is when someone wants to hear what happens next; gone once notifications are on. */}
            {pushKey && <PushToggle publicKey={pushKey} prompt emailFallback place="match" title={t("Tell me when they text")} body={t("A note the moment they text or agree to a date, even with the site closed.")} />}
          </div>
        </div>
      )}
    </>
  );
}

type CardProps = {
  card: DeckCard;
  className: string;
  /** The next card, peeking out behind the top one: only a shape until it comes up, so nothing in it is read or reached. */
  behind?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
};

/**
 * One dating-profile card: the look, who they are, two or three prompts, interests, what they're after, and why. Also the
 * demo deck's card (app/swipe/DemoDeck.tsx), so a visitor without a character swipes the real thing.
 */
export function Card({ card, className, behind, style, children, ...pointer }: CardProps) {
  const t = useT();
  // A long profile scrolls inside the card. With a mouse nothing said so (it faded out mid-sentence), so while there's
  // more below, a "More" button sits on the fade and scrolls it on.
  const body = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = body.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 24);
  }, []);
  useEffect(() => {
    measure();
    const el = body.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, card.id]);
  return (
    <article
      className={more ? `${className ?? ""} swipe-has-more`.trim() : className}
      style={style}
      aria-label={`${card.name}, ${card.age}`}
      aria-hidden={behind || undefined}
      inert={behind || undefined}
      {...pointer}
    >
      {children}
      {more && (
        <button
          type="button"
          className="swipe-more"
          tabIndex={-1}
          aria-hidden="true"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => body.current?.scrollBy({ top: body.current.clientHeight * 0.7, behavior: "smooth" })}
        >
          {t("More")} ⌄
        </button>
      )}
      <div className="swipe-photo">
        <Avatar seed={card.id} name={card.name} hue={card.hue} house={card.house} portraitSrc={card.portrait} size={140} />
      </div>
      {/* The profile scrolls inside the card, so a keyboard can reach it too: Tab, then up and down (left and right still swipe). */}
      <div className="swipe-body" ref={body} onScroll={measure} role="region" aria-label={t("{name}'s profile", { name: card.name })} tabIndex={0}>
        <h2 className="swipe-name">
          {card.name}
          <span className="swipe-age">, {card.age}</span>
        </h2>
        {(card.occupation || card.hometown) && (
          <p className="swipe-job">
            {card.occupation}
            {card.occupation && card.hometown && " · "}
            {card.hometown}
          </p>
        )}
        <p className="swipe-badges">
          <OriginBadge origin={card.origin ?? (card.house ? "cast" : card.made_by === "agent" ? "agent" : "person")} />
          {card.house && <span className="badge">{t("On the show this season")}</span>}
          {/* What they are (lib/kinds.ts), when it's something other than human: the cross-kind deck reads at a glance. */}
          {card.kind && card.kind !== HUMAN && <span className="badge">{card.kind}</span>}
          {/* #443: they already liked yours, so a like back is a match. A flag on this card only, never a list. */}
          {card.liked_you && <span className="badge">{t("Liked you")}</span>}
        </p>
        {/* Whether a like here will be answered, and how soon (lib/activity.ts replyHint): this card's own state only. */}
        {card.replies_note && card.replies !== "instant" && (
          <p className={`muted small swipe-replies${card.replies === "away" ? " swipe-replies-away" : ""}`} data-replies={card.replies}>
            {card.replies_note}
          </p>
        )}
        {/* #426 on the web: said before the profile, where it's read before a swipe (it sat under the fade at the card's foot). */}
        {card.reads_like_yours && (
          <p className="swipe-twin" title={card.reads_like_yours}>
            👯 {t("Reads a lot like your own character: {why}", { why: card.reads_like_yours })}
          </p>
        )}
        <p className="swipe-bio">{card.bio}</p>
        {card.prompts.map((p) => (
          <div key={p.prompt} className="swipe-prompt">
            <p className="swipe-prompt-q">{p.prompt}</p>
            <p className="swipe-prompt-a">{p.answer}</p>
          </div>
        ))}
        {card.interests.length > 0 && (
          <ul className="chips swipe-interests">
            {card.interests.map((i) => (
              <li key={i} className="chip">
                {i}
              </li>
            ))}
          </ul>
        )}
        {(card.facts ?? []).length > 0 && (
          // A few of the creator's public facts: colour, not the deciding thing (the look and the messages are).
          <ul className="swipe-facts">
            {card.facts.slice(0, 3).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        <p className="swipe-looking">
          <strong>{t("Looking for:")}</strong> {card.looking_for}
        </p>
        {card.why.length > 0 && <p className="swipe-why">💡 {card.why.slice(0, 2).join(" · ")}</p>}
      </div>
    </article>
  );
}
