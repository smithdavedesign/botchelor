"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import Icon from "@/app/Icon";
import { chapterOf, dayNumber, frameForDay, longDay, prUrl, runningTotals, shortDay, stageAt, type Chapter, type Day, type Frame, type Shot } from "@/lib/making-of";
import s from "./making-of.module.css";

/** How long each frame holds while it plays: the whole run in about half a minute. */
const STEP_MS = 680;
/** The same widths the pictures were cut at (scripts/making-of/collect.mjs), so the browser picks the one it needs. */
const LAPTOP_SIZES = "(max-width: 720px) 92vw, 46rem";
const PHONE_SIZES = "(max-width: 720px) 30vw, 11rem";

const srcSet = (shot: Shot) => `${shot.card.src} ${shot.card.w}w, ${shot.full.src} ${shot.full.w}w`;

/**
 * One screen of a device: the picture it showed last stays under the new one while that fades in, so scrubbing never
 * flashes the empty screen. (State from the previous render, set during render, as React's docs do it.)
 */
function Screen({ shot, sizes, alt, className }: { shot: Shot | null; sizes: string; alt: string; className: string }) {
  const [layers, setLayers] = useState<Shot[]>(shot ? [shot] : []);
  const top = layers[layers.length - 1];
  if (shot && top?.full.src !== shot.full.src) setLayers(top ? [top, shot] : [shot]);
  return (
    <div className={className}>
      {layers.map((l, k) => (
        // eslint-disable-next-line @next/next/no-img-element -- pre-cut WebP at two widths (public/making-of), no optimizer
        <img
          key={l.full.src}
          className={k === layers.length - 1 ? s.screenTop : s.screenUnder}
          src={l.card.src}
          srcSet={srcSet(l)}
          sizes={sizes}
          width={l.card.w}
          height={l.card.h}
          alt={k === layers.length - 1 ? alt : ""}
          decoding="async"
        />
      ))}
    </div>
  );
}

/** Warm the cache for the frames coming up, with the same srcset and sizes the screens use, so they're ready in time. */
function preload(frames: Frame[], from: number) {
  for (const f of frames.slice(from, from + 3)) {
    for (const [shot, sizes] of [
      [f.desktop, LAPTOP_SIZES],
      [f.phone, PHONE_SIZES],
    ] as const) {
      if (!shot) continue;
      const img = new Image();
      img.sizes = sizes;
      img.srcset = srcSet(shot);
      img.src = shot.card.src;
    }
  }
}

type Props = { frames: Frame[]; days: Day[]; chapters: Chapter[]; first: string };

/**
 * The making-of page's hero: a laptop and a phone showing the site as it was on each day, a slate with the day, the
 * episode, the pull request and the running count, and a scrubber that is also the chart of pull requests merged per
 * day. It plays once, from day one to today, the first time it's on screen (never under reduced motion), and stops
 * whenever it's touched; arrows, Home and End move it from the keyboard.
 */
export default function TimeMachine({ frames, days, chapters, first }: Props) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [inView, setInView] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const started = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const frame = frames[i];
  const stage = useMemo(() => stageAt(frames, i), [frames, i]);
  const totals = useMemo(() => runningTotals(days), [days]);
  const max = useMemo(() => Math.max(1, ...days.map((d) => d.prs)), [days]);
  const dayIndex = days.findIndex((d) => d.day === frame.day);
  const chapter = chapterOf(frame.day, chapters);
  const episodeNo = chapters.indexOf(chapter) + 1;
  const atEnd = i === frames.length - 1;

  // Play once, the first time at least half of it is on screen; pause the clock while it's off screen.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        setInView(e.isIntersecting);
        if (e.isIntersecting && !started.current) {
          started.current = true;
          if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(true);
        }
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !inView || atEnd) return;
    const t = window.setTimeout(() => {
      const next = Math.min(i + 1, frames.length - 1);
      setI(next);
      // Today is the last frame: it stops there, with Play again.
      if (next === frames.length - 1) setPlaying(false);
    }, STEP_MS);
    return () => window.clearTimeout(t);
  }, [playing, inView, atEnd, i, frames.length]);

  useEffect(() => preload(frames, i + 1), [frames, i]);

  const go = useCallback(
    (n: number) => {
      setPlaying(false);
      setI(Math.max(0, Math.min(frames.length - 1, n)));
    },
    [frames.length],
  );

  const dayAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(0.9999, (e.clientX - r.left) / r.width));
    return Math.floor(x * days.length);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    go(frameForDay(frames, days[dayAt(e)].day));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = dayAt(e);
    setHover(d);
    if (dragging.current) go(frameForDay(frames, days[d].day));
  };
  const onUp = () => {
    dragging.current = false;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = { ArrowRight: i + 1, ArrowUp: i + 1, ArrowLeft: i - 1, ArrowDown: i - 1, Home: 0, End: frames.length - 1, PageUp: i + 5, PageDown: i - 5 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    go(to);
  };

  const toggle = () => {
    if (playing) return setPlaying(false);
    if (atEnd) setI(0);
    setPlaying(true);
  };

  const pct = (n: number) => `${((n + 0.5) / days.length) * 100}%`;
  const hovered = hover === null ? null : days[hover];
  const what = `${longDay(frame.day)}, ${frame.caption}`;

  return (
    <div className={s.machine} ref={root}>
      <div className={s.rig}>
        <div className={s.stage}>
          <figure className={s.laptop}>
            <div className={s.chrome} aria-hidden="true">
              <i />
              <i />
              <i />
              <span className={s.url}>botchelor.com</span>
            </div>
            <Screen shot={stage.desktop} sizes={LAPTOP_SIZES} alt={`Botchelor on a computer, ${what}`} className={s.screen} />
          </figure>
          <figure className={s.phone}>
            <Screen shot={stage.phone} sizes={PHONE_SIZES} alt={`Botchelor on a phone, ${what}`} className={s.phoneScreen} />
          </figure>
        </div>

        <div className={s.slate}>
          <div className={s.clapper} aria-hidden="true" />
          <dl className={s.slateGrid}>
            <div>
              <dt>Episode</dt>
              <dd>{episodeNo}</dd>
            </div>
            <div>
              <dt>Day</dt>
              <dd>{dayNumber(frame.day, first)}</dd>
            </div>
            <div>
              <dt>PR</dt>
              <dd>
                <a href={prUrl(frame.pr)} rel="noopener" target="_blank">
                  #{frame.pr}
                </a>
              </dd>
            </div>
          </dl>
          <p className={s.slateDate}>{longDay(frame.day)}</p>
          <p className={s.slateCaption}>{frame.caption}</p>
          <p className={s.slateTitle}>{frame.title}</p>
          <p className={s.slateCount}>
            <strong key={frame.day}>{(totals.get(frame.day) ?? 0).toLocaleString("en-US")}</strong> pull requests merged by the end of
            the day
          </p>
          <div className={s.buttons}>
            <button type="button" className={s.play} onClick={toggle} aria-pressed={playing}>
              <Icon name={playing ? "pause" : atEnd ? "undo" : "play"} />
              {playing ? "Pause" : atEnd ? "Play again" : i === 0 ? "Play" : "Play on"}
            </button>
            <button type="button" className={s.step} onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous day">
              <Icon name="chevronLeft" />
            </button>
            <button type="button" className={s.step} onClick={() => go(i + 1)} disabled={atEnd} aria-label="Next day">
              <Icon name="chevronRight" />
            </button>
          </div>
        </div>
      </div>

      <div className={s.scrubWrap}>
        <p className={s.scrubLabel} id="making-of-scrub-label">
          Pull requests merged each day · drag to travel
        </p>
        <div
          className={s.scrub}
          role="slider"
          tabIndex={0}
          aria-labelledby="making-of-scrub-label"
          aria-valuemin={1}
          aria-valuemax={frames.length}
          aria-valuenow={i + 1}
          aria-valuetext={`Day ${dayNumber(frame.day, first)}, ${what}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
        >
          <div className={s.bars} aria-hidden="true">
            {days.map((d, k) => (
              <span
                key={d.day}
                className={s.bar}
                data-on={k <= dayIndex || undefined}
                data-hover={k === hover || undefined}
                style={{ "--h": `${Math.max(3, (d.prs / max) * 100)}%` } as CSSProperties}
              />
            ))}
          </div>
          <span className={s.playhead} style={{ "--x": pct(dayIndex) } as CSSProperties} aria-hidden="true" />
          {hovered && (
            <span className={s.tip} style={{ "--x": pct(hover!) } as CSSProperties} aria-hidden="true">
              {shortDay(hovered.day)} · {hovered.prs} {hovered.prs === 1 ? "PR" : "PRs"}
            </span>
          )}
        </div>
        <ol className={s.axis} aria-hidden="true">
          {chapters.map((c, k) => {
            const at = Math.max(0, days.findIndex((d) => d.day >= c.from));
            return (
              <li key={c.id} style={{ "--x": `${(at / days.length) * 100}%` } as CSSProperties} data-on={episodeNo === k + 1 || undefined}>
                <span className={s.axisEp}>Ep {k + 1}</span>
                <span className={s.axisDay}>{shortDay(c.from)}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
