/**
 * "X's world" as a picture (docs/PRDs/social-network.md section 9, Phase 3; app/graph/world/[id]/page.tsx draws it as
 * SVG on the server). Pure and browser-safe.
 *
 * - The character sits in the middle, and everyone in their world sits on Dunbar's rings around them (the inner circle,
 *   close, friends, acquaintances: lib/social/algorithms.ts rings, from the active ties and the places they share),
 *   grouped round each ring by what their closest tie is (family together, then love, friends, work, places).
 * - Whoever they're at odds with (any tie that feels bad) sits at the foot of their ring, on a red arc, so the trouble
 *   reads at a glance.
 * - The lines between them and the centre are the views' (lib/social/lenses.ts, Everything's groups): one a group, in
 *   its colour and dash, red where it feels bad.
 * - Off-screen people are small grey dots with their names. A pair touching a private character is a grey dot on the
 *   outer ring with a grey dash, as on the sky, and says nothing more.
 * - The places they belong to are labels round the outer edge, each near the people who share it.
 */
import { foldTies, type LensLine } from "./lenses";
import { midSentence } from "./place-name";
import { RINGS, type EgoNetwork, type Layer, type PersonView, type PlaceRole, type PlaceView, type Ring, type SharedPlace, type SocialNode, type TieView } from "./types";

/** The picture's side, in SVG units: the page scales it to the screen. */
export const WORLD_SIZE = 640;
const MID = WORLD_SIZE / 2;
/** Each ring's radius, and a face's on it: the closer the ring, the bigger the face. */
export const RING_RADIUS: Record<Ring, number> = { inner: 96, close: 156, friends: 212, acquaintances: 262 };
export const FACE_RADIUS: Record<Ring, number> = { inner: 22, close: 16, friends: 11, acquaintances: 7 };
export const CENTRE_RADIUS = 40;
export const PERSON_RADIUS = 5;
/** Where the places' labels run: round the outside of the outer ring. */
export const EDGE_RADIUS = 292;
/** The most place labels round the edge (the page lists them all). */
export const EDGE_PLACES = 8;

/** Someone in the world, placed: a character (linked to their own world) or one of the centre's off-screen people. */
export type WorldMember = {
  id: string;
  name: string;
  person: boolean;
  private: boolean;
  hue: number | null;
  portrait: string | null;
  ring: Ring;
  /** Degrees, clockwise from the right (SVG's way round): -90 is the top, 90 the foot. */
  angle: number;
  x: number;
  y: number;
  r: number;
  /** Their lines with the centre: one a group, strongest first. None for a masked pair. */
  lines: LensLine[];
  /** Some tie between them feels bad: they sit on the red arc. */
  odds: boolean;
  masked: boolean;
  /** Their ties with the centre (strongest first) and the places they share with them: the page's list. */
  ties: TieView[];
  shared: SharedPlace[];
};

/** A red arc under the people someone's at odds with, on one ring. Degrees, `from` < `to`. */
export type WorldArc = { ring: Ring; r: number; from: number; to: number };

/** A place round the edge: what the centre does there, and the angle its label is centred on. */
export type WorldPlace = { key: string; place: PlaceView; role: PlaceRole; words: string; angle: number; span: number; with: string[] };

export type WorldPicture = {
  size: number;
  centre: SocialNode;
  rings: { ring: Ring; r: number; count: number }[];
  members: WorldMember[];
  arcs: WorldArc[];
  places: WorldPlace[];
  /** Characters whose every tie with the centre is over (exes who cleared the air): the list's "Before". */
  before: WorldMember[];
  /** Past the 150 the rings hold. */
  beyond: number;
};

/** What the centre does at a place, in words. */
export const ROLE_WORDS: Record<PlaceRole, (place: string) => string> = {
  lives: (p) => `Lives in ${midSentence(p)}`,
  works: (p) => `Works at ${midSentence(p)}`,
  regular: (p) => `Regular at ${midSentence(p)}`,
  studied: (p) => `Studied at ${midSentence(p)}`,
  from: (p) => `From ${midSentence(p)}`,
  visited: (p) => `Been to ${midSentence(p)}`,
};

/** Which groups sit together round a ring, in this order; the ones at odds come last, at the foot. */
const LAYER_ORDER: readonly Layer[] = ["kin", "romance", "friendship", "work", "place", "acquaintance", "communication", "conflict"];

const rad = (deg: number): number => (deg * Math.PI) / 180;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const at = (r: number, deg: number): { x: number; y: number } => ({ x: round1(MID + r * Math.cos(rad(deg))), y: round1(MID + r * Math.sin(rad(deg))) });
/** An angle in [-180, 180). */
export const norm = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * Angles for one ring's members, in their order, the last `odds` of them centred on the foot (90°) and the rest going
 * on round from there; with nobody at odds, starting at the top.
 */
export function ringAngles(n: number, odds: number): number[] {
  if (n <= 0) return [];
  const step = 360 / n;
  const k = Math.min(odds, n);
  const out: number[] = [];
  if (k === 0) for (let i = 0; i < n; i++) out.push(norm(-90 + i * step));
  else {
    // The rest first (they come first in the order), then the odds.
    for (let i = 0; i < n - k; i++) out.push(norm(90 + ((k - 1) / 2 + 1 + i) * step));
    for (let j = 0; j < k; j++) out.push(norm(90 + (j - (k - 1) / 2) * step));
  }
  return out;
}

/** The red arc under `odds` people at the foot of a ring of `n`: their spread and a little either side; all of it when they all are. */
export function oddsArc(n: number, odds: number): { from: number; to: number } | null {
  if (n <= 0 || odds <= 0) return null;
  const step = 360 / n;
  const k = Math.min(odds, n);
  const half = ((k - 1) / 2) * step + Math.min(step * 0.42, 12);
  // Everyone on the ring at odds (more than one of them): the arc goes all the way round.
  if (half >= 180 || (k === n && n > 1)) return { from: -90, to: 270 };
  return { from: 90 - half, to: 90 + half };
}

/** A circular mean of angles (degrees), or null for none. */
function meanAngle(angles: readonly number[]): number | null {
  if (!angles.length) return null;
  const x = angles.reduce((s, a) => s + Math.cos(rad(a)), 0);
  const y = angles.reduce((s, a) => s + Math.sin(rad(a)), 0);
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return angles[0];
  return norm((Math.atan2(y, x) * 180) / Math.PI);
}

/**
 * The places' type in picture units at its biggest: a phone's (app/globals.css --world-type-place), where the picture
 * is drawn at about 0.56, so 22 comes out at 12px. A desktop's is smaller, so a label laid out for a phone fits there too.
 */
export const LABEL_TYPE = 22;
/** About how many degrees a label takes round the edge: about half an em a character, and a little either side. */
export const labelSpan = (text: string): number => ((text.length * LABEL_TYPE * 0.53 + 12) / EDGE_RADIUS) * (180 / Math.PI);

/**
 * Spreads labels round the edge so none overlaps: each wants an angle (null: anywhere), takes `span` degrees, and keeps
 * its order round the circle. Those without an angle go in the widest gaps. Labels that can't fit are left out (the
 * longest-standing first: the input's order is its priority).
 */
export function spreadLabels(want: readonly { angle: number | null; span: number }[], gap = 3): (number | null)[] {
  const out: (number | null)[] = want.map(() => null);
  let total = 0;
  const kept: number[] = [];
  for (let i = 0; i < want.length; i++) {
    if (total + want[i].span + gap > 360) continue;
    total += want[i].span + gap;
    kept.push(i);
  }
  if (!kept.length) return out;
  // Those with no angle of their own go evenly into the room left, starting at the top.
  const free = kept.filter((i) => want[i].angle === null);
  const placed = kept.filter((i) => want[i].angle !== null);
  const angle = new Map<number, number>(placed.map((i) => [i, norm(want[i].angle!)]));
  free.forEach((i, n) => angle.set(i, norm(-90 + (n + 0.5) * (360 / Math.max(1, free.length)) - 180 / Math.max(1, free.length))));
  // Round the circle in order, pushing each on past the one before it, then once more across the join.
  const order = [...kept].sort((x, y) => angle.get(x)! - angle.get(y)!);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 1; j < order.length; j++) {
      const prev = order[j - 1];
      const cur = order[j];
      const min = angle.get(prev)! + (want[prev].span + want[cur].span) / 2 + gap;
      if (angle.get(cur)! < min) angle.set(cur, min);
    }
    const first = order[0];
    const last = order[order.length - 1];
    const over = angle.get(last)! + (want[last].span + want[first].span) / 2 + gap - (angle.get(first)! + 360);
    if (over <= 0) break;
    // Pull them all back by the overlap, a share each, and go again.
    order.forEach((i, j) => angle.set(i, angle.get(i)! - (over * j) / Math.max(1, order.length - 1)));
  }
  for (const i of kept) out[i] = norm(angle.get(i)!);
  return out;
}

/** "X's world" placed for drawing, from its ego network (lib/social/read.ts egoNetwork). */
export function worldPicture(w: EgoNetwork): WorldPicture {
  const id = w.centre.id;
  const nodes = new Map(w.nodes.map((n) => [n.id, n]));
  const people = new Map<string, PersonView>(w.people.map((p) => [p.id, p]));
  const otherOf = (t: TieView): string | null => t.to_person ?? (t.from === id ? t.to : t.from);
  const tiesOf = new Map<string, TieView[]>();
  for (const t of w.ties) {
    const o = otherOf(t);
    if (o) tiesOf.set(o, [...(tiesOf.get(o) ?? []), t]);
  }
  const sharedOf = new Map<string, SharedPlace[]>();
  for (const s of w.shared) {
    const o = s.a === id ? s.b : s.a;
    sharedOf.set(o, [...(sharedOf.get(o) ?? []), s]);
  }
  // Each one's lines with the centre, as Everything draws them (a person's too: the person stands in as `to`).
  const linesOf = new Map<string, LensLine[]>();
  for (const pair of foldTies(
    "all",
    w.ties.map((t) => ({ ...t, to: t.to ?? t.to_person ?? "" })),
  ))
    linesOf.set(pair.a === id ? pair.b : pair.a, pair.lines);

  const active = (o: string) => (tiesOf.get(o) ?? []).filter((t) => t.status === "active");
  const odds = (o: string) => active(o).some((t) => t.valence < 0);
  // Where they sit round their ring: by their strongest active tie's layer, or a shared place's.
  const layerRank = (o: string): number => {
    const t = active(o)[0];
    const layer = t?.layer ?? sharedOf.get(o)?.[0]?.layer ?? "acquaintance";
    return LAYER_ORDER.indexOf(layer);
  };

  const member = (o: string, ring: Ring, masked: boolean): Omit<WorldMember, "angle" | "x" | "y"> | null => {
    const person = people.get(o);
    const node = nodes.get(o);
    if (!person && !node) return null;
    return {
      id: o,
      name: person?.name ?? node!.name,
      person: Boolean(person),
      private: Boolean(node?.private),
      hue: node?.hue ?? null,
      portrait: node && !node.private ? node.portrait : null,
      ring,
      r: person ? PERSON_RADIUS : masked ? FACE_RADIUS.acquaintances : FACE_RADIUS[ring],
      lines: masked ? [] : (linesOf.get(o) ?? []),
      odds: !masked && odds(o),
      masked,
      ties: tiesOf.get(o) ?? [],
      shared: sharedOf.get(o) ?? [],
    };
  };

  const inRings = new Set<string>(RINGS.flatMap((r) => w.rings[r]));
  // A masked pair's other end (or every other end, around a private centre) goes on the outer ring.
  const maskedOthers = w.masked.map((m) => (m.a === id ? m.b : m.a)).filter((o, i, all) => !inRings.has(o) && all.indexOf(o) === i);

  const members: WorldMember[] = [];
  const arcs: WorldArc[] = [];
  const rings: WorldPicture["rings"] = [];
  for (const ring of RINGS) {
    const list = w.rings[ring].flatMap((o) => member(o, ring, false) ?? []);
    if (ring === "acquaintances") list.push(...maskedOthers.flatMap((o) => member(o, ring, true) ?? []));
    // Grouped by layer, closest first within a group (the rings' own order), the masked next, then those at odds.
    const rank = (m: Omit<WorldMember, "angle" | "x" | "y">) => (m.odds ? 2 : m.masked ? 1 : 0);
    const order = list.map((m, i) => ({ m, i })).sort((x, y) => rank(x.m) - rank(y.m) || (rank(x.m) === 0 ? layerRank(x.m.id) - layerRank(y.m.id) : 0) || x.i - y.i);
    const k = list.filter((m) => m.odds).length;
    const angles = ringAngles(order.length, k);
    order.forEach(({ m }, i) => members.push({ ...m, angle: round1(angles[i]), ...at(RING_RADIUS[ring], angles[i]) }));
    if (list.length) rings.push({ ring, r: RING_RADIUS[ring], count: list.length });
    const arc = oddsArc(order.length, k);
    if (arc) arcs.push({ ring, r: RING_RADIUS[ring], ...arc });
  }

  // The places round the edge: where they belong now, the most shared first, each near those who share it.
  const placeById = new Map(w.places.map((p) => [p.id, p]));
  const angleOf = new Map(members.map((m) => [m.id, m.angle]));
  const current = w.memberships.filter((m) => !m.ended_at && placeById.has(m.place_id));
  const withOf = (placeId: string, role: string) => w.shared.filter((s) => s.place_id === placeId && s.role === role).map((s) => (s.a === id ? s.b : s.a));
  const candidates = current
    .map((m) => {
      const place = placeById.get(m.place_id)!;
      const words = ROLE_WORDS[m.role](place.name);
      const others = withOf(m.place_id, m.role);
      return { key: `${m.place_id}:${m.role}`, place, role: m.role, words, with: others, want: meanAngle(others.flatMap((o) => (angleOf.has(o) ? [angleOf.get(o)!] : []))), span: labelSpan(words) };
    })
    .sort((a, b) => b.with.length - a.with.length || a.words.localeCompare(b.words))
    .slice(0, EDGE_PLACES);
  const spread = spreadLabels(candidates.map((c) => ({ angle: c.want, span: c.span })));
  const places: WorldPlace[] = candidates.flatMap((c, i) => (spread[i] === null ? [] : [{ key: c.key, place: c.place, role: c.role, words: c.words, angle: round1(spread[i]!), span: round1(c.span), with: c.with }]));

  // Everyone whose ties with the centre are all over, for the list.
  const placed = new Set(members.map((m) => m.id));
  const before: WorldMember[] = [];
  for (const [o, ties] of tiesOf) {
    if (placed.has(o) || w.rings.beyond.includes(o) || ties.some((t) => t.status === "active")) continue;
    const m = member(o, "acquaintances", false);
    if (m) before.push({ ...m, odds: false, angle: 0, x: 0, y: 0 });
  }

  return { size: WORLD_SIZE, centre: w.centre, rings, members, arcs, places, before, beyond: w.rings.beyond.length };
}

/** An arc's path round the centre at radius r, from one angle to another (degrees), clockwise. */
export function arcPath(r: number, from: number, to: number): string {
  if (to - from >= 359.9) {
    const a = at(r, -90);
    const b = at(r, 90);
    return `M ${a.x} ${a.y} A ${r} ${r} 0 1 1 ${b.x} ${b.y} A ${r} ${r} 0 1 1 ${a.x} ${a.y}`;
  }
  const a = at(r, from);
  const b = at(r, to);
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

/**
 * A label's path round the edge, centred on `angle` and `span` degrees long, running so its text reads upright: along
 * the top clockwise, along the foot anticlockwise (a little further out, so the letters sit outside the ring too).
 */
export function labelPath(angle: number, span: number): string {
  const a = norm(angle);
  const foot = a > 0 && a < 180;
  const r = foot ? EDGE_RADIUS + 9 : EDGE_RADIUS;
  const from = at(r, foot ? a + span / 2 : a - span / 2);
  const to = at(r, foot ? a - span / 2 : a + span / 2);
  return `M ${from.x} ${from.y} A ${r} ${r} 0 0 ${foot ? 0 : 1} ${to.x} ${to.y}`;
}

/** The point a member's line ends at: the edge of their face, not its middle, and the centre's edge at the other end. */
export function lineEnds(m: Pick<WorldMember, "x" | "y" | "r">): { x1: number; y1: number; x2: number; y2: number } {
  const dx = m.x - MID;
  const dy = m.y - MID;
  const d = Math.hypot(dx, dy) || 1;
  return { x1: round1(MID + (dx / d) * CENTRE_RADIUS), y1: round1(MID + (dy / d) * CENTRE_RADIUS), x2: round1(m.x - (dx / d) * m.r), y2: round1(m.y - (dy / d) * m.r) };
}
