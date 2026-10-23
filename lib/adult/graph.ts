import type { Db } from "../db";
import { FRAME_SHOWN } from "./media";
import { textModelHistory, writtenBy, type WrittenBy } from "./model-log";
import type { ReelShot } from "./reels";
import type { SceneLine } from "./scenes";

/**
 * Everything After Dark has made, as a graph for /admin/after-dark/graph (David, 2026-10-22: "the full graph of
 * character after hours content, one page"): characters are nodes, and a pair with anything between them (a scene,
 * saved nights, videos, pictures, steps) is an edge. Every owner's, read as a moderator; signed-in admins only.
 */
export type GraphNode = { id: string; name: string; portrait: string | null; lines: number; pairs: number };
export type GraphEdge = {
  key: string;
  a: string;
  b: string;
  lines: number;
  nights: number;
  videos: number;
  shots: number;
  pictures: number;
  steps: number;
  last: string | null;
};
export type AfterDarkGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

/** One unordered pair's key: the two ids sorted, so a scene stored either way round is the same edge. */
export const pairKey = (x: string, y: string): string => (x < y ? `${x}~${y}` : `${y}~${x}`);
export const splitPair = (key: string): [string, string] | null => {
  const [a, b, rest] = key.split("~");
  return a && b && rest === undefined ? [a, b] : null;
};

type Counted = { a: string; b: string; n: number; last: string | Date | null };

export async function afterDarkGraph(db: Db): Promise<AfterDarkGraph> {
  const q = (sql: string) => db.query<Counted>(sql).then((r) => r.rows);
  const [scenes, nights, reels, shots, pictures, steps] = await Promise.all([
    q(`select character_a as a, character_b as b, jsonb_array_length(lines) as n, updated_at as last from adult_scenes`),
    q(`select character_a as a, character_b as b, count(*)::int as n, max(created_at) as last from adult_nights group by 1, 2`),
    q(`select character_a as a, character_b as b, count(*)::int as n, max(created_at) as last from adult_reels group by 1, 2`),
    q(`select r.character_a as a, r.character_b as b, count(*)::int as n, null as last
         from adult_reels r, jsonb_array_elements(r.shots) s where s->>'status' = 'ready' group by 1, 2`),
    q(`select character_id as a, character_b as b, count(*)::int as n, max(created_at) as last from adult_images
        where character_id is not null and character_b is not null and kind not in ('video', 'audio') and status = 'ready' group by 1, 2`),
    q(`select character_a as a, character_b as b, count(*)::int as n, max(created_at) as last from adult_steps group by 1, 2`),
  ]);
  const edges = new Map<string, GraphEdge>();
  const add = (rows: Counted[], field: Exclude<keyof GraphEdge, "key" | "a" | "b" | "last">) => {
    for (const r of rows) {
      const key = pairKey(r.a, r.b);
      const [a, b] = splitPair(key)!;
      const e = edges.get(key) ?? { key, a, b, lines: 0, nights: 0, videos: 0, shots: 0, pictures: 0, steps: 0, last: null };
      e[field] += Number(r.n) || 0;
      const at = r.last ? new Date(r.last).toISOString() : null;
      if (at && (!e.last || at > e.last)) e.last = at;
      edges.set(key, e);
    }
  };
  add(scenes, "lines");
  add(nights, "nights");
  add(reels, "videos");
  add(shots, "shots");
  add(pictures, "pictures");
  add(steps, "steps");

  // Nodes: everyone in an edge, plus anyone switched into After Dark who has nothing yet.
  const ids = new Set([...edges.values()].flatMap((e) => [e.a, e.b]));
  for (const r of (await db.query<{ id: string }>(`select character_id as id from adult_characters`)).rows) ids.add(r.id);
  const list = [...ids];
  const named = list.length
    ? (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [list])).rows
    : [];
  const portraits = list.length
    ? (
        await db.query<{ id: string; media: string }>(
          `select distinct on (character_id) character_id as id, id as media from adult_images
            where character_id = any($1) and kind = 'baseline' and status = 'ready' order by character_id, created_at desc`,
          [list],
        )
      ).rows
    : [];
  const nameOf = new Map(named.map((r) => [r.id, r.name]));
  const portraitOf = new Map(portraits.map((r) => [r.id, r.media]));
  const all = [...edges.values()].sort((x, y) => (y.last ?? "").localeCompare(x.last ?? ""));
  const nodes = list
    .map((id) => {
      const mine = all.filter((e) => e.a === id || e.b === id);
      return { id, name: nameOf.get(id) ?? id, portrait: portraitOf.get(id) ?? null, lines: mine.reduce((n, e) => n + e.lines, 0), pairs: mine.length };
    })
    .sort((x, y) => y.lines - x.lines || x.name.localeCompare(y.name));
  return { nodes, edges: all };
}

/** A saved night (one chapter), and which text model wrote it (lib/adult/model-log.ts). */
export type PairNight = { id: string; chapter: number | null; place: string | null; stage: number; lines: SceneLine[]; created_at: string; written_by: WrittenBy };
/** A video, and who made it: its provider ("venice", "replicate", "mixed") and whether any of it was the fallback. */
export type PairReel = { id: string; status: string; shots: ReelShot[]; created_at: string; provider: string | null; fell_back: boolean };
export type PairPicture = { id: string; kind: string; mime: string; prompt: string; created_at: string; provider: string | null; fell_back: boolean };
export type PairContent = {
  a: { id: string; name: string };
  b: { id: string; name: string };
  scene: { chapter: number; lines: SceneLine[]; updated_at: string; written_by: WrittenBy } | null;
  nights: PairNight[];
  reels: PairReel[];
  pictures: PairPicture[];
  steps: { status: string; n: number }[];
};

/** All of one pair's After Dark content, either way round, newest first. Null when neither is a character. */
export async function pairContent(db: Db, x: string, y: string): Promise<PairContent | null> {
  const names = (await db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1)`, [[x, y]])).rows;
  const nameOf = (id: string) => names.find((r) => r.id === id)?.name ?? id;
  if (!names.length) return null;
  const either = `((character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1))`;
  const iso = (d: string | Date) => new Date(d).toISOString();
  // A row stored the other way round has its a and b swapped back, so "a" always means x.
  const flip = <T extends { who: "a" | "b" }>(lines: T[], swapped: boolean) => (swapped ? lines.map((l) => ({ ...l, who: l.who === "a" ? "b" : "a" })) : lines) as T[];
  const [scenes, nights, reels, pictures, steps, models, history] = await Promise.all([
    db.query<{ id: string; character_a: string; chapter: number; lines: SceneLine[]; updated_at: string }>(
      `select id, character_a, chapter, lines, updated_at from adult_scenes where ${either} order by updated_at desc`,
      [x, y],
    ),
    db.query<{ id: string; character_a: string; chapter: number | null; place: string | null; stage: number; lines: SceneLine[]; created_at: string }>(
      `select id, character_a, chapter, place, stage, lines, created_at from adult_nights where ${either} order by created_at desc`,
      [x, y],
    ),
    db.query<{ id: string; character_a: string; status: string; shots: ReelShot[]; created_at: string; provider: string | null; fell_back: boolean }>(
      `select id, character_a, status, shots, created_at, provider, coalesce(fell_back, false) as fell_back from adult_reels where ${either} order by created_at desc`,
      [x, y],
    ),
    db.query<{ id: string; kind: string; mime: string; prompt: string; created_at: string; provider: string | null; fell_back: boolean }>(
      // A video's keyframe only once its shot has passed (FRAME_SHOWN): it had the age question alone until then.
      `select id, kind, mime, prompt, created_at, provider, coalesce(fell_back, false) as fell_back from adult_images
        where status = 'ready' and kind not in ('video', 'audio') and ${FRAME_SHOWN} and ((character_id = $1 and character_b = $2) or (character_id = $2 and character_b = $1)
              or (kind = 'baseline' and character_id = any(array[$1, $2]::text[]))) order by created_at desc`,
      [x, y],
    ),
    db.query<{ status: string; n: number }>(`select status, count(*)::int as n from adult_steps where ${either} group by 1 order by 2 desc`, [x, y]),
    // Which model wrote each chapter: the writing steps' models, by the night they were filed with (null: still running).
    db.query<{ scene_id: string | null; night_id: string | null; text_model: string | null; text_provider: string | null }>(
      `select scene_id, night_id, text_model, text_provider from adult_steps where ${either} and kind = 'write' and status = 'ok' order by created_at`,
      [x, y],
    ),
    textModelHistory(db),
  ]);
  const scene = scenes.rows[0];
  const stepsOfNight = (id: string) => models.rows.filter((s) => s.night_id === id);
  return {
    a: { id: x, name: nameOf(x) },
    b: { id: y, name: nameOf(y) },
    scene: scene
      ? {
          chapter: scene.chapter,
          lines: flip(scene.lines, scene.character_a !== x),
          updated_at: iso(scene.updated_at),
          written_by: writtenBy(models.rows.filter((s) => s.night_id === null && s.scene_id === scene.id), iso(scene.updated_at), history),
        }
      : null,
    nights: nights.rows.map((n) => ({
      id: n.id, chapter: n.chapter, place: n.place, stage: n.stage, lines: flip(n.lines, n.character_a !== x), created_at: iso(n.created_at),
      written_by: writtenBy(stepsOfNight(n.id), iso(n.created_at), history),
    })),
    reels: reels.rows.map((r) => ({ id: r.id, status: r.status, shots: flip(r.shots, r.character_a !== x), created_at: iso(r.created_at), provider: r.provider, fell_back: r.fell_back })),
    pictures: pictures.rows.map((p) => ({ ...p, created_at: iso(p.created_at) })),
    steps: steps.rows.map((s) => ({ status: s.status, n: Number(s.n) })),
  };
}

/** Where each node sits: evenly round a circle, the busiest at the top (positions in a 0–100 box). */
export function layout(nodes: GraphNode[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, nodes.length);
    out.set(n.id, nodes.length === 1 ? { x: 50, y: 50 } : { x: 50 + 38 * Math.cos(t), y: 50 + 38 * Math.sin(t) });
  });
  return out;
}
