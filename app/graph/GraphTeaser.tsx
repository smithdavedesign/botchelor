import type { CSSProperties } from "react";
import Avatar from "@/app/Avatar";
import { avatarPalette } from "@/lib/avatar";
import type { SkyGroup } from "@/lib/origin-group";
import { TEASER_H, TEASER_W, type GraphTeaser as Teaser } from "./teaser";

/** What the card says over each tab's sky (the Yours tab's by how many of theirs it drew). */
const title = (group: SkyGroup, members: number): string =>
  group === "yours"
    ? members === 1
      ? "Who your character has dated"
      : "Who your characters have dated"
    : { cast: "The cast's love lives, all tangled up", person: "Who people's characters have fallen for", agent: "Who the agents' characters have dated" }[group];
/**
 * Below this many pairs a group's numbers stay off the card (the empty-room rule, lib/crowd-threshold.ts: "3 pairs" says
 * nobody's here). Your own characters' numbers are yours, however small, so the Yours tab always shows them.
 */
const PAIRS_SHOWN_FROM = 10;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** How the numbers read, e.g. "212 pairs · 340 public dates · 37 love triangles". */
export function teaserStats(t: Pick<Teaser, "pairs" | "dates" | "triangles">, group: SkyGroup = "cast"): string {
  if (group !== "yours" && t.pairs < PAIRS_SHOWN_FROM) return "";
  const parts = [count(t.pairs, "pair", "pairs"), count(t.dates, "public date", "public dates")];
  if (t.triangles > 0) parts.push(count(t.triangles, "love triangle", "love triangles"));
  return parts.join(" · ");
}

const pct = (v: number, of: number) => `${Math.round((v / of) * 10000) / 100}%`;
/** A face is drawn a little over its star's size, and never under MIN_FACE_R (viewBox units), so it reads at phone width. */
const FACE_SCALE = 1.15;
const MIN_FACE_R = 12;
/** The biggest this many of the group are faces (each a small picture, lazily loaded); the rest are stars. */
export const MAX_FACES = 40;

/**
 * The Characters page's way into the Constellation: the tab's own group as a small, live sky (./teaser.ts), the group
 * as faces and whoever they dated as stars, under one link to /graph opened on the same group. All server-rendered: the
 * lines are SVG, the faces are the site's avatars laid over them at the same coordinates (lazy, like every card's), and
 * the only motion is a CSS twinkle that reduced motion turns off.
 */
export default function GraphTeaser({ teaser, group }: { teaser: Teaser; group: SkyGroup }) {
  const stats = teaserStats(teaser, group);
  const faceIds = new Set(
    teaser.stars
      .filter((s) => s.member && !s.private)
      .sort((a, b) => b.r - a.r)
      .slice(0, MAX_FACES)
      .map((s) => s.id),
  );
  const faces = teaser.stars.filter((s) => faceIds.has(s.id));
  const stars = teaser.stars.filter((s) => !faceIds.has(s.id));
  return (
    <div className="graph-teaser tap-card">
      <div className="graph-teaser-sky" aria-hidden>
        <svg className="graph-teaser-lines" viewBox={`0 0 ${TEASER_W} ${TEASER_H}`} preserveAspectRatio="xMidYMid meet" focusable="false">
          {teaser.lines.map((l, i) => (
            <line
              key={i}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              className={l.masked ? "is-masked" : undefined}
              strokeWidth={1 + 2 * l.weight}
              strokeOpacity={l.masked ? 0.5 : 0.3 + 0.6 * l.weight}
            />
          ))}
          {stars.map((s, i) => (
            <circle
              key={s.id}
              cx={s.x}
              cy={s.y}
              r={Math.max(3, s.r * 0.55)}
              className={i % 3 === 0 ? "is-twinkle" : undefined}
              style={{ fill: s.private ? "var(--constellation-line)" : avatarPalette(s.id, s.hue).from, animationDelay: `${(i % 7) * 0.45}s` }}
            />
          ))}
        </svg>
        {faces.map((s) => {
          const r = Math.max(MIN_FACE_R, s.r * FACE_SCALE);
          return (
            <span
              key={s.id}
              className="graph-teaser-face"
              style={{ left: pct(s.x, TEASER_W), top: pct(s.y, TEASER_H), width: pct(2 * r, TEASER_W), "--glow": avatarPalette(s.id, s.hue).from } as CSSProperties}
            >
              <Avatar seed={s.id} name={s.name} hue={s.hue} portraitSrc={s.portrait} size={56} round fill decorative />
            </span>
          );
        })}
      </div>
      <div className="graph-teaser-copy">
        <p className="kicker">The Constellation</p>
        <p className="graph-teaser-title">{title(group, teaser.members)}</p>
        {stats && <p className="graph-teaser-stats">{stats}</p>}
        {/* A plain link, not next/link: /graph has a loading screen, and a client navigation applies #all-time to it before
            the page arrives, so it landed on the story map (2026-11-17, live). A full load scrolls to the sky. */}
        <a className="button graph-teaser-cta stretch" href={`/graph?origin=${group}#all-time`} data-track="graph-teaser" data-track-from={group}>
          Explore the constellation →
        </a>
      </div>
    </div>
  );
}
