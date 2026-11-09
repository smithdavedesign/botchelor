/**
 * Working with a feed page (lib/game.ts listAiredFeed), where a mixer night is one entry holding its tables. Pure, so
 * Watch, home and their tests share one reading of it.
 */
import type { EpisodeView, FeedItem } from "./game";

type Face = EpisodeView["characters"][number];

/** Every date on the page, in order: a night's tables where the night sits (the featured date's pick, JSON-LD). */
export function feedEpisodes(items: readonly FeedItem[]): EpisodeView[] {
  return items.flatMap((i) => (i.kind === "mixer" ? i.episodes : [i.episode]));
}

/**
 * The page without one date (Watch leads with it, so it isn't listed again). A night that loses it keeps its other
 * tables; left with one, it reads as that date; left with none, it's gone.
 */
export function withoutEpisode(items: readonly FeedItem[], id: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const item of items) {
    if (item.kind === "episode") {
      if (item.episode.id !== id) out.push(item);
      continue;
    }
    const left = item.episodes.filter((e) => e.id !== id);
    if (left.length > 1) out.push(left.length === item.episodes.length ? item : { ...item, episodes: left });
    else if (left.length === 1) out.push({ kind: "episode", episode: left[0] });
  }
  return out;
}

/** Everyone at a night's tables, once each, in the order they first sat down (the night card's row of faces). */
export function nightFaces(episodes: readonly EpisodeView[]): Face[] {
  const seen = new Map<string, Face>();
  for (const e of episodes) for (const c of e.characters) if (!seen.has(c.id)) seen.set(c.id, c);
  return [...seen.values()];
}

/** "Sable × Greta · Sigrid × Barnaby" and how many more: the night card's line, first names only. */
export function nightPairs(episodes: readonly EpisodeView[], shown = 3): { line: string; more: number } {
  const first = (name: string) => name.split(/\s+/)[0] || name;
  const pairs = episodes.map((e) => `${first(e.characters[0].name)} × ${first(e.characters[1].name)}`);
  return { line: pairs.slice(0, shown).join(" · "), more: Math.max(0, pairs.length - shown) };
}
