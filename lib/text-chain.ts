/**
 * A couple's text chain (David, 2026-10-17: "keep track of it like a text chain you can see on their relationship
 * page"). Everything two characters have texted each other, oldest first, as one thread:
 *
 *  - each date between them is a marker in the chain;
 *  - its afterglow (the morning-after texts, lib/afterglow.ts, stored on the episode) comes right after it;
 *  - their texts between dates (couple_texts) follow in the order they were sent: the show's daily text
 *    (lib/between-dates.ts), and what they text each other themselves, an agent in its own words or a person's own
 *    model key (lib/texting.ts).
 *
 * Merged when it's read, never copied: a date that's hidden, made private or removed takes its afterglow with it.
 * Owners only, like both sources, and only the dates that owner may see (lib/relationships.ts `visibleTo`). The texts
 * between dates are shared by both characters, so every owner of either one reads them.
 *
 * The chain also goes into the prompts: a date's characters, its morning after and the next texts all know the history
 * (`promptTexts`), from the dates the date's creator may use (`usableFor`) and every text between dates.
 */
import type { AfterglowLine } from "./afterglow";
import type { Db } from "./db";
import { pairKey, timelineLabel, usableFor, visibleTo, type End, type Viewer } from "./relationships";
import { REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
import { CHAIN_PAGE, isText, type ChainItem, type ChainPage, type ChainText } from "./text-chain-shared";
import { venueName, type VenueId } from "./venues";

export { CHAIN_PAGE, isText, TEXT_MAX, type ChainDate, type ChainEvent, type ChainItem, type ChainPage, type ChainText } from "./text-chain-shared";

/** Anyone who isn't an owner: the public layer (aired, public, unhidden dates). */
export const PUBLIC_VIEWER: Viewer = { userId: null, owner: false };

/** Whose dates the chain includes: a viewer's (`visibleTo`), or what a date set up by `usableBy` may bring in (`usableFor`). */
export type ChainLayer = Viewer | { usableBy: string };

const iso = (d: string | Date) => new Date(d).toISOString();
/** The chain's sort key (ISO times sort as text): when, the order within that moment, then what it is. */
const chainId = (at: string, order: number, what: string) => `${at}#${String(order).padStart(3, "0")}#${what}`;

/** A stored text between dates (couple_texts) as a chain item: the same id whether it's loaded or just sent. */
export function betweenText(t: { who: End; text: string; day: string; seq: number; created_at: string | Date }): ChainText {
  const at = iso(t.created_at);
  return { kind: "text", id: chainId(at, t.seq, `t:${t.day}:${t.seq}`), at, day: t.day, who: t.who, text: t.text, source: "between", episode_id: null };
}

type ChainEpisode = {
  id: string;
  created_at: string | Date;
  revealed_at: string | Date | null;
  visibility: string;
  hidden: boolean;
  creator_id: string;
  partner_performer: string | null;
  character_a: string;
  ending: Ending;
  afterglow: AfterglowLine[] | null;
  venue: VenueId | null;
  followup_of: string | null;
};

const CHAIN_EPISODES = `
  select e.id, e.created_at, e.revealed_at, e.visibility, e.creator_id, e.partner_performer, e.character_a, e.ending, e.afterglow,
         e.setup->>'venue' as venue, e.followup_of,
         (select count(*)::int from reports r where r.episode_id = e.id) >= $3 as hidden
    from episodes e
   where e.status = 'ready' and e.varies_episode_id is null
     and ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1))`;

/**
 * The whole chain between two characters, oldest first, with the dates `layer` allows. It doesn't check who's asking:
 * callers show it to the characters' owners only (the couple page, the texts route, the agent tools).
 */
export async function loadChain(db: Db, x: string, y: string, layer: ChainLayer): Promise<ChainItem[]> {
  const [lo, hi] = pairKey(x, y);
  const [eps, texts, match] = await Promise.all([
    db.query<ChainEpisode>(CHAIN_EPISODES, [lo, hi, REPORT_HIDE_THRESHOLD]),
    db.query<{ who: End; text: string; day: string; seq: number; created_at: string | Date }>(
      `select who, text, to_char(day, 'YYYY-MM-DD') as day, seq, created_at from couple_texts where character_lo = $1 and character_hi = $2`,
      [lo, hi],
    ),
    db.query<{ matched_at: string | Date; agreed_at: string | Date | null }>(`select matched_at, agreed_at from matches where character_lo = $1 and character_hi = $2`, [lo, hi]),
  ]);
  const allowed = (e: ChainEpisode) => {
    const h = {
      public: e.revealed_at !== null && e.visibility === "public" && !e.hidden,
      private: e.visibility === "private",
      creator: e.creator_id,
      ...(e.partner_performer ? { performer: e.partner_performer } : {}),
    };
    return "usableBy" in layer ? usableFor(h, layer.usableBy) : visibleTo(h, layer);
  };
  const seen = eps.rows
    .filter(allowed)
    .sort((p, q) => new Date(p.created_at).getTime() - new Date(q.created_at).getTime() || p.id.localeCompare(q.id));
  const ids = new Set(seen.map((e) => e.id));
  const ledOn = new Set(seen.flatMap((e) => (e.followup_of && ids.has(e.followup_of) ? [e.followup_of] : [])));

  const items: ChainItem[] = [];
  seen.forEach((e, i) => {
    const at = iso(e.created_at);
    const day = at.slice(0, 10);
    items.push({
      kind: "date",
      id: chainId(at, 0, `d:${e.id}`),
      at,
      day,
      episode_id: e.id,
      number: i + 1,
      venue: venueName(e.venue),
      ending_label: timelineLabel(e, ledOn.has(e.id), Boolean(e.followup_of && ids.has(e.followup_of))),
      aired: e.revealed_at !== null,
    });
    // The morning after, right behind its date. Side "a" is the episode's character_a, which may be either end.
    (e.afterglow ?? []).forEach((line, n) => {
      const who: End = (line.side === "a") === (e.character_a === lo) ? "lo" : "hi";
      items.push({ kind: "text", id: chainId(at, n + 1, `a:${e.id}`), at, day, who, text: line.text, source: "afterglow", episode_id: e.id });
    });
  });
  for (const t of texts.rows) items.push(betweenText(t));
  // How they met, when it was the swipe deck (lib/swipes.ts): the match, and when both said yes to a date.
  const m = match.rows[0];
  if (m) {
    const at = iso(m.matched_at);
    items.push({ kind: "event", id: chainId(at, 0, "m:matched"), at, day: at.slice(0, 10), event: "matched" });
    if (m.agreed_at) {
      const agreed = iso(m.agreed_at);
      items.push({ kind: "event", id: chainId(agreed, 999, "m:agreed"), at: agreed, day: agreed.slice(0, 10), event: "date_agreed" });
    }
  }
  return items.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}

/** One page of the chain: the `limit` items just before `before` (an item's id), or the newest when it's null. */
export function chainPage(items: ChainItem[], before: string | null = null, limit = CHAIN_PAGE): ChainPage {
  const at = before ? items.findIndex((item) => item.id >= before) : -1;
  const end = at === -1 ? items.length : at;
  const start = Math.max(0, end - limit);
  return { items: items.slice(start, end), cursor: start > 0 ? items[start].id : null, has_more: start > 0 };
}

/** What came after `after` (an item's id), oldest first, at most `limit`: the phone's check for new texts. */
export function chainAfter(items: ChainItem[], after: string, limit = 200): ChainItem[] {
  return items.filter((item) => item.id > after).slice(0, limit);
}

/** How much of the chain goes into a date's prompts: everything, unless it's very long (then the newest that fit). */
export function dateTextsBudget(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.DATE_TEXTS_CHARS?.trim() || 12_000);
  return Number.isFinite(n) ? Math.max(0, Math.min(200_000, Math.floor(n))) : 12_000;
}
/** One text's share of a prompt: a very long one is cut, so it can't crowd out the rest of the history. */
export const PROMPT_TEXT_MAX = 1_500;

export type PromptText = { from: "you" | "them"; text: string };
export type PromptTexts = { texts: PromptText[]; earlier: number };

/**
 * A chain's texts as one side sees them in a prompt, oldest first: every text, or when they run past `budget`
 * characters the newest that fit, with how many earlier ones were left out.
 */
export function promptTexts(items: ChainItem[], self: End, budget = dateTextsBudget(), perText = PROMPT_TEXT_MAX): PromptTexts {
  const all = items.filter(isText);
  const kept: PromptText[] = [];
  let used = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const t = all[i];
    const text = t.text.length > perText ? `${t.text.slice(0, perText - 1).trimEnd()}…` : t.text;
    if (used + text.length > budget) break;
    used += text.length;
    kept.unshift({ from: t.who === self ? "you" : "them", text });
  }
  return { texts: kept, earlier: all.length - kept.length };
}

/** A side's texts as a prompt carries them ("your_texts_with_them"). */
export const textsForPrompt = (t: PromptTexts): Record<string, unknown> => ({
  ...(t.earlier ? { earlier_texts_left_out: t.earlier } : {}),
  texts: t.texts,
});
