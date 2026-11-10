"use client";

import RemixButton from "./RemixButton";
import ReportPost from "./ReportPost";
import LikeButton from "./LikeButton";
import MadeWith from "./MadeWith";
import AdminSide from "./AdminSide";
import { playClip, soleSound, setSound, useSound } from "./sound";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Post } from "@/lib/showcase";
import { actLabel, placeLabel, SHOW_HANDLE } from "@/lib/showcase-labels";

const route = (p: Post) => `/api/showcase/${p.id}/media`;
/** Where its file is (Post.media: After Dark's host straight away when the file is there), else the show's route. */
const src = (p: Post) => p.media ?? route(p);
const sized = (url: string) => `${url}${url.includes("?") ? "&" : "?"}size=tile`;
/** A tile's picture: a smaller copy (lib/showcase-thumbs.ts); the viewer gets the original. */
const tileSrc = (p: Post) => sized(src(p));
/** Once, back to the show's own route when the direct link fails (its grant outlived by a page left open). */
const fallBack = (p: Post, tile: boolean) => (e: { currentTarget: HTMLImageElement | HTMLVideoElement }) => {
  const el = e.currentTarget;
  if (el.dataset.fb || !p.media || p.media === route(p)) return;
  el.dataset.fb = "1";
  el.src = tile ? sized(route(p)) : route(p);
};

/**
 * The showcase's grid and its viewer (lib/showcase.ts): a masonry of pictures and clips in their own shapes (clips play
 * looping: on hover or focus, or on a touch screen while mostly in view; never while still blurred; muted until 🔇 on a
 * tile or the viewer's own control turns sound on for every clip, ./sound.ts), and a tap
 * opens one large with who made it, who's in it, what it shows, how it was made (the model
 * and prompt, MadeWith), and the ones either side
 * (← → and Esc). An explicit one (admins only for now) stays blurred until it's tapped. A clip's tile shows the picture
 * it was filmed from, or its first frame, never an empty box. `reels`: the filters as a query, so "Watch full screen
 * from here" opens the reels at this post with the same filters.
 */
export default function ShowcaseGrid({ posts, admin = false, reels = "" }: { posts: Post[]; admin?: boolean; reels?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const close = useCallback(() => setOpen(null), []);
  // Each tile's clip, to play on hover (David, 2026-10-29: "if unblurred on hover have the video start").
  const clips = useRef(new Map<string, HTMLVideoElement>());
  const play = (id: string) => {
    const v = clips.current.get(id);
    if (v) void playClip(v);
  };
  const [sound] = useSound();
  // 🔇 on a tile: the switch for every clip, heard (or not) at once on this one, which a tap may start with sound.
  const toggleSound = (id: string) => {
    setSound(!sound);
    play(id);
  };
  // The viewer's clip plays as it opens or changes, with sound when the switch is on.
  const bigRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (open !== null && bigRef.current) void playClip(bigRef.current);
  }, [open]);
  const stop = (id: string) => {
    const v = clips.current.get(id);
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  };
  // A touch screen has no hover: there a clip plays while it's mostly in view (never with reduced motion, never blurred).
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || window.matchMedia("(hover: hover)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (e.intersectionRatio >= 0.6 && v.dataset.veiled !== "1") void playClip(v);
          else v.pause();
        }
      },
      { threshold: [0, 0.6] },
    );
    for (const v of clips.current.values()) io.observe(v);
    return () => io.disconnect();
  }, [posts, shown]);
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : Math.min(posts.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, posts.length, close]);
  const media = (p: Post, big = false, veiled = false) =>
    p.mime.startsWith("video/") ? (
      <video
        ref={big ? bigRef : (el) => void (el ? clips.current.set(p.id, el) : clips.current.delete(p.id))}
        data-veiled={veiled ? "1" : undefined}
        data-sound
        // A tile with no still of its own shows its first frame (a media fragment: browsers draw that frame on load).
        src={big || p.poster ? src(p) : `${src(p)}#t=0.1`}
        poster={!big && p.poster ? tileSrc(p) : undefined}
        muted
        loop
        playsInline
        preload="metadata"
        controls={big}
        // Its own control's mute button is the same switch.
        onVolumeChange={
          big
            ? (e) => {
                const v = e.currentTarget;
                setSound(!v.muted);
                soleSound(v);
              }
            : undefined
        }
        onError={fallBack(p, false)}
        aria-label={describe(p)}
      />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element -- served by the showcase's own gate, not next/image
      <img src={big ? src(p) : tileSrc(p)} alt={describe(p)} loading="lazy" onError={fallBack(p, !big)} />
    );
  const p = open === null ? null : posts[open];
  return (
    <>
      <ul className="showcase-grid">
        {posts.map((x, i) => {
          const veiled = x.rating === "nsfw" && !shown.has(x.id);
          return (
            <li key={x.id} className={`showcase-tile${veiled ? " veiled" : ""}`}>
              {/* Hover on the picture and its 🔇 together: reaching for 🔇 doesn't stop the clip. */}
              <div className="showcase-media" onPointerEnter={(e) => !veiled && e.pointerType === "mouse" && play(x.id)} onPointerLeave={() => stop(x.id)}>
                <button
                  type="button"
                  className="showcase-open"
                  style={{ aspectRatio: (x.aspect ?? "3:4").replace(":", " / ") }}
                  onClick={() => (veiled ? setShown((s) => new Set(s).add(x.id)) : setOpen(i))}
                  onFocus={() => !veiled && play(x.id)}
                  onBlur={() => stop(x.id)}
                  aria-label={veiled ? "Show this explicit post" : `Open: ${describe(x)}`}
                >
                  {media(x, false, veiled)}
                  {x.medium !== "picture" && <span className="showcase-badge" aria-hidden="true">{x.medium === "boomerang" ? "↔" : x.medium === "loop" ? "∞" : "▶"}</span>}
                  {/* Suggestive (signed-in people only, lib/content-rating.ts): said on the tile, like the PG Studio's. */}
                  {x.rating === "suggestive" && <span className="showcase-rating">Suggestive</span>}
                  {veiled && <span className="showcase-veil">After Dark · tap to show</span>}
                </button>
                {x.mime.startsWith("video/") && !x.silent && !veiled && (
                  <button type="button" className="showcase-sound" onClick={() => toggleSound(x.id)} aria-pressed={sound} aria-label={sound ? "Mute clips" : "Turn sound on for clips"}>
                    {sound ? "🔊" : "🔇"}
                  </button>
                )}
              </div>
              <p className="showcase-by small">
                <LikeButton postId={x.id} likes={x.likes} liked={x.liked} />{" "}
                {x.creator.handle !== SHOW_HANDLE && (
                  <>
                    <Link href={`/creators/${x.creator.handle}`}>@{x.creator.handle}</Link> ·{" "}
                  </>
                )}
                {x.character.name}
                {x.partner ? ` & ${x.partner.name}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
      {p && (
        <div className="showcase-viewer" role="dialog" aria-modal="true" aria-label={describe(p)} onClick={close}>
          <div className="showcase-viewer-inner" onClick={(e) => e.stopPropagation()}>
            <div className="showcase-viewer-media">{media(p, true)}</div>
            <div className="showcase-viewer-side">
              <p>
                <Link href={`/creators/${p.creator.handle}`}><strong>{p.creator.display_name}</strong> @{p.creator.handle}</Link>
              </p>
              <p className="small">
                <Link href={`/characters/${p.character.id}`}>{p.character.name}</Link>
                {p.partner && (
                  <>
                    {" & "}
                    <Link href={`/characters/${p.partner.id}`}>{p.partner.name}</Link>
                  </>
                )}
              </p>
              {p.caption && <p>{p.caption}</p>}
              <p>
                <LikeButton key={p.id} postId={p.id} likes={p.likes} liked={p.liked} />
              </p>
              <p className="muted small">{[p.act ? actLabel(p.act) : "", p.place ? placeLabel(p.place) : "", p.pov ? "First person" : "", p.from_date ? "From a date" : "From the Studio"].filter(Boolean).join(" · ")}</p>
              <MadeWith postId={p.id} />
              <p className="small">
                <Link href={`/showcase/reels?start=${encodeURIComponent(p.id)}${reels ? `&${reels}` : p.rating === "nsfw" ? "&side=after_dark" : ""}`}>▶ Watch full screen from here</Link>
              </p>
              {admin && <AdminSide key={`side-${p.id}`} post={p} />}
              <RemixButton key={`remix-${p.id}`} post={p} />
              <p className="muted small">Made with AI. Every character is a fictional adult.</p>
              <ReportPost key={`report-${p.id}`} postId={p.id} />
              <p className="showcase-viewer-nav">
                <button type="button" className="button-ghost small" disabled={open === 0} onClick={() => setOpen((i) => (i ?? 1) - 1)} aria-label="The one before">←</button>
                <button type="button" className="button-ghost small" onClick={close}>Close</button>
                <button type="button" className="button-ghost small" disabled={open === posts.length - 1} onClick={() => setOpen((i) => (i ?? -1) + 1)} aria-label="The one after">→</button>
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** A post in words, for its alt text: who's in it and what it shows. */
function describe(p: Post): string {
  return [`${p.character.name}${p.partner ? ` and ${p.partner.name}` : ""}`, p.act ? actLabel(p.act) : "", p.place ? placeLabel(p.place) : "", `by @${p.creator.handle}`].filter(Boolean).join(", ");
}
