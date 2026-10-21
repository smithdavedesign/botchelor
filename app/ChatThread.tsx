"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import Avatar from "./Avatar";
import { useLineVotes, type LineFeedbackRef } from "./useLineVotes";
import { DATE_ACTS } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import type { CharacterRef } from "@/lib/game";
import { venuePhrase } from "@/lib/venues";

export type { LineFeedbackRef } from "./useLineVotes";

type Props = {
  characters: [CharacterRef, CharacterRef];
  turns: Turn[];
  /** Show a "typing…" bubble for this side (the next speaker), or null. */
  typing?: "a" | "b" | null;
  /** The producer's act-2 situation, shown as a system note when the challenge starts. */
  challenge?: string | null;
  /** "dark" inside the theater, "light" on a page card. */
  tone?: "dark" | "light";
  /** Keep the newest line in view as lines arrive (a scrolling dock), unless the reader scrolled up. */
  follow?: boolean;
  /** Show each line's action · emotion caption. */
  meta?: boolean;
  /** Shown when nothing has been said yet. */
  empty?: string | null;
  /**
   * 👍/👎 on every line, saved for the viewer (lib/line-feedback.ts), only when the page says what the lines are: a date
   * ({ kind: "episode", refId: episode.id }) or an After Dark night. Line i is turns[i], so the turns must start at the
   * ref's first line (a replay's growing prefix is fine).
   */
  feedback?: LineFeedbackRef | null;
};

const NEAR_BOTTOM_PX = 80;

/**
 * One line's thumbs: quiet until hovered or focused. The button is the tap target (44px on a touch screen) and the face
 * inside it is what shows, the same small circle everywhere (globals.css .chat-vote).
 */
export function LineVoteButtons({ index, vote, name, onVote }: { index: number; vote: 1 | -1 | 0; name: string; onVote: (index: number, vote: 1 | -1) => void }) {
  const first = name.split(/\s+/)[0] || name;
  return (
    <span className={`chat-votes${vote ? " voted" : ""}`} role="group" aria-label={`Rate ${first}'s line`}>
      <button type="button" className="chat-vote" aria-pressed={vote === 1} aria-label="Good line" title="Good line" onClick={() => onVote(index, 1)}>
        <span className="chat-vote-face" aria-hidden>
          👍
        </span>
      </button>
      <button type="button" className="chat-vote" aria-pressed={vote === -1} aria-label="Not a good line" title="Not a good line" onClick={() => onVote(index, -1)}>
        <span className="chat-vote-face" aria-hidden>
          👎
        </span>
      </button>
    </span>
  );
}

/**
 * The date as a messaging thread (David: "a chat window with bubbles so you can see when someone says what,
 * like a normal mobile chat"). One character on the left, the other on the right, each line a bubble with the
 * speaker's avatar; a name tag when a side first speaks in an act; act dividers and the producer's challenge
 * as centred system notes; a typing bubble for whoever speaks next. Shared by the live room, the finished-room
 * replay, the episode replay and the episode page's record of the date. With `feedback`, each line gets a quiet 👍/👎
 * (David, 2026-10-21: real-user signals) beside its caption.
 */
export default function ChatThread({ characters, turns, typing = null, challenge, tone = "light", follow = false, meta = true, empty, feedback = null }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lineVotes = useLineVotes(feedback);

  // Track whether the reader is at the bottom, so new lines don't yank them away from something they're reading.
  useEffect(() => {
    const el = box.current;
    if (!el || !follow) return;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [follow]);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow && pinned.current) el.scrollTop = el.scrollHeight;
  }, [follow, turns.length, typing]);

  const [a, b] = characters;
  const who = (side: "a" | "b") => (side === "a" ? a : b);

  return (
    <div ref={box} className={`chat-thread chat-${tone}${follow ? " chat-follow" : ""}`} role="log" aria-live="polite" aria-label="The date, line by line">
      {turns.length === 0 && !typing && empty && <p className="chat-empty">{empty}</p>}
      {turns.map((t, i) => {
        const prev = turns[i - 1];
        const newAct = !prev || prev.act !== t.act;
        // Name the speaker the first time each side talks in an act; after that the side + avatar say who it is.
        const named = newAct || !turns.slice(0, i).some((x) => x.act === t.act && x.side === t.side);
        const c = who(t.side);
        const caption = meta ? [t.action, t.emotion].filter(Boolean).join(" · ") : "";
        return (
          <div key={i} className="chat-item">
            {newAct && <p className="chat-act">{DATE_ACTS[t.act] ?? `Act ${t.act + 1}`}</p>}
            {newAct && t.act === 1 && challenge && <p className="chat-note">🎬 {challenge}</p>}
            <div className={`chat-row chat-row-${t.side}`}>
              <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={30} />
              <div className="chat-col">
                {named && <span className="chat-name">{c.name}</span>}
                <p className="chat-bubble">{t.dialogue}</p>
                {lineVotes.enabled ? (
                  // The caption and the thumbs share one row under the bubble, so rating adds little height.
                  <div className="chat-foot">
                    {caption && <span className="chat-meta">{caption}</span>}
                    <LineVoteButtons index={i} vote={lineVotes.votes[i] ?? 0} name={c.name} onVote={lineVotes.cast} />
                  </div>
                ) : (
                  caption && <span className="chat-meta">{caption}</span>
                )}
              </div>
            </div>
            {/* Both said yes to going somewhere else (lib/moves.ts): the date moves there after this line. */}
            {t.moved_to && <p className="chat-note chat-move">📍 They head to {venuePhrase(t.moved_to)}</p>}
          </div>
        );
      })}
      {typing && (
        <div className={`chat-row chat-row-${typing} chat-typing-row`} aria-label={`${who(typing).name} is typing`}>
          <Avatar seed={who(typing).id} name={who(typing).name} hue={who(typing).hue} house={who(typing).house} portraitSrc={who(typing).portrait} size={30} />
          <div className="chat-col">
            <p className="chat-bubble chat-typing" aria-hidden>
              <span />
              <span />
              <span />
            </p>
          </div>
        </div>
      )}
      {lineVotes.enabled && lineVotes.error && (
        <p className="chat-vote-error" role="status">
          {lineVotes.error}
        </p>
      )}
    </div>
  );
}
