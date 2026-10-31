/** The reels' page: small, so the next one loads while the last few are watched (app/showcase/reels/ReelFeed.tsx). */
export const REEL_PAGE = 8;
/** After how many posts a card comes (making a character, After Dark's list), never two in a row. */
export const CARD_EVERY = 6;

/** When a feed began (its pages' `as_of`, lib/showcase.ts seenBefore): a stamp from the query, else now. */
export function asOfFrom(value: unknown): Date {
  const d = typeof value === "string" ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) && d.getTime() <= Date.now() ? d : new Date();
}

/** A still's slow movement (a "living photo"), by its place in the feed: never the same twice running. */
export const MOTIONS = ["push", "pan-left", "rise", "pan-right"] as const;
export const motionOf = (i: number): (typeof MOTIONS)[number] => MOTIONS[i % MOTIONS.length];

export type ReelCard = "create" | "after_dark";
/**
 * What comes in the feed: each post, and after every CARD_EVERY a card, taking turns. After Dark's card only for
 * someone who can't see After Dark and isn't on its side already.
 */
export function feedOf<T>(posts: readonly T[], opts: { afterDarkCard: boolean }): ({ kind: "post"; post: T; n: number } | { kind: "card"; card: ReelCard; n: number })[] {
  const cards: ReelCard[] = opts.afterDarkCard ? ["create", "after_dark"] : ["create"];
  const out: ({ kind: "post"; post: T; n: number } | { kind: "card"; card: ReelCard; n: number })[] = [];
  posts.forEach((post, i) => {
    out.push({ kind: "post", post, n: i });
    if ((i + 1) % CARD_EVERY === 0) out.push({ kind: "card", card: cards[Math.floor(i / CARD_EVERY) % cards.length], n: i });
  });
  return out;
}

/** A page's filters as the reels' query (never the page, where to start, nor when it began), with any extra: "?…" or "". */
export function reelsQuery(sp: Record<string, string | string[] | undefined>, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const one = Array.isArray(v) ? v[0] : v;
    if (one && k !== "page" && k !== "start" && k !== "as_of") q.set(k, one);
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}
