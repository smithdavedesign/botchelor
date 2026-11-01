"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { trackConversion } from "@/app/conversion";
import type { Post } from "@/lib/showcase";
import { shortName } from "@/lib/names";
import LikeButton from "../LikeButton";
import MadeWith from "../MadeWith";
import { feedOf, motionOf, type ReelCard } from "./reel-shared";
import styles from "./reels.module.css";

type Props = {
  initial: Post[];
  more: boolean;
  locked: Record<string, number>;
  /** The filters, as a query string (no page), for the next pages and the side tabs. */
  query: string;
  side: "pg" | "after_dark";
  /** Whether this viewer may see After Dark (the side tabs). */
  explicit: boolean;
  start: string | null;
  /** When the feed began: its every page orders what was seen before then last (lib/showcase.ts seenBefore). */
  asOf: string;
  back: string;
};

const src = (p: Post) => `/api/showcase/${p.id}/media`;
/** A still at a phone screen's size (lib/showcase-thumbs.ts); its blurred backdrop needs no more than a tile's. */
const still = (p: Post, size: "tile" | "screen") => `${src(p)}?size=${size}`;
const isClip = (x: ReturnType<typeof feedOf<Post>>[number] | undefined) => x?.kind === "post" && x.post.mime.startsWith("video/");
const cta = (name: "date" | "see_all" | "after_dark" | "create") => () => trackConversion("reel_cta", { cta: name });

/**
 * The showcase as reels (David, 2026-10-29: "an infinite reel / video, scroll-swipe, like candy.ai, Instagram, TikTok"):
 * one post a screen, swiped or scrolled (↑ ↓, j k), the next page loading while the last few are watched.
 *
 * - A clip plays, muted, while it's on screen (David, 2026-10-30: no sound buttons). A still moves slowly, a different
 *   way each time (a "living photo"): the safe picture of someone, animated, at no cost. Reduced motion: nothing moves or plays by itself.
 * - Each post asks one thing first: 💘 date them (their page, where a date is booked), then see all of them, and, for
 *   someone After Dark isn't open to, how many more of them are after dark (the subscription; its waitlist until it
 *   opens). Every few posts a card: make your own character (the first dates free), or After Dark. No countdowns, no
 *   streaks, nothing locked that's on the showcase already.
 * - After Dark's side (whoever may see it): blurred until a tap says to show it.
 * - Loading: the clip on screen first, the next one only once it can play through (with a poster meanwhile), the one
 *   before kept; a still loads eagerly near the screen, lazily further off.
 * - A post on screen a moment is seen: this browser's next feed has it at the back (lib/showcase.ts markSeen).
 */
export default function ReelFeed(props: Props) {
  const router = useRouter();
  const [posts, setPosts] = useState(props.initial);
  const [locked, setLocked] = useState(props.locked);
  const [more, setMore] = useState(props.more);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [shown, setShown] = useState(props.side !== "after_dark");
  const [info, setInfo] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);
  // The screen whose clip can play through: only then does the next one start loading, so the one watched comes first.
  const [ready, setReady] = useState(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const feed = useMemo(() => feedOf(posts, { afterDarkCard: !props.explicit && props.side === "pg" }), [posts, props.explicit, props.side]);
  const total = feed.length + (more ? 0 : 1);

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    // The page under the reels stays put while they scroll.
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  // Which screen is in view: the one that fills most of it.
  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { root, threshold: [0.6] },
    );
    root.querySelectorAll("[data-i]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [total]);

  // Opened at a post ("▶ Reels from here"): start there.
  useEffect(() => {
    if (!props.start) return;
    const i = feed.findIndex((x) => x.kind === "post" && x.post.id === props.start);
    if (i > 0) scroller.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "start" });
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On screen a moment: seen (once a feed), so a reload or a return starts on what's new to them.
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const x = feed[active];
    if (x?.kind !== "post" || seen.current.has(x.post.id)) return;
    const id = x.post.id;
    const t = window.setTimeout(() => {
      seen.current.add(id);
      void fetch("/api/showcase/reels/seen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ post_id: id }), keepalive: true }).catch(() => {});
    }, 1200);
    return () => window.clearTimeout(t);
  }, [active, feed]);

  // The next page, while the last few are watched.
  useEffect(() => {
    if (!more || loading || active < feed.length - 3) return;
    setLoading(true);
    fetch(`/api/showcase/reels?${props.query}${props.query ? "&" : ""}page=${page + 1}&as_of=${encodeURIComponent(props.asOf)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { posts: Post[]; more: boolean; locked: Record<string, number> } | null) => {
        if (!d) return setMore(false);
        setPosts((now) => {
          const seen = new Set(now.map((p) => p.id));
          return [...now, ...d.posts.filter((p) => !seen.has(p.id))];
        });
        setLocked((l) => ({ ...l, ...d.locked }));
        setMore(Boolean(d.more) && d.posts.length > 0);
        setPage((n) => n + 1);
      })
      .catch(() => setMore(false))
      .finally(() => setLoading(false));
  }, [active, feed.length, more, loading, page, props.query]);

  // The clip on screen plays; the rest wait at their start.
  useEffect(() => {
    scroller.current?.querySelectorAll<HTMLVideoElement>("video[data-v]").forEach((v) => {
      // Loaded already (it was the next one, or came back to): ready now, since it won't say so again.
      if (Number(v.dataset.v) === active && v.readyState >= 4) setReady(active);
      if (Number(v.dataset.v) === active && shown && !reduced) void v.play().catch(() => {});
      else {
        v.pause();
        if (Number(v.dataset.v) !== active) v.currentTime = 0;
      }
    });
  }, [active, shown, reduced, total]);

  const go = (to: number) => scroller.current?.querySelector(`[data-i="${Math.max(0, Math.min(total - 1, to))}"]`)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (["ArrowDown", "PageDown", "j"].includes(e.key)) {
        e.preventDefault();
        go(active + 1);
      } else if (["ArrowUp", "PageUp", "k"].includes(e.key)) {
        e.preventDefault();
        go(active - 1);
      } else if (e.key === "Escape") {
        if (info) setInfo(null);
        else router.push(props.back);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function share(p: Post) {
    const url = `${window.location.origin}/showcase/reels?start=${encodeURIComponent(p.id)}${p.rating === "nsfw" ? "&side=after_dark" : ""}`;
    try {
      if (navigator.share) await navigator.share({ url, title: `${p.character.name} on Botchelor` });
      else {
        await navigator.clipboard.writeText(url);
        setNote("Link copied.");
      }
    } catch {
      /* they closed the share sheet */
    }
  }

  const sideHref = (side: "pg" | "after_dark") => {
    const q = new URLSearchParams(props.query);
    q.delete("side");
    for (const k of ["act", "place", "character", "partner", "medium", "from", "pov", "shape"]) q.delete(k);
    if (side === "after_dark") q.set("side", "after_dark");
    const s = q.toString();
    return s ? `/showcase/reels?${s}` : "/showcase/reels";
  };

  return (
    <div className={styles.reels}>
      <div className={styles.top}>
        <Link href={props.back} className={styles.topLink} aria-label="Back to the showcase">
          ← Showcase
        </Link>
        {props.explicit && (
          <span className={styles.sides} role="group" aria-label="Which side">
            <Link href={sideHref("pg")} className={props.side === "pg" ? styles.sideOn : undefined} aria-current={props.side === "pg" ? "true" : undefined}>
              <span className={styles.long}>Safe for work</span>
              <span className={styles.short}>SFW</span>
            </Link>
            <Link href={sideHref("after_dark")} className={props.side === "after_dark" ? styles.sideOn : undefined} aria-current={props.side === "after_dark" ? "true" : undefined}>
              🌙 After Dark
            </Link>
          </span>
        )}
      </div>
      <div className={styles.feed} ref={scroller} role="feed" aria-busy={loading} aria-label="Reels">
        {feed.length === 0 && (
          <section className={`${styles.slide} ${styles.card}`} data-i={0}>
            <div className={styles.cardBody}>
              <h2>Nothing here yet</h2>
              <p>Creators publish from their Studio: 📣 on any picture or clip.</p>
              <Link href={props.back} className={styles.cta}>
                Back to the showcase
              </Link>
            </div>
          </section>
        )}
        {feed.map((x, i) =>
          x.kind === "card" ? (
            <Card key={`card-${x.n}`} i={i} card={x.card} active={i === active} onNext={() => go(i + 1)} />
          ) : (
            <Slide
              key={x.post.id}
              i={i}
              post={x.post}
              active={i === active}
              near={i === active || i === active - 1 || (i === active + 1 && (ready === active || !isClip(feed[active])))}
              moving={i === active && shown && !reduced}
              veiled={!shown}
              locked={props.explicit ? 0 : (locked[x.post.character.id] ?? 0)}
              onShare={() => void share(x.post)}
              onInfo={() => setInfo(x.post.id)}
              onReady={() => setReady(i)}
            />
          ),
        )}
        {!more && feed.length > 0 && (
          <section className={`${styles.slide} ${styles.card}`} data-i={feed.length} aria-label="The end, for now" aria-current={active === feed.length ? "true" : undefined}>
            <div className={styles.cardBody}>
              <h2>That&apos;s everything here, for now</h2>
              <p>New pictures and clips land as their creators publish them.</p>
              <button type="button" className={styles.cta} onClick={() => go(0)}>
                Start again from the top
              </button>
              <Link href="/create" className={styles.ctaGhost} onClick={cta("create")}>
                Make your own character
              </Link>
            </div>
          </section>
        )}
      </div>
      {!shown && (
        <div className={styles.veil} role="dialog" aria-label="After Dark">
          <p>🌙 After Dark: explicit pictures and clips of fictional adults.</p>
          <button type="button" className={styles.cta} onClick={() => setShown(true)}>
            Show them
          </button>
          <Link href={sideHref("pg")} className={styles.ctaGhost}>
            Safe for work instead
          </Link>
        </div>
      )}
      {info && (
        <div className={styles.sheet} role="dialog" aria-label="How it was made">
          <MadeWith postId={info} />
          <button type="button" className={styles.ctaGhost} onClick={() => setInfo(null)}>
            Close
          </button>
        </div>
      )}
      {note && (
        <p className={styles.toast} role="status" onAnimationEnd={() => setNote(null)}>
          {note}
        </p>
      )}
    </div>
  );
}

function Slide({
  i,
  post: p,
  active,
  near,
  moving,
  veiled,
  locked,
  onShare,
  onInfo,
  onReady,
}: {
  i: number;
  post: Post;
  active: boolean;
  near: boolean;
  moving: boolean;
  veiled: boolean;
  locked: number;
  onShare: () => void;
  onInfo: () => void;
  onReady: () => void;
}) {
  const video = p.mime.startsWith("video/");
  const first = shortName(p.character.name);
  const who = `${p.character.name}${p.partner ? ` and ${p.partner.name}` : ""}, by @${p.creator.handle}`;
  return (
    <section className={styles.slide} data-i={i} aria-label={who} aria-current={active ? "true" : undefined}>
      {/* The same picture, blurred, filling a wide screen's sides. */}
      {!video && near && <img className={styles.backdrop} src={still(p, "tile")} alt="" aria-hidden="true" />}
      <div className={`${styles.frame}${veiled ? ` ${styles.veiled}` : ""}`}>
        {video ? (
          // Its first frame shows while it loads (the picture it was filmed from, when there is one).
          <video
            data-v={i}
            src={near ? src(p) : undefined}
            poster={near && p.poster ? still(p, "screen") : undefined}
            muted
            loop
            playsInline
            preload={active ? "auto" : near ? "metadata" : "none"}
            onCanPlayThrough={active ? onReady : undefined}
            aria-label={who}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- served by the showcase's own gate, not next/image
          <img src={still(p, "screen")} alt={who} loading={near ? "eager" : "lazy"} className={moving ? styles[motionOf(i)] : undefined} />
        )}
        <div className={styles.shade} aria-hidden="true" />
        <div className={styles.info}>
          <p className={styles.who}>
            <Link href={`/characters/${p.character.id}`}>{p.character.name}</Link>
            {p.partner && (
              <>
                {" & "}
                <Link href={`/characters/${p.partner.id}`}>{p.partner.name}</Link>
              </>
            )}
            {p.rating === "suggestive" && <span className={styles.tag}>Suggestive</span>}
          </p>
          <p className={styles.by}>
            <Link href={`/creators/${p.creator.handle}`}>@{p.creator.handle}</Link>
          </p>
          {p.caption && <p className={styles.caption}>{p.caption}</p>}
          <p className={styles.ctas}>
            {/* A date when they can be asked by name; else their page, to meet them (lib/showcase.ts dateable). */}
            <Link href={`/characters/${p.character.id}`} className={styles.cta} onClick={cta("date")}>
              {p.dateable === false ? `Meet ${first}` : `💘 Date ${first}`}
            </Link>
            <Link href={`/showcase?character=${encodeURIComponent(p.character.id)}`} className={styles.ctaGhost} onClick={cta("see_all")}>
              See all of {first}
            </Link>
          </p>
          {locked > 0 && (
            <Link href="/after-dark/subscribe" className={styles.lock} onClick={cta("after_dark")}>
              🌙 {locked} more of {first} after dark
            </Link>
          )}
        </div>
        <div className={styles.rail}>
          <LikeButton postId={p.id} likes={p.likes} liked={p.liked} />
          <button type="button" onClick={onShare} aria-label="Share">
            ↗<span>Share</span>
          </button>
          <button type="button" onClick={onInfo} aria-label="How it was made">
            ⓘ<span>Made with</span>
          </button>
        </div>
      </div>
    </section>
  );
}

const CARDS: Record<ReelCard, { title: string; body: string; cta: string; href: string; track: "create" | "after_dark" }> = {
  create: {
    title: "Make your own character",
    body: "Two minutes: a name, a look, what they're after. Then send them on dates and watch what happens. Your first dates are free.",
    cta: "Make a character",
    href: "/create",
    track: "create",
  },
  after_dark: {
    title: "🌙 After Dark",
    body: "The private side of the season, for adults: what happens after the cameras stop, and the pictures and clips that go with it.",
    cta: "See what's in it",
    href: "/after-dark/subscribe",
    track: "after_dark",
  },
};

function Card({ i, card, active, onNext }: { i: number; card: ReelCard; active: boolean; onNext: () => void }) {
  const c = CARDS[card];
  return (
    <section className={`${styles.slide} ${styles.card}`} data-i={i} aria-label={c.title} aria-current={active ? "true" : undefined}>
      <div className={styles.cardBody}>
        <h2>{c.title}</h2>
        <p>{c.body}</p>
        <Link href={c.href} className={styles.cta} onClick={cta(c.track)}>
          {c.cta}
        </Link>
        <button type="button" className={styles.ctaGhost} onClick={onNext}>
          Keep watching ↓
        </button>
      </div>
    </section>
  );
}
