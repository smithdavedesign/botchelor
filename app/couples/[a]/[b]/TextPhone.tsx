"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Avatar from "@/app/Avatar";
import PhoneFrame from "@/app/PhoneFrame";
import type { CharacterRef } from "@/lib/game";
import { shortName } from "@/lib/names";
import type { End } from "@/lib/relationships";
import { dayLabel, isText, type ChainDate, type ChainItem, type ChainPage } from "@/lib/text-chain-shared";

type Props = {
  /** The pair, lower id first: the texts route's path. */
  pair: [string, string];
  characters: Record<End, CharacterRef>;
  /** Whose phone it is: the end the viewer owns. Its texts sit on the right. */
  mine: End;
  /** The viewer owns both, so they can switch phones. */
  canFlip: boolean;
  stageLabel: string | null;
  initial: ChainPage;
  /** Today (UTC) from the server, so the day labels print the same on the server and in the browser. */
  today: string;
};

/** Within this of the newest text, the reader is "at the newest" and stays there as the phone resizes. */
const PINNED_PX = 48;
/** Scrolled up past this, a button offers the way back to the newest text. */
const AWAY_PX = 280;
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A couple's text chain on a phone (lib/text-chain.ts; David, 2026-10-17): every date as a marker, the morning-after
 * texts right after it, then their texts between dates. It opens on the newest text and scrolls up through the whole
 * history, a page at a time. Full screen fills the screen: the browser's own full screen where it allows it (desktop,
 * Android), a fixed overlay elsewhere (iPhone Safari). The characters' owners only.
 */
export default function TextPhone({ pair, characters, mine, canFlip, stageLabel, initial, today }: Props) {
  const [lo, hi] = pair;
  const [items, setItems] = useState<ChainItem[]>(initial.items);
  const [cursor, setCursor] = useState(initial.cursor);
  const [hasMore, setHasMore] = useState(initial.has_more);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [me, setMe] = useState<End>(mine);
  const [full, setFull] = useState(false);
  const [away, setAway] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const pinned = useRef(true);
  const anchor = useRef<number | null>(null);
  const busy = useRef(false);

  const them: End = me === "lo" ? "hi" : "lo";
  const self = characters[me];
  const other = characters[them];
  const names = `${shortName(characters.lo.name)} and ${shortName(characters.hi.name)}`;

  // Open on the newest text, the way a phone does.
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Older texts went in above: keep the reader where they were instead of jumping.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || anchor.current === null) return;
    el.scrollTop += el.scrollHeight - anchor.current;
    anchor.current = null;
  }, [items]);

  // Whether the reader is at the newest text. Resizing (full screen, turning the phone) keeps them there if so.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      pinned.current = gap < PINNED_PX;
      setAway(gap > AWAY_PX);
    };
    const resized = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    resized.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      resized.disconnect();
    };
  }, []);

  const loadEarlier = useCallback(async () => {
    if (busy.current || !cursor) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/couples/${lo}/${hi}/texts?before=${encodeURIComponent(cursor)}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as ChainPage;
      anchor.current = box.current?.scrollHeight ?? null;
      setItems((shown) => {
        const have = new Set(shown.map((i) => i.id));
        return [...page.items.filter((i) => !have.has(i.id)), ...shown];
      });
      setCursor(page.cursor);
      setHasMore(page.has_more);
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [cursor, lo, hi]);

  // Scrolling to the top brings in the texts before it, like any messaging app. A failed load waits for a tap.
  useEffect(() => {
    const el = top.current;
    const root = box.current;
    if (!el || !root || !hasMore || failed) return;
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadEarlier();
      },
      { root, rootMargin: "160px 0px 0px 0px" },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, [hasMore, failed, loadEarlier]);

  const enter = () => {
    setFull(true);
    const el = stage.current;
    if (el && document.fullscreenEnabled && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
  };
  const leave = useCallback(() => {
    setFull(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    if (!full) return;
    const root = document.documentElement;
    const back = opener.current;
    root.classList.add("phone-open");
    done.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };
    // Leaving the browser's full screen (Esc, a gesture) leaves ours too.
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      root.classList.remove("phone-open");
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onChange);
      back?.focus();
    };
  }, [full, leave]);

  // In full screen, Tab stays inside the phone.
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !stage.current) return;
    const els = [...stage.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!els.length) return;
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const toNewest = () => {
    const el = box.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: still ? "auto" : "smooth" });
  };

  const anyTexts = items.some(isText);

  return (
    <section className="card phone-card" id="texts" aria-labelledby="texts-title">
      <div className="section-head">
        <h2 id="texts-title">Their texts</h2>
        <button ref={opener} type="button" className="button-ghost small" onClick={enter}>
          ⤢ Full screen
        </button>
      </div>
      <p className="muted small">
        Every text since their first date: the morning after each date, then their texts between dates. Only the characters&apos; owners see
        this.
      </p>
      <div
        ref={stage}
        className={`phone-stage${full ? " is-full" : ""}`}
        role={full ? "dialog" : undefined}
        aria-modal={full ? true : undefined}
        aria-label={full ? `Texts between ${names}` : undefined}
        onKeyDown={full ? trap : undefined}
      >
        <PhoneFrame chrome={!full}>
          <header className="phone-header">
            <Link className="phone-back" href={`/characters/${self.id}/relationships`} aria-label={`Back to ${shortName(self.name)}'s relationships`}>
              ‹
            </Link>
            <Link className="phone-contact" href={`/characters/${other.id}`}>
              <Avatar seed={other.id} name={other.name} hue={other.hue} house={other.house} portraitSrc={other.portrait} size={38} />
              <span className="phone-contact-name">{shortName(other.name)}</span>
              {stageLabel && <span className="phone-contact-stage">{stageLabel}</span>}
            </Link>
            {full ? (
              <button ref={done} type="button" className="phone-head-btn" onClick={leave}>
                Done
              </button>
            ) : canFlip ? (
              <button type="button" className="phone-head-btn" onClick={() => setMe(them)} aria-label={`See it on ${shortName(other.name)}'s phone`} title={`See it on ${shortName(other.name)}'s phone`}>
                ⇄
              </button>
            ) : (
              <span aria-hidden="true" />
            )}
          </header>
          <div ref={box} className="phone-messages" role="region" aria-label={`Texts between ${names}`} tabIndex={0}>
            {hasMore ? (
              <div ref={top} className="phone-earlier">
                <button type="button" className="phone-earlier-btn" onClick={() => void loadEarlier()} disabled={loading}>
                  {loading ? "Loading…" : failed ? "Couldn't load them. Try again" : "Load earlier texts"}
                </button>
              </div>
            ) : (
              anyTexts && <p className="phone-start">The start of their texts</p>
            )}
            <Thread items={items} me={me} characters={characters} today={today} />
            {!anyTexts && (
              <p className="phone-note phone-empty">
                No texts yet. The morning after a date they text each other, and couples on good terms keep texting between dates.
              </p>
            )}
          </div>
          {away && (
            <button type="button" className="phone-jump" onClick={toNewest} aria-label="Jump to the newest text">
              ↓
            </button>
          )}
          <p className="phone-compose">💬 Only {names} can text here</p>
        </PhoneFrame>
      </div>
    </section>
  );
}

/**
 * The thread: a day label when the day changes, each date as a card, "the morning after" before its texts, and
 * the texts as bubbles (this phone's character on the right), grouped while one of them keeps texting.
 */
function Thread({ items, me, characters, today }: { items: ChainItem[]; me: End; characters: Record<End, CharacterRef>; today: string }) {
  const startsMorning = (i: number) => {
    const t = items[i];
    if (t?.kind !== "text" || t.source !== "afterglow") return false;
    const p = items[i - 1];
    return !(p?.kind === "text" && p.source === "afterglow" && p.episode_id === t.episode_id);
  };
  // Something is drawn between items i-1 and i: a new day, a date, or the start of a morning after.
  const breakBefore = (i: number) => i === 0 || items[i].day !== items[i - 1].day || items[i].kind === "date" || items[i - 1].kind === "date" || startsMorning(i);
  const sameSender = (i: number, j: number) => {
    const x = items[i];
    const y = items[j];
    return x?.kind === "text" && y?.kind === "text" && x.who === y.who;
  };

  const out: ReactNode[] = [];
  items.forEach((item, i) => {
    if (i === 0 || item.day !== items[i - 1].day) {
      out.push(
        <p key={`day:${item.id}`} className="phone-day">
          {dayLabel(item.day, today)}
        </p>,
      );
    }
    if (item.kind === "date") {
      out.push(<DateCard key={item.id} date={item} />);
      return;
    }
    if (startsMorning(i)) {
      out.push(
        <p key={`morning:${item.id}`} className="phone-note">
          ☀️ The morning after
        </p>,
      );
    }
    const starts = breakBefore(i) || !sameSender(i - 1, i);
    const ends = i === items.length - 1 || breakBefore(i + 1) || !sameSender(i, i + 1);
    const mineSide = item.who === me;
    const c = characters[item.who];
    out.push(
      <div key={item.id} className={`phone-msg ${mineSide ? "phone-msg-me" : "phone-msg-them"}${starts ? " starts" : ""}${ends ? " ends" : ""}`}>
        {!mineSide &&
          (ends ? <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={26} /> : <span className="phone-avatar-gap" aria-hidden="true" />)}
        <p className="phone-bubble">
          <span className="sr-only">{shortName(c.name)}: </span>
          {item.text}
        </p>
      </div>,
    );
  });
  return <>{out}</>;
}

function DateCard({ date }: { date: ChainDate }) {
  return (
    <div className="phone-date">
      <p className="phone-date-title">
        🎬 Date {date.number} · {date.venue}
      </p>
      <p className="phone-date-ending">
        Ending: {date.ending_label}
        {!date.aired && <span className="badge">not aired yet</span>}
      </p>
      <Link href={`/episodes/${date.episode_id}`}>▶ Watch it</Link>
    </div>
  );
}
