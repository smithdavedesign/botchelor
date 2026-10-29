"use client";

import RemixButton from "./RemixButton";
import ReportPost from "./ReportPost";
import LikeButton from "./LikeButton";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Post } from "@/lib/showcase";
import { actLabel, placeLabel } from "@/lib/showcase-labels";

const src = (p: Post) => `/api/showcase/${p.id}/media`;

/**
 * The showcase's grid and its viewer (lib/showcase.ts): a masonry of pictures and clips in their own shapes (clips play
 * muted, looping), and a tap opens one large with who made it, who's in it, what it shows, and the ones either side
 * (← → and Esc). An explicit one (admins only for now) stays blurred until it's tapped.
 */
export default function ShowcaseGrid({ posts }: { posts: Post[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const close = useCallback(() => setOpen(null), []);
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
  const media = (p: Post, big = false) =>
    p.mime.startsWith("video/") ? (
      <video src={src(p)} muted loop playsInline autoPlay={big} preload="metadata" controls={big} aria-label={describe(p)} />
    ) : (
      // eslint-disable-next-line @next/next/no-img-element -- served by the showcase's own gate, not next/image
      <img src={src(p)} alt={describe(p)} loading="lazy" />
    );
  const p = open === null ? null : posts[open];
  return (
    <>
      <ul className="showcase-grid">
        {posts.map((x, i) => {
          const veiled = x.rating === "nsfw" && !shown.has(x.id);
          return (
            <li key={x.id} className={`showcase-tile${veiled ? " veiled" : ""}`}>
              <button type="button" className="showcase-open" style={{ aspectRatio: (x.aspect ?? "3:4").replace(":", " / ") }} onClick={() => (veiled ? setShown((s) => new Set(s).add(x.id)) : setOpen(i))} aria-label={veiled ? "Show this explicit post" : `Open: ${describe(x)}`}>
                {media(x)}
                {x.medium !== "picture" && <span className="showcase-badge" aria-hidden="true">{x.medium === "boomerang" ? "↔" : x.medium === "loop" ? "∞" : "▶"}</span>}
                {veiled && <span className="showcase-veil">After Dark · tap to show</span>}
              </button>
              <p className="showcase-by small">
                <LikeButton postId={x.id} likes={x.likes} liked={x.liked} /> <Link href={`/creators/${x.creator.handle}`}>@{x.creator.handle}</Link> · {x.character.name}
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
