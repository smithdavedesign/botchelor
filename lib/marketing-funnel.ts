/**
 * Marketing's funnel (the visual pop audit's leftovers, /marketing): posts, the visitors they brought, the visitors
 * who made a character and the ones who started a date, as bars on one scale above the log. The numbers are the
 * summary's own (lib/public-marketing.ts totals); this only says how long each bar is and what to print beside it.
 * Pure, so the page and the test read the same steps.
 */
import type { PublicMarketing } from "./public-marketing";

export type FunnelStep = {
  key: "posts" | "visitors" | "created" | "started";
  label: string;
  value: number;
  /** The bar's length, 0 to 1, against the largest step. */
  share: number;
  /** What the figure means beside the one before it, or null when there's nothing to compare with. */
  note: string | null;
};

type Totals = Pick<PublicMarketing["totals"], "posts" | "channels" | "visitors" | "created" | "started">;

/** "8%", "4.2%", "0.4%": a share of visitors, to one place under ten. */
export function percentOf(n: number, of: number): string {
  const p = (n / of) * 100;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1).replace(/\.0$/, "")}%`;
}

/** The four steps, or null before there's a post or a visitor to show. */
export function funnelSteps(t: Totals): FunnelStep[] | null {
  if (t.posts <= 0 && t.visitors <= 0) return null;
  const max = Math.max(t.posts, t.visitors, t.created, t.started);
  const share = (n: number) => Math.max(0, n) / max;
  const ofVisitors = (n: number) => (t.visitors > 0 ? `${percentOf(n, t.visitors)} of visitors` : null);
  const perPost = t.posts > 0 ? t.visitors / t.posts : null;
  return [
    { key: "posts", label: "Posts", value: t.posts, share: share(t.posts), note: t.channels > 0 ? `on ${t.channels} channel${t.channels === 1 ? "" : "s"}` : null },
    {
      key: "visitors",
      label: "Visitors",
      value: t.visitors,
      share: share(t.visitors),
      note: perPost === null ? null : `${perPost >= 10 ? Math.round(perPost) : perPost.toFixed(1).replace(/\.0$/, "")} a post`,
    },
    { key: "created", label: "Made a character", value: t.created, share: share(t.created), note: ofVisitors(t.created) },
    { key: "started", label: "Started a date", value: t.started, share: share(t.started), note: ofVisitors(t.started) },
  ];
}
