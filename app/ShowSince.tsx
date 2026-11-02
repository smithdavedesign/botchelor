"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import When from "./When";
import type { ShowSince as ShowSinceData } from "@/lib/show-since";

const DISMISSED = "bz-show-since-dismissed";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The show's news since your last visit, as a list (lib/show-since.ts). */
function Items({ card }: { card: ShowSinceData }) {
  return (
    <ul className="show-since-list">
      {card.season && (
        <li>
          <span aria-hidden="true">🎬</span> Season {card.season.number} ({card.season.label}) is over:{" "}
          <Link href={card.season.path}>watch the recap</Link>
        </li>
      )}
      {card.aired > 0 && (
        <li>
          <span aria-hidden="true">📺</span> <Link href="/watch#latest">{plural(card.aired, "date aired", "dates aired")}</Link>
        </li>
      )}
      {card.situation && (
        <li>
          <span aria-hidden="true">{card.situation.icon}</span> The viewers picked <strong>{card.situation.title}</strong>:{" "}
          <Link href={card.situation.room_path}>watch how it went</Link>
        </li>
      )}
      {card.diary && (
        <li>
          <span aria-hidden="true">📹</span> {card.diary.name}, after the date with {card.diary.partner}: <em>“{card.diary.line}”</em>{" "}
          <Link href={card.diary.episode_path}>watch it</Link>
        </li>
      )}
      {card.moves.map((m) => (
        <li key={`${m.lo}-${m.hi}`}>
          <span aria-hidden="true">💫</span>{" "}
          <Link href={`/couples/${m.lo}/${m.hi}`}>
            {m.a} &amp; {m.b}
          </Link>{" "}
          are now {m.label}
          {m.following && <span className="chip">You follow</span>}
        </li>
      ))}
      {card.followed > 0 && (
        <li>
          <span aria-hidden="true">👀</span> Couples you follow went on {plural(card.followed, "date", "dates")}
        </li>
      )}
      {card.shift && (
        <li>
          <span aria-hidden="true">{card.shift.shift > 0 ? "🔥" : "🧊"}</span> Biggest chemistry shift this week:{" "}
          <Link href={`/couples/${card.shift.lo}/${card.shift.hi}`}>
            {card.shift.a} &amp; {card.shift.b}
          </Link>{" "}
          {card.shift.shift > 0 ? "+" : "−"}
          {Math.abs(card.shift.shift)}
        </li>
      )}
      {card.calls && (
        <li>
          <span aria-hidden="true">🔮</span> You called {card.calls.right} of {card.calls.called} right
          {card.calls.streak >= 2 ? `: ${card.calls.streak} in a row 🔥` : ""}
        </li>
      )}
    </ul>
  );
}

/**
 * What happened on the show since your last visit (lib/show-since.ts). `inside`: a part of home's "Since you were here"
 * card for someone with characters (app/page.tsx). Otherwise its own card, at the top of home for a spectator and of
 * /watch for everyone, with "Got it" to hide it for this visit (it remembers which visit, so the next return shows anew).
 */
export default function ShowSince({ card, inside = false }: { card: ShowSinceData; inside?: boolean }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (inside) return;
    try {
      if (window.localStorage.getItem(DISMISSED) === card.since) setHidden(true);
    } catch {
      // Storage blocked: the card just stays.
    }
  }, [card.since, inside]);
  if (inside) {
    return (
      <div className="show-since-inside">
        <h3>On the show</h3>
        <Items card={card} />
      </div>
    );
  }
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISSED, card.since);
    } catch {
      // Storage blocked: hidden for this page only.
    }
  };
  return (
    <section className="card show-since" aria-labelledby="show-since-head">
      <div className="show-since-top">
        <h2 id="show-since-head">
          Since you were here <span className="muted show-since-when">(<When iso={card.since} />)</span>
        </h2>
        <button type="button" className="button-ghost small" onClick={dismiss}>
          Got it
        </button>
      </div>
      <Items card={card} />
    </section>
  );
}
