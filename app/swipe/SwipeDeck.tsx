"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import Avatar from "@/app/Avatar";
import { shortName } from "@/lib/names";
import type { DeckCard, MatchView, MyMatch } from "@/lib/swipes";

type Props = {
  character: { id: string; name: string; hue: number | null; portrait: string | null };
  initial: DeckCard[];
  matches: MyMatch[];
};

/** How far a card has to be dragged to count as a swipe. */
const THRESHOLD = 110;
/** Fetch more cards when this few are left. */
const REFILL_AT = 3;

/**
 * The swipe deck (lib/swipes.ts): one card at a time, the next peeking behind it. Drag it right to like, left to pass,
 * or use the buttons or the arrow keys. A match shows "It's a match!" and joins the matches below, each opening the
 * couple's chat. The characters decide about a date themselves.
 */
export default function SwipeDeck({ character, initial, matches: firstMatches }: Props) {
  const [cards, setCards] = useState(initial);
  const [matches, setMatches] = useState(firstMatches);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const [matched, setMatched] = useState<DeckCard | null>(null);
  const [matchPage, setMatchPage] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(initial.length === 0);
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
      try {
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
          const mineLo = m.lo === character.id;
          const page = `/couples/${m.lo}/${m.hi}`;
          setMatched(card);
          setMatchPage(page);
          setStatus(`It's a match: ${first} and ${card.name}.`);
          setMatches((list) => [
            {
              with: { id: card.id, name: card.name, house: card.house, made_by: card.made_by, portrait: card.portrait, hue: card.hue },
              matched_at: m.matched_at,
              you: mineLo ? m.yes_lo : m.yes_hi,
              them: mineLo ? m.yes_hi : m.yes_lo,
              agreed: m.agreed,
              couple_page: page,
            },
            ...list.filter((x) => x.with.id !== card.id),
          ]);
        }
      } catch {
        setError("Network error. Try again.");
      } finally {
        busy.current = false;
      }
    },
    [cards, character.id, first],
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
              onPointerCancel={onUp}
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
            <p className="muted small">New characters join the deck every day. Your matches are below.</p>
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
        <p className="sr-only" role="status">
          {status}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      {matches.length > 0 && (
        <section className="card swipe-matches">
          <h2>{first}&apos;s matches</h2>
          <ul className="swipe-match-list">
            {matches.map((m) => (
              <li key={m.with.id}>
                <Link href={`${m.couple_page}#texts`} className="swipe-match">
                  <Avatar seed={m.with.id} name={m.with.name} hue={m.with.hue} house={m.with.house} portraitSrc={m.with.portrait} size={56} />
                  <span className="swipe-match-name">{shortName(m.with.name)}</span>
                  <span className="swipe-match-state">
                    {m.agreed ? "📅 Date agreed" : m.you === false || m.them === false ? "Not this time" : "Texting"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {matched && (
        <div className="swipe-match-overlay" role="dialog" aria-modal="true" aria-labelledby="its-a-match">
          <div className="swipe-match-card">
            <div className="swipe-match-avatars">
              <Avatar seed={character.id} name={character.name} hue={character.hue} portraitSrc={character.portrait} size={88} />
              <Avatar seed={matched.id} name={matched.name} hue={matched.hue} house={matched.house} portraitSrc={matched.portrait} size={88} />
            </div>
            <h2 id="its-a-match">It&apos;s a match!</h2>
            <p>
              {first} and {shortName(matched.name)} are texting now. If they both want a date, you&apos;ll be able to book it.
            </p>
            <p className="swipe-match-buttons">
              <Link className="button" href={`${matchPage}#texts`}>
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
  return (
    <article className={className} style={style} aria-label={`${card.name}, ${card.age}`} {...pointer}>
      {children}
      <div className="swipe-photo">
        <Avatar seed={card.id} name={card.name} hue={card.hue} house={card.house} portraitSrc={card.portrait} size={140} />
      </div>
      <div className="swipe-body">
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
          {card.house && <span className="badge">On the show this season</span>}
          {card.made_by === "agent" && <span className="badge badge-agent">🤖 Agent-made</span>}
        </p>
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
        <p className="swipe-looking">
          <strong>Looking for:</strong> {card.looking_for}
        </p>
        {card.why.length > 0 && <p className="swipe-why">💡 {card.why.slice(0, 2).join(" · ")}</p>}
      </div>
    </article>
  );
}
