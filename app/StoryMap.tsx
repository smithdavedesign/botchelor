import Link from "next/link";
import { sized } from "@/app/Avatar";
import CharacterName from "@/app/CharacterName";
import { avatarPalette, initials } from "@/lib/avatar";
import { characterPortrait } from "@/lib/portraits";
import { mapView, TIE_KIND_LABELS, TIE_KINDS, type StoryMap as StoryMapData, type StoryPerson, type StoryTie, type TieKind } from "@/lib/story-map";

/**
 * This week's story map (lib/story-map.ts), drawn on the server: an SVG with fixed places (the lead in the middle, the
 * cast round them, anyone else a tie brings on the outside), one line a pair in its tie's colour and dash, and before
 * it in the page the same ties as a plain list. The list is the map for a screen reader and comes first on a phone; on
 * a wide screen the drawing sits above it (app/ux/show.css .story-map). No client JavaScript, no physics: the same map
 * is the same picture on every load. Plain and synchronous (the data comes in as props), so any page can render it.
 */

const W = 720;
const H = 540;
const CX = W / 2;
const CY = H / 2 - 6;
const R_LEAD = 42;
const R_CAST = 33;
const R_OTHER = 23;
/** How many ties the list shows before the rest fold. */
export const LIST_FIRST = 8;

export type Placed = { person: StoryPerson; x: number; y: number; r: number };

const at = (deg: number, rx: number, ry: number): { x: number; y: number } => {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.round(CX + rx * Math.cos(rad)), y: Math.round(CY + ry * Math.sin(rad)) };
};
const turn = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Where everyone stands. Pure and deterministic: the lead in the middle, the rest of the cast evenly on a ring, and
 * each outsider in the free outer place nearest the cast member their strongest tie is with.
 */
export function layout(people: readonly StoryPerson[], ties: readonly Pick<StoryTie, "a" | "b">[]): Placed[] {
  const lead = people.find((p) => p.lead) ?? null;
  const cast = people.filter((p) => p.cast && !p.lead);
  const others = people.filter((p) => !p.cast);
  const out: Placed[] = [];
  const angle = new Map<string, number>();
  if (lead) out.push({ person: lead, x: CX, y: CY, r: R_LEAD });
  // An even ring starts off the vertical, so the top and bottom stay free for the outer ring's names.
  const start = -90 + (cast.length % 2 === 0 && cast.length > 0 ? 180 / cast.length : 0);
  // A big cast (a Botchelor season's suitors, a seeded demo's fifteen) takes the outer ring itself, with smaller
  // faces: lib/story-map.ts mapView draws nobody else once the cast alone fills the map.
  const big = cast.length > 8;
  const [rx, ry] = big ? [300, 205] : lead ? [200, 150] : others.length ? [165, 118] : [215, 150];
  cast.forEach((p, i) => {
    const deg = start + (360 / Math.max(cast.length, 1)) * i;
    angle.set(p.id, deg);
    out.push({ person: p, ...(cast.length === 1 && !lead ? { x: CX, y: CY } : at(deg, rx, ry)), r: big ? R_OTHER + 3 : R_CAST });
  });
  const slots = Math.max(others.length, 8);
  const free = Array.from({ length: slots }, (_, i) => -90 + 180 / slots + (360 / slots) * i);
  const ringAngles = [...angle.values()];
  const wanted = (p: StoryPerson): number | null => {
    const tie = ties.find((t) => (t.a === p.id && angle.has(t.b)) || (t.b === p.id && angle.has(t.a)));
    return tie ? angle.get(tie.a === p.id ? tie.b : tie.a)! : null;
  };
  const take = (score: (deg: number) => number): number => {
    let best = 0;
    for (let s = 1; s < free.length; s++) if (score(free[s]) < score(free[best])) best = s;
    return free.splice(best, 1)[0];
  };
  const spot = new Map<string, number>();
  // Whoever is tied to someone on the ring stands just outside them; the rest (tied to the lead in the middle) take
  // the places between the ring's faces, so their lines to the middle don't run through one.
  for (const p of others) {
    const want = wanted(p);
    if (want !== null) spot.set(p.id, take((deg) => turn(deg, want)));
  }
  for (const p of others) if (!spot.has(p.id)) spot.set(p.id, take((deg) => -Math.min(360, ...ringAngles.map((a) => turn(deg, a)))));
  for (const p of others) out.push({ person: p, ...at(spot.get(p.id)!, 312, 218), r: R_OTHER });
  return out;
}

const safe = (s: string): string => s.replace(/[^a-zA-Z0-9]/g, "");

/** One face in an SVG: the portrait in a circle, or the hue tile with initials; a ring for the lead. */
export function Face({ p, x, y, r, scope, named = true }: { p: StoryPerson; x: number; y: number; r: number; scope: string; named?: boolean }) {
  const id = `${scope}-${safe(p.id)}`;
  const pal = avatarPalette(p.id, p.hue);
  const src = characterPortrait(p.id) ?? sized(p.portrait, r * 2);
  return (
    <a href={`/characters/${p.id}`} className={`story-face${p.lead ? " is-lead" : ""}${p.cast ? " is-cast" : ""}`} tabIndex={-1}>
      <title>{p.lead ? `${p.full_name}, the lead` : p.full_name}</title>
      <defs>
        <clipPath id={`${id}-clip`}>
          <circle cx={x} cy={y} r={r} />
        </clipPath>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={pal.from} />
          <stop offset="100%" stopColor={pal.to} />
        </linearGradient>
      </defs>
      <circle cx={x} cy={y} r={r} fill={`url(#${id}-fill)`} />
      {src ? (
        <image href={src} x={x - r} y={y - r} width={r * 2} height={r * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id}-clip)`} />
      ) : (
        <text x={x} y={y} className="story-face-initials" textAnchor="middle" dominantBaseline="central" fill={pal.ink} fontSize={Math.round(r * 0.8)}>
          {initials(p.full_name)}
        </text>
      )}
      <circle cx={x} cy={y} r={r + (p.lead ? 4 : 1.5)} className="story-face-ring" />
      {named && (
        <text x={x} y={y + r + 19} className="story-face-name" textAnchor="middle">
          {p.name}
        </text>
      )}
    </a>
  );
}

type Spot = { x: number; y: number; r: number };
/** A line's two ends, clipped to the faces' edges. */
const ends = (from: Spot, to: Spot) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x1: from.x + (dx / len) * (from.r + 4), y1: from.y + (dy / len) * (from.r + 4), x2: to.x - (dx / len) * (to.r + 4), y2: to.y - (dy / len) * (to.r + 4), len };
};

/** A tie's line between two placed faces, a link to what made it. */
export function TieLine({ tie, from, to }: { tie: StoryTie; from: Spot; to: Spot }) {
  const { x1, y1, x2, y2 } = ends(from, to);
  return (
    <a href={tie.href} className={`story-tie story-tie-${tie.kind}`} tabIndex={-1}>
      <title>{`${tie.text}, ${tie.when}`}</title>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="story-tie-hit" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="story-tie-line" />
    </a>
  );
}

/**
 * A tie's words on its line (not for "talked about"). Drawn after the faces, so a short line's words lie over the
 * faces' edges instead of under them; a long line carries them a third of the way along, so two lines that cross in
 * the middle keep their words apart.
 */
export function TieLabel({ tie, from, to }: { tie: StoryTie; from: Spot; to: Spot }) {
  if (tie.kind === "talked") return null;
  const { x1, y1, x2, y2, len } = ends(from, to);
  // Two neighbours on a crowded ring: no room for words between them (the list and the key say it).
  if (len < 110) return null;
  const t = len < 220 ? 0.5 : 0.32;
  return (
    <text x={Math.round(x1 + (x2 - x1) * t)} y={Math.round(y1 + (y2 - y1) * t)} className="story-tie-label" textAnchor="middle" dominantBaseline="central">
      {tie.label}
    </text>
  );
}

/** The sample line before a tie in the list and the key: the same colour and dash as on the map. */
export function TieSwatch({ kind }: { kind: TieKind }) {
  return (
    <svg className={`story-swatch story-tie-${kind}`} viewBox="0 0 28 8" width="28" height="8" aria-hidden="true" focusable="false">
      <line x1="1" y1="4" x2="27" y2="4" className="story-tie-line" />
    </svg>
  );
}

/** The ties as sentences, each a link to what made it: "Nell and Sable: rivals for Juniper, since Sunday". */
export function TieList({ ties, className = "" }: { ties: readonly StoryTie[]; className?: string }) {
  return (
    <ul className={`story-ties ${className}`.trim()}>
      {ties.map((t) => (
        <li key={t.id}>
          <TieSwatch kind={t.kind} />
          <span>
            <Link href={t.href} data-track="story-map" data-track-where={t.kind}>
              {t.text}
            </Link>
            <span className="muted">, {t.when}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

type Props = {
  map: StoryMapData;
  /** The section's heading (an h2), or none when the page has its own above it. */
  title?: string | null;
  /** A line under the heading. */
  lede?: string | null;
  /** Where "everyone, all time" lives, linked from the foot; null on that page itself. */
  allTimeHref?: string | null;
  id?: string;
};

export default function StoryMap({ map, title = "This week in the house", lede = null, allTimeHref = "/graph", id = "story-map" }: Props) {
  const view = mapView(map);
  const cast = map.people.filter((p) => p.cast);
  const placed = layout(view.people, view.lines);
  const where = new Map(placed.map((p) => [p.person.id, p]));
  const kinds = TIE_KINDS.filter((k) => view.lines.some((t) => t.kind === k));
  const headId = `${id}-head`;
  return (
    <section id={id} className="story-map" aria-labelledby={title ? headId : undefined} aria-label={title ? undefined : "This week's story map"} data-track-area="story-map">
      {title && (
        <h2 id={headId} className="section">
          {title}
        </h2>
      )}
      {lede && <p className="muted small story-map-lede">{lede}</p>}
      {cast.length > 0 && (
        <ul className="chips story-cast" aria-label="This season's cast">
          {cast.map((p) => (
            <li key={p.id} className="chip">
              <CharacterName character={{ id: p.id, name: p.full_name, hue: p.hue, house: p.house, portrait: p.portrait }} label={p.name} size={22} />
              {p.lead && map.lead && <span className="muted small"> · {map.lead.billing}</span>}
            </li>
          ))}
        </ul>
      )}
      {view.ties.length === 0 ? (
        <p className="story-map-empty muted">
          A quiet week so far: nobody on the cast has a date booked, a rival or anything to settle. The map fills in as dates air and the house talks.{" "}
          <Link href="/watch">Watch a date →</Link>
        </p>
      ) : (
        <div className="story-map-body">
          {/* The list first in the page: what a screen reader and a phone get. The drawing repeats it (aria-hidden). */}
          <div className="story-map-list">
            <TieList ties={view.ties.slice(0, LIST_FIRST)} />
            {/* The rest fold: seventeen sentences before the drawing was a long way down a phone. */}
            {view.ties.length > LIST_FIRST && (
              <details className="ux-fold story-map-rest">
                <summary>
                  {view.ties.length - LIST_FIRST} more this week
                </summary>
                <TieList ties={view.ties.slice(LIST_FIRST)} />
              </details>
            )}
            {view.left_out > 0 && (
              <p className="muted small story-map-more">
                And {view.left_out} more {view.left_out === 1 ? "tie" : "ties"} with people outside the cast this week.
              </p>
            )}
          </div>
          <figure className="story-map-figure card">
            <svg className="story-map-svg" viewBox={`0 0 ${W} ${H}`} role="presentation" aria-hidden="true" focusable="false">
              {view.lines.map((t) => {
                const a = where.get(t.a);
                const b = where.get(t.b);
                return a && b ? <TieLine key={t.id} tie={t} from={a} to={b} /> : null;
              })}
              {placed.map((p) => (
                <Face key={p.person.id} p={p.person} x={p.x} y={p.y} r={p.r} scope={id} />
              ))}
              {/* Words only between two of the cast: a line to someone outside is told by its colour, the key and the list. */}
              {view.lines.map((t) => {
                const a = where.get(t.a);
                const b = where.get(t.b);
                return a && b && a.person.cast && b.person.cast ? <TieLabel key={t.id} tie={t} from={a} to={b} /> : null;
              })}
            </svg>
            {kinds.length > 0 && (
              <figcaption className="story-key">
                {kinds.map((k) => (
                  <span key={k} className="story-key-item">
                    <TieSwatch kind={k} />
                    {TIE_KIND_LABELS[k]}
                  </span>
                ))}
              </figcaption>
            )}
          </figure>
        </div>
      )}
      <p className="muted small story-map-foot">
        Only what has aired or been said in the house in the last seven days, between public characters. The map shows the story; it never changes how a date ends.
        {allTimeHref && (
          <>
            {" "}
            <Link href={allTimeHref}>Everyone, all time →</Link>
          </>
        )}
      </p>
    </section>
  );
}
