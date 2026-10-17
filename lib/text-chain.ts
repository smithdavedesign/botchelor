/**
 * A couple's text chain (David, 2026-10-17: "keep track of it like a text chain you can see on their relationship
 * page"). Everything two characters have texted each other, oldest first, as one thread:
 *
 *  - each date between them is a marker in the chain;
 *  - its afterglow (the morning-after texts, lib/afterglow.ts, stored on the episode) comes right after it;
 *  - their texts between dates (lib/between-dates.ts, couple_texts) follow in the order they were sent.
 *
 * Merged when it's read, never copied: a date that's hidden, made private or removed takes its afterglow with it.
 * Owners only, like both sources, and only the dates that owner may see (lib/relationships.ts `visibleTo`). The texts
 * between dates are written from the public record, so every owner of either character reads them. The next day's
 * texts pick up from this same chain, from its public layer (`PUBLIC_VIEWER`).
 */
import type { AfterglowLine } from "./afterglow";
import type { Db } from "./db";
import { pairKey, timelineLabel, visibleTo, type End, type Viewer } from "./relationships";
import { REPORT_HIDE_THRESHOLD, type Ending } from "./rules";
import { CHAIN_PAGE, type ChainItem, type ChainPage } from "./text-chain-shared";
import { venueName, type VenueId } from "./venues";

export { CHAIN_PAGE, isText, type ChainDate, type ChainItem, type ChainPage, type ChainText } from "./text-chain-shared";

/** Anyone who isn't an owner: the public layer (aired, public, unhidden dates). What the texts between dates write from. */
export const PUBLIC_VIEWER: Viewer = { userId: null, owner: false };

const iso = (d: string | Date) => new Date(d).toISOString();
/** The chain's sort key (ISO times sort as text): when, the order within that moment, then what it is. */
const chainId = (at: string, order: number, what: string) => `${at}#${String(order).padStart(3, "0")}#${what}`;

type ChainEpisode = {
  id: string;
  created_at: string | Date;
  revealed_at: string | Date | null;
  visibility: string;
  hidden: boolean;
  creator_id: string;
  character_a: string;
  ending: Ending;
  afterglow: AfterglowLine[] | null;
  venue: VenueId | null;
  followup_of: string | null;
};

const CHAIN_EPISODES = `
  select e.id, e.created_at, e.revealed_at, e.visibility, e.creator_id, e.character_a, e.ending, e.afterglow,
         e.setup->>'venue' as venue, e.followup_of,
         (select count(*)::int from reports r where r.episode_id = e.id) >= $3 as hidden
    from episodes e
   where e.status = 'ready' and e.varies_episode_id is null
     and ((e.character_a = $1 and e.character_b = $2) or (e.character_a = $2 and e.character_b = $1))`;

/**
 * The whole chain between two characters, oldest first, with the dates `viewer` may see. It doesn't check who's
 * asking: callers show it to the characters' owners only (the couple page, the texts route, get_relationships).
 */
export async function loadChain(db: Db, x: string, y: string, viewer: Viewer): Promise<ChainItem[]> {
  const [lo, hi] = pairKey(x, y);
  const [eps, texts] = await Promise.all([
    db.query<ChainEpisode>(CHAIN_EPISODES, [lo, hi, REPORT_HIDE_THRESHOLD]),
    db.query<{ who: End; text: string; day: string; seq: number; created_at: string | Date }>(
      `select who, text, to_char(day, 'YYYY-MM-DD') as day, seq, created_at from couple_texts where character_lo = $1 and character_hi = $2`,
      [lo, hi],
    ),
  ]);
  const seen = eps.rows
    .filter((e) => visibleTo({ public: e.revealed_at !== null && e.visibility === "public" && !e.hidden, private: e.visibility === "private", creator: e.creator_id }, viewer))
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
  for (const t of texts.rows) {
    const at = iso(t.created_at);
    items.push({ kind: "text", id: chainId(at, t.seq, `t:${t.day}`), at, day: t.day, who: t.who, text: t.text, source: "daily", episode_id: null });
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
