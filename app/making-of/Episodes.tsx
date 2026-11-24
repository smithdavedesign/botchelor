"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import Icon from "@/app/Icon";
import { dayNumber, dayRange, longDay, prUrl, shortDay, type Chapter, type Frame } from "@/lib/making-of";
import s from "./making-of.module.css";

type Episode = Chapter & { n: number; frames: Frame[]; prs: number };

/** A frame as a card: the computer's picture with the phone's tucked in front, like the stage at the top. */
function Thumb({ frame }: { frame: Frame }) {
  const { desktop, phone } = frame;
  return (
    <span className={desktop ? s.thumb : `${s.thumb} ${s.thumbPhoneOnly}`}>
      {desktop && (
        // eslint-disable-next-line @next/next/no-img-element -- pre-cut WebP (public/making-of)
        <img className={s.thumbDesktop} src={desktop.card.src} width={desktop.card.w} height={desktop.card.h} alt="" loading="lazy" decoding="async" />
      )}
      {phone && (
        // eslint-disable-next-line @next/next/no-img-element -- pre-cut WebP (public/making-of)
        <img className={s.thumbPhone} src={phone.card.src} width={phone.card.w} height={phone.card.h} alt="" loading="lazy" decoding="async" />
      )}
    </span>
  );
}

/**
 * The season so far: each week an episode, with its title card and a row of the screenshots it brought; a card opens
 * the pictures full size in a viewer (a modal <dialog>: Escape or the backdrop closes it, arrows go through every frame
 * in order, across episodes).
 */
export default function Episodes({ episodes, first }: { episodes: Episode[]; first: string }) {
  const all = episodes.flatMap((e) => e.frames);
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = open === null ? null : all[open];

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open !== null && !d.open) d.showModal();
    if (open === null && d.open) d.close();
  }, [open]);

  const step = (by: number) => setOpen((n) => (n === null ? n : (n + by + all.length) % all.length));
  const onKey = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else return;
    e.preventDefault();
  };
  // A click on the backdrop lands on the dialog itself; one inside lands on its content.
  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) setOpen(null);
  };

  // Where each episode's frames start in the viewer's one list.
  const offsets = episodes.map((_, k) => episodes.slice(0, k).reduce((n, e) => n + e.frames.length, 0));
  return (
    <>
      <ol className={s.episodes}>
        {episodes.map((ep, k) => (
          <li key={ep.id} className={s.episode} id={`episode-${ep.n}`}>
            <div className={s.titleCard}>
              <p className={s.epMeta}>
                <span className={s.epNo}>Episode {ep.n}</span> · {dayRange(ep.from, ep.to)}
              </p>
              <h3 className={s.epTitle}>{ep.title}</h3>
              <p className={s.epBlurb}>{ep.blurb}</p>
              <p className={s.epCount}>{ep.prs.toLocaleString("en-US")} pull requests merged</p>
            </div>
            <ul className={s.strip}>
              {ep.frames.map((f, j) => {
                const at = offsets[k] + j;
                return (
                  <li key={`${f.pr}-${f.caption}`}>
                    <button type="button" className={s.card} onClick={() => setOpen(at)}>
                      <Thumb frame={f} />
                      <span className={s.cardCaption}>{f.caption}</span>
                      <span className={s.cardMeta}>
                        Day {dayNumber(f.day, first)} · {shortDay(f.day)} · #{f.pr}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>

      <dialog ref={dialog} className={s.viewer} aria-label={frame ? frame.caption : "Screenshot"} onClose={() => setOpen(null)} onKeyDown={onKey} onClick={onClick}>
        {frame && (
          <>
            <div className={s.viewerBody}>
              <div className={frame.desktop && frame.phone ? s.viewerPics : `${s.viewerPics} ${s.viewerOne}`}>
                {frame.desktop && (
                  // eslint-disable-next-line @next/next/no-img-element -- pre-cut WebP (public/making-of)
                  <img className={s.viewerDesktop} src={frame.desktop.full.src} width={frame.desktop.full.w} height={frame.desktop.full.h} alt={`On a computer: ${frame.caption}`} />
                )}
                {frame.phone && (
                  // eslint-disable-next-line @next/next/no-img-element -- pre-cut WebP (public/making-of)
                  <img className={s.viewerPhone} src={frame.phone.full.src} width={frame.phone.full.w} height={frame.phone.full.h} alt={`On a phone: ${frame.caption}`} />
                )}
              </div>
              <div className={s.viewerText}>
                <p className={s.epMeta}>
                  Day {dayNumber(frame.day, first)} · {longDay(frame.day)}
                </p>
                <h3 className={s.viewerCaption}>{frame.caption}</h3>
                <p className={s.viewerTitle}>
                  <a href={prUrl(frame.pr)} rel="noopener" target="_blank">
                    Pull request #{frame.pr}: {frame.title} <Icon name="arrowUpRight" />
                  </a>
                </p>
              </div>
            </div>
            {/* Outside the body and pinned to the dialog's bottom edge, so the way on and out is always in view. */}
            <div className={s.viewerNav}>
              <button type="button" className={s.step} onClick={() => step(-1)} aria-label="Previous screenshot">
                <Icon name="chevronLeft" />
              </button>
              <span className={s.viewerCount}>
                {(open ?? 0) + 1} of {all.length}
              </span>
              <button type="button" className={s.step} onClick={() => step(1)} aria-label="Next screenshot">
                <Icon name="chevronRight" />
              </button>
              <button type="button" className={s.close} onClick={() => setOpen(null)}>
                <Icon name="x" /> Close
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
