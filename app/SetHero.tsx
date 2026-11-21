import type { ReactNode } from "react";
import { showSetPath, type ShowSet } from "@/lib/show-sets";

type Props = {
  /** Which of the show's four sets stands behind the words (lib/show-sets.ts). */
  set: ShowSet;
  /** The eyebrow over the heading. */
  kicker?: ReactNode;
  /** The page's own h1. */
  title: ReactNode;
  /** The line under the heading, as a `.lede` paragraph. */
  lede?: ReactNode;
  /** Something that moves beside the words: a clip in a phone, a loop (right on a computer, under the words on a phone). */
  media?: ReactNode;
  /** The page's own links and controls that belong with its heading, under the lede. */
  children?: ReactNode;
  /** False when something comes first on the page (a row of tabs): the band then keeps its distance from it. */
  flush?: boolean;
};

/**
 * A page's title band on one of the show's sets (the visual pop audit, 2026-11-20, docs/audits/2026-11-20-visual-pop-
 * audit.md): edge to edge under the header, the set behind the words with a slow push-in, a dark grade toward the words
 * and a little grain, the page's own kicker, h1 and lede, and an optional media slot. Dark in both themes, like the
 * home stage, so its words are --on-photo.
 *
 * Complete at rest: the words never wait on anything, and the set is one small eager picture (1024 x 576, 8-42 KB) and
 * the only one the band loads; the push-in only adds, and reduced motion keeps the still frame. Pure (no hooks), so it
 * renders on the server. Legal pages stay plain on purpose.
 */
export default function SetHero({ set, kicker, title, lede, media, children, flush = true }: Props) {
  const cls = ["set-hero", `set-hero--${set}`, media ? "has-media" : "", flush ? "is-flush" : ""].filter(Boolean).join(" ");
  return (
    <header className={cls} data-set={set}>
      <div className="set-hero-stage" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static public asset, the band's one picture */}
        <img className="set-hero-art" src={showSetPath(set)} alt="" width={1024} height={576} decoding="async" fetchPriority="high" />
      </div>
      <div className="set-hero-inner">
        <div className="set-hero-words">
          {kicker && <p className="kicker">{kicker}</p>}
          <h1>{title}</h1>
          {lede && <p className="lede">{lede}</p>}
          {children}
        </div>
        {media && <div className="set-hero-media">{media}</div>}
      </div>
    </header>
  );
}
