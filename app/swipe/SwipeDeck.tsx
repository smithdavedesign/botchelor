"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Avatar from "@/app/Avatar";
import { shortName } from "@/lib/names";
import type { DeckCard as BaseCard, MatchView } from "@/lib/swipes";
import type { Origin } from "@/lib/origin";
import OriginBadge from "@/app/OriginBadge";
import { kindLabel } from "@/lib/kinds";

/** A deck card with who made it (lib/origin.ts withOrigins). */
type DeckCard = BaseCard & { origin?: Origin };

type Props = {
  character: { id: string; name: string; hue: number | null; portrait: string | null };
  initial: DeckCard[];
  /** This visit's deck session (app/swipe/page.tsx): each card shown on top is reported under it. */
  serveId: string;
  /** How long an unanswered like can be taken back (lib/swipes.ts UNDO_MINUTES). */
  undoMinutes: number;
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
 * Undo takes back an unanswered like only (#622). A match is never undone from the deck (David, 2026-10-31: "they have to
 * do that in their messages"), so a like back that lands meanwhile turns the Undo into a link to their thread.
 *
 * What's seen is what the preference data records (lib/swipes.ts logShownCard): each card is reported once, when it
 * comes on top, with its place in what this person has seen this visit. The hand that was dealt is never logged.
 */
export default function SwipeDeck({ character, initial, serveId, undoMinutes }: Props) {
  const [cards, setCards] = useState(initial);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const [matched, setMatched] = useState<DeckCard | null>(null);
  const [matchPage, setMatchPage] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(initial.length === 0);
  // #622: the last like, while it can still be taken back (unanswered: no match; the server holds the 10-minute rule).
  const [lastLike, setLastLike] = useState<DeckCard | null>(null);
  // The like that couldn't be taken back because it had become a match: where their thread is.
  const [matchedMeanwhile, setMatchedMeanwhile] = useState<{ name: string; href: string } | null>(null);
  const startX = useRef<number | null>(null);
  const busy = useRef(false);
  const refilling = useRef(false);
  const keep = useRef<HTMLButtonElement>(null);
  const first = shortName(character.name);
  const top = cards[0] ?? null;
  const next = cards[1] ?? null;

  const refill = useCallback(async () => {
    if (refilling.current) return;
    refilling.current = true;
    try {
      const res = await fetch(`/api/swipes?character_id=${encodeURIComponent(character.id)}`, { headers: { accept: "application/json" } });
      if (!res.ok) return;
      const data = (await res.json()) as { cards: DeckCard[] };
      if (!data.cards.length) setExhausted(true);
      setCards((shown) => {
        const have = new Set(shown.map((c) => c.id));
        return [...shown, ...data.cards.filter((c) => !have.has(c.id))];
      });
    } catch {
      // The deck still shows what it has; another swipe tries again.
    } finally {
      refilling.current = false;
    }
  }, [character.id]);

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
      if (!card || busy.current) return;
      busy.current = true;
      setError(null);
      setLeaving(like ? "right" : "left");
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      await new Promise((r) => setTimeout(r, still ? 0 : 220));
      setCards((c) => c.slice(1));
      setLeaving(null);
      setDragX(0);
      setStatus(like ? `Liked ${card.name}.` : `Passed on ${card.name}.`);
      setLastLike(null);
      setMatchedMeanwhile(null);
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
          setError(data.message ?? "That swipe didn't go through.");
        } else if (data.match) {
          const m = data.match;
          setMatched(card);
          setMatchPage(`/messages/${m.lo}/${m.hi}?as=${encodeURIComponent(character.id)}`);
          setStatus(`It's a match: ${first} and ${card.name}.`);
        } else if (like) {
          setLastLike(card);
        }
      } catch {
        setError("Network error. Try again.");
      } finally {
        busy.current = false;
      }
    },
    [cards, character.id, first],
  );

  // #622: takes back the last like while it's unanswered; the card goes back on top. A match, or ten minutes, and it stands.
  const undo = useCallback(async () => {
    const card = lastLike;
    if (!card || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const res = await fetch("/api/swipes", {
        method: "DELETE",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ character_id: character.id, target_id: card.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (res.ok) {
        setCards((c) => [card, ...c.filter((x) => x.id !== card.id)]);
        setStatus(`Took back the like on ${card.name}.`);
      } else if (data.error === "already_matched") {
        // They liked back meanwhile: a match stays (both owners were told), and what happens next is in their thread.
        const [lo, hi] = character.id < card.id ? [character.id, card.id] : [card.id, character.id]; // pairKey's order
        setMatchedMeanwhile({ name: card.name, href: `/messages/${lo}/${hi}?as=${encodeURIComponent(character.id)}` });
      } else {
        setError(data.message ?? "That like can't be undone now.");
      }
      setLastLike(null);
    } catch {
      setError("Network error. Try again.");
    } finally {
      busy.current = false;
    }
  }, [lastLike, character.id]);

  // The Undo goes once the server would refuse it for its age anyway.
  useEffect(() => {
    if (!lastLike) return;
    const lapse = setTimeout(() => setLastLike(null), undoMinutes * 60_000);
    return () => clearTimeout(lapse);
  }, [lastLike, undoMinutes]);

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
      <div className="swipe-deck" tabIndex={0} onKeyDown={onKey} aria-label={`${first}'s swipe deck. Right arrow likes, left arrow passes.`}>
        {top ? (
          <div className="swipe-stack">
            {next && <Card card={next} className="swipe-card swipe-next" />}
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
                Like
              </span>
              <span className="swipe-stamp swipe-stamp-nope" style={{ opacity: Math.max(0, -lean) }} aria-hidden="true">
                Nope
              </span>
            </Card>
          </div>
        ) : (
          <div className="swipe-empty card">
            <p className="swipe-empty-icon" aria-hidden="true">
              💌
            </p>
            <p>
              <strong>That&apos;s everyone for now.</strong>
            </p>
            <p className="muted small">
              New characters join the deck every day. <Link href={`/matches?character=${encodeURIComponent(character.id)}`}>See {first}&apos;s matches</Link>.
            </p>
          </div>
        )}
        {top && (
          <div className="swipe-actions">
            <button type="button" className="swipe-btn swipe-btn-nope" onClick={() => void decide(false)} aria-label={`Pass on ${top.name}`}>
              ✕
            </button>
            <button type="button" className="swipe-btn swipe-btn-like" onClick={() => void decide(true)} aria-label={`Like ${top.name}`}>
              ♥
            </button>
          </div>
        )}
        {lastLike && (
          <p className="muted small swipe-undo">
            Liked {lastLike.name}.{" "}
            <button type="button" className="button-ghost" onClick={() => void undo()}>
              Undo
            </button>
          </p>
        )}
        {matchedMeanwhile && (
          <p className="muted small swipe-undo">
            {matchedMeanwhile.name} liked {first} back meanwhile, so it&apos;s a match and the like stands. <Link href={matchedMeanwhile.href}>Read their chat</Link>
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
            <h2 id="its-a-match">It&apos;s a match!</h2>
            <p>
              {/* Full names when the first names are the same ("Marisol and Marisol" read as a typo). */}
              {shortName(matched.name) === first ? `${character.name} and ${matched.name}` : `${first} and ${shortName(matched.name)}`} are texting now. If they both want a date, you&apos;ll be able to book it.
            </p>
            <p className="swipe-match-buttons">
              <Link className="button" href={matchPage}>
                Read their chat
              </Link>
              <button ref={keep} type="button" className="button-ghost" onClick={() => setMatched(null)}>
                Keep swiping
              </button>
            </p>
          </div>
        </div>
      )}
    </>
  );
}

type CardProps = {
  card: DeckCard;
  className: string;
  style?: CSSProperties;
  children?: ReactNode;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
};

/** One dating-profile card: the look, who they are, two or three prompts, interests, what they're after, and why. */
function Card({ card, className, style, children, ...pointer }: CardProps) {
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
    <article className={className} style={style} aria-label={`${card.name}, ${card.age}`} {...pointer}>
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
          More ⌄
        </button>
      )}
      <div className="swipe-photo">
        <Avatar seed={card.id} name={card.name} hue={card.hue} house={card.house} portraitSrc={card.portrait} size={140} />
      </div>
      <div className="swipe-body" ref={body} onScroll={measure}>
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
          {card.house && <span className="badge">On the show this season</span>}
          {/* What they are (lib/kinds.ts), when it's something other than human: the cross-kind deck reads at a glance. */}
          {card.kind && card.kind !== HUMAN && <span className="badge">{card.kind}</span>}
          {/* #443: they already liked yours, so a like back is a match. A flag on this card only, never a list. */}
          {card.liked_you && <span className="badge">Liked you</span>}
        </p>
        {/* Whether a like here will be answered, and how soon (lib/activity.ts replyHint): this card's own state only. */}
        {card.replies_note && card.replies !== "instant" && (
          <p className={`muted small swipe-replies${card.replies === "away" ? " swipe-replies-away" : ""}`} data-replies={card.replies}>
            {card.replies_note}
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
          <strong>Looking for:</strong> {card.looking_for}
        </p>
        {card.why.length > 0 && <p className="swipe-why">💡 {card.why.slice(0, 2).join(" · ")}</p>}
      </div>
    </article>
  );
}
