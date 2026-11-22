"use client";

import { useEffect, useRef } from "react";
import { sized } from "@/app/Avatar";
import { avatarPalette, initials } from "@/lib/avatar";
import { shade, starColor, type ColorBy } from "./colors";
import { LINE_STYLES, SOCIAL_TOKENS, type SocialToken } from "@/lib/social/lenses";
import { placeGlyph, type SkyEdge, type SkyNode } from "./lens";
import { ALPHA_MIN, createSim, pick, REHEAT, settle, tick, warmStart, type Sim } from "./sim";
import { LINE_STYLE, STAGE_GROUPS, stageGroup, type StageGroup } from "./stages";

/** How many portraits the sky fetches at once. */
const IMAGES_AT_ONCE = 4;

export type Selection = { kind: "node"; id: string } | { kind: "edge"; a_id: string; b_id: string } | null;

type Props = {
  /**
   * Already filtered by the wrapper; the sim rebuilds (deterministically) when these change. The Love view's pairs, or a
   * social view's (./lens.ts): lines that carry one line a group, and places as stars with a spoke to each member.
   */
  nodes: SkyNode[];
  edges: SkyEdge[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Search-to-focus: pan/zoom to this node and select it (cleared by the wrapper after use). */
  focusId: string | null;
  /** Frame every star on the sky: each new number asks once (into or out of one character's world). */
  fit?: number;
  /** What a star's colour means (./colors.ts): its own hue, its kind, or its cluster. */
  colorBy?: ColorBy;
  /** "Show what happened" is on: draw the chevrons (who got turned down). Off by default, like the episode's recap. */
  showOutcomes?: boolean;
  /** What the sky shows, for a screen reader: the Love view's words by default. */
  label?: string;
};

type View = { zoom: number; panX: number; panY: number };
/** `lines`: each stage group's line colour (./stages.ts LINE_STYLE tokens); `social`: the social views' (lib/social/lenses.ts). */
type Theme = { bg: string; ink: string; muted: string; line: string; accent: string; accent2: string; lines: Record<StageGroup, string>; social: Record<SocialToken, string> };

const edgeKey = (e: SkyEdge) => `${e.a_id}~${e.b_id}${e.lines ? `:${e.lines.map((l) => l.g).join("+")}` : ""}`;

/** How many places are named on a zoomed-out sky (a phone's whole sky): the most shared, where they fit. */
const PLACE_NAMES_ZOOMED_OUT = 6;

/**
 * The view that frames every star, centred, no closer than a focus: what a `fit` asks for (the orbit only when nothing
 * else is on the sky, so a world fills the screen), and where the camera rides while a layout settles (`orbit`: the
 * ring too, when it's on, as the sky is drawn to be seen whole). Null with nothing on the sky.
 */
function framing(sim: Sim, w: number, h: number, orbit = false): View | null {
  const inner = orbit ? sim.nodes : sim.nodes.filter((n) => !n.orbit);
  const stars = inner.length ? inner : sim.nodes;
  if (!stars.length) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const n of stars) {
    x0 = Math.min(x0, n.x - n.r);
    y0 = Math.min(y0, n.y - n.r);
    x1 = Math.max(x1, n.x + n.r);
    y1 = Math.max(y1, n.y + n.r);
  }
  const pad = 32;
  const zoom = Math.min(1.6, Math.max(0.4, Math.min((w - 2 * pad) / Math.max(1, x1 - x0), (h - 2 * pad) / Math.max(1, y1 - y0))));
  return { zoom, panX: w / 2 - ((x0 + x1) / 2) * zoom, panY: h / 2 - ((y0 + y1) / 2) * zoom };
}

/** The sim's view of the stars: a place's star stays small whatever its members (its size isn't anyone's popularity). */
const simNodes = (ns: readonly SkyNode[]) => ns.map((n) => ({ id: n.id, degree: n.place ? 1 : n.degree }));

/**
 * The night-sky canvas: hand-rolled force layout (./sim.ts), ego-network highlight on hover, drag/pan/pinch/wheel,
 * portraits drawn in circular clips with the avatar gradient as fallback. All per-frame state lives in refs — React
 * renders this component exactly once per data change. Colors come from the CSS tokens so both themes just work.
 */
export default function ConstellationCanvas({ nodes, edges, selection, onSelect, focusId, fit = 0, colorBy = "character", showOutcomes = false, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim | null>(null);
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  // The camera frames the stars by itself (2026-11-21: a desktop's first sky was a small clump in a wide dark canvas)
  // until the viewer takes it: any press or wheel, or a search's focus. `autoFit` is on while a layout settles.
  const touchedRef = useRef(false);
  const autoFitRef = useRef(true);
  const hoverRef = useRef<ReturnType<typeof pick>>(null);
  const rafRef = useRef<number>(0);
  const imagesRef = useRef<Map<string, HTMLImageElement | "failed">>(new Map());
  const themeRef = useRef<Theme | null>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 900, h: 600 });
  const reducedRef = useRef(false);
  const propsRef = useRef({ nodes, edges, selection, onSelect, colorBy, showOutcomes });
  propsRef.current = { nodes, edges, selection, onSelect, colorBy, showOutcomes };

  // One effect owns everything (strict-mode double-invoke safe: full teardown, idempotent setup).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const readTheme = (): Theme => {
      const s = getComputedStyle(canvas);
      const accent2 = s.getPropertyValue("--accent-2").trim() || "#7a36c9";
      return {
        bg: s.getPropertyValue("--constellation-bg").trim() || "#141018",
        // The sky's own ink (light in both themes, as the sky is dark in both), not the page's.
        ink: s.getPropertyValue("--constellation-ink").trim() || "#fff",
        muted: s.getPropertyValue("--constellation-label").trim() || "#aaa",
        line: s.getPropertyValue("--constellation-line").trim() || "#444",
        accent: s.getPropertyValue("--accent").trim() || "#e5356b",
        accent2,
        lines: Object.fromEntries(STAGE_GROUPS.map((g) => [g, s.getPropertyValue(LINE_STYLE[g].token).trim() || accent2])) as Record<StageGroup, string>,
        social: Object.fromEntries(SOCIAL_TOKENS.map((t) => [t, s.getPropertyValue(t).trim() || accent2])) as Record<SocialToken, string>,
      };
    };
    themeRef.current = readTheme();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = reduced.matches;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      const w = Math.max(320, rect?.width ?? 900);
      const h = Math.max(320, rect?.height ?? 600);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      sizeRef.current = { w, h };
      if (!touchedRef.current) autoFitRef.current = true;
      if (!simRef.current) rebuild();
      wake(0.1);
    };

    const rebuild = () => {
      const { w, h } = sizeRef.current;
      const { nodes: ns, edges: es } = propsRef.current;
      simRef.current = createSim(
        simNodes(ns),
        es.map((e) => ({ a_id: e.a_id, b_id: e.b_id, weight: e.weight })),
        w,
        h,
      );
      if (reducedRef.current) settle(simRef.current);
      else simRef.current.alpha = 1;
    };

    /** Screen (css px) → world. */
    const toWorld = (sx: number, sy: number) => {
      const v = viewRef.current;
      return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
    };

    const draw = () => {
      const sim = simRef.current;
      const theme = themeRef.current;
      if (!sim || !theme) return;
      const { w, h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      const v = viewRef.current;
      const { nodes: ns, edges: es, selection: sel, colorBy: by, showOutcomes: outcomes } = propsRef.current;
      const byId = new Map(ns.map((n, i) => [n.id, i]));
      // A star's palette under the chosen colouring: its own, a kind's hue, a cluster's colour, or null for the grey.
      const paletteOf = (id: string, n: SkyNode): { from: string; to: string } | null => {
        const c = starColor(n, by);
        if (c === null) return null;
        if (c === "own") return avatarPalette(id, n.hue);
        if ("hue" in c) return avatarPalette(id, c.hue);
        return { from: c.color, to: shade(c.color) };
      };

      // The ego set: hovered or selected node + its neighbours (and a selected edge's two ends).
      const ego = new Set<string>();
      const hover = hoverRef.current;
      const focusNodeId =
        hover?.kind === "node" ? sim.nodes[hover.index]?.id : sel?.kind === "node" ? sel.id : null;
      if (focusNodeId) {
        ego.add(focusNodeId);
        for (const e of es) {
          if (e.a_id === focusNodeId) ego.add(e.b_id);
          if (e.b_id === focusNodeId) ego.add(e.a_id);
        }
      }
      const hoverEdge = hover?.kind === "edge" ? sim.edges[hover.index] : null;
      const selEdge = sel?.kind === "edge" ? sel : null;
      if (hoverEdge) {
        ego.add(sim.nodes[hoverEdge.a].id);
        ego.add(sim.nodes[hoverEdge.b].id);
      }
      if (selEdge) {
        ego.add(selEdge.a_id);
        ego.add(selEdge.b_id);
      }
      const dimming = ego.size > 0;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.panX, dpr * v.panY);

      // A chevron along a line, pointing from one star at another: who got turned down, who told whom.
      const chevron = (from: { x: number; y: number; r: number }, to: { x: number; y: number; r: number }) => {
        const len = Math.hypot(to.x - from.x, to.y - from.y);
        if (len <= from.r + to.r + 12) return;
        const ux = (to.x - from.x) / len;
        const uy = (to.y - from.y) / len;
        const tipX = from.x + ux * len * 0.62;
        const tipY = from.y + uy * len * 0.62;
        const s = 5 / Math.sqrt(v.zoom) + 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(tipX - ux * s - uy * s * 0.8, tipY - uy * s + ux * s * 0.8);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(tipX - ux * s + uy * s * 0.8, tipY - uy * s - ux * s * 0.8);
        ctx.stroke();
      };

      // Edges under nodes. Each line says where its pair stands (./stages.ts): its group's colour and its own dash, so
      // it reads without colour too; first dates thin and faint. A private pair stays the neutral grey dash it always was.
      for (let i = 0; i < sim.edges.length; i++) {
        const se = sim.edges[i];
        const data = es[i];
        const a = sim.nodes[se.a];
        const b = sim.nodes[se.b];
        const inEgo = ego.has(a.id) && ego.has(b.id);
        const isSel = selEdge && selEdge.a_id === data.a_id && selEdge.b_id === data.b_id;
        const hot = Boolean(isSel) || hoverEdge === se;
        // A social view's pair (./lens.ts): one line a group, side by side, each in its kind's colour and dash
        // (lib/social/lenses.ts LINE_STYLES), red when it feels bad, faded when it's over, and an arrow on who said it.
        if (data.lines?.length) {
          const n = data.lines.length;
          const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          const px = -(b.y - a.y) / len;
          const py = (b.x - a.x) / len;
          const base = 1 + 2 * se.weight;
          const width = (base / v.zoom + base * 0.6) * (data.spoke ? 0.7 : 1);
          const gap = width * 1.9;
          if (hot) {
            ctx.globalAlpha = 0.3;
            ctx.strokeStyle = theme.ink;
            ctx.lineWidth = width * n + gap * (n - 1) + 5 / v.zoom;
            ctx.lineCap = "round";
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
          data.lines.forEach((l, k) => {
            const style: { token: SocialToken; dash: readonly number[]; faint?: boolean; arrow?: boolean } = LINE_STYLES[l.s] ?? LINE_STYLES.met;
            const off = (k - (n - 1) / 2) * gap;
            const faint = Boolean(style.faint) || Boolean(data.spoke);
            ctx.globalAlpha = dimming && !inEgo ? 0.08 : hot ? 1 : faint ? (dimming ? 0.6 : 0.22 + 0.3 * se.weight) : l.e ? 0.4 : 0.55 + 0.4 * se.weight;
            ctx.strokeStyle = l.v < 0 ? theme.social["--social-conflict"] : theme.social[style.token];
            ctx.lineWidth = width * (faint && !hot ? 0.75 : 1);
            ctx.lineCap = "round";
            ctx.setLineDash(style.dash.length ? style.dash.map((d) => d * width) : []);
            const from = { x: a.x + px * off, y: a.y + py * off, r: a.r };
            const to = { x: b.x + px * off, y: b.y + py * off, r: b.r };
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
            if (style.arrow && l.d & 1) chevron(from, to);
            if (style.arrow && l.d & 2) chevron(to, from);
          });
          continue;
        }
        const group = data.masked ? null : stageGroup(data.stage_id);
        const style = group ? LINE_STYLE[group] : null;
        // A pair with no public stage (never on a public pair today) draws like a first date.
        const faint = !data.masked && (!style || style.faint);
        const base = 1 + 2.5 * se.weight;
        const width = ((isSel ? 2.5 : base) / v.zoom + base * 0.6) * (faint && !hot ? 0.75 : 1);
        if (hot) {
          // A soft halo in the sky's ink under the picked or hovered line, which keeps its own colour on top.
          ctx.globalAlpha = 0.3;
          ctx.strokeStyle = theme.ink;
          ctx.lineWidth = width + 5 / v.zoom;
          ctx.lineCap = "round";
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.globalAlpha =
          dimming && !inEgo ? 0.08 : hot ? 1 : data.masked ? 0.25 + 0.6 * se.weight : faint ? (dimming ? 0.6 : 0.16 + 0.34 * se.weight) : 0.5 + 0.45 * se.weight;
        ctx.strokeStyle = data.masked ? theme.line : theme.lines[group ?? "first"];
        ctx.lineWidth = width;
        ctx.lineCap = data.masked ? "butt" : "round";
        ctx.setLineDash(data.masked ? [4, 5] : style && style.dash.length ? style.dash.map((d) => d * width) : []);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // One-sided turn-downs (their aired "who gets rejected?"): a chevron pointing at the one turned down more. A
        // spoiler, so only once "Show what happened" is on.
        const td = data.turned_down;
        if (outcomes && td && td.a !== td.b) {
          const [from, to] = td.a > td.b ? [a, b] : [b, a];
          chevron(from, to);
        }
      }
      ctx.setLineDash([]);
      ctx.lineCap = "butt";

      // Nodes. A place's name waits for the end (placeLabels), so the names can be laid out together.
      const images = imagesRef.current;
      // `size`: how many characters share the place (its star's size is the same for all).
      const placeLabels: { x: number; y: number; text: string; rank: number; size: number }[] = [];
      for (const sn of sim.nodes) {
        const idx = byId.get(sn.id);
        const data = idx === undefined ? null : ns[idx];
        if (!data) continue;
        const dim = dimming && !ego.has(sn.id);
        ctx.globalAlpha = dim ? 0.15 : 1;
        const selected = sel?.kind === "node" && sel.id === sn.id;

        // A place (a social view's): a pin in its spokes' colour with its mark, and its name always beside it, since the
        // places are the sky's landmarks.
        if (data.place) {
          const colour = theme.social[LINE_STYLES[data.place.group === "work" ? "work" : "place"].token];
          const r = sn.r * 0.9;
          const diamond = (pad: number) => {
            ctx.beginPath();
            ctx.moveTo(sn.x, sn.y - r - pad);
            ctx.lineTo(sn.x + r + pad, sn.y);
            ctx.lineTo(sn.x, sn.y + r + pad);
            ctx.lineTo(sn.x - r - pad, sn.y);
            ctx.closePath();
          };
          diamond(0);
          ctx.fillStyle = theme.bg;
          ctx.fill();
          ctx.globalAlpha = dim ? 0.05 : 0.3;
          ctx.fillStyle = colour;
          ctx.fill();
          ctx.globalAlpha = dim ? 0.15 : 1;
          ctx.strokeStyle = colour;
          ctx.lineWidth = 2 / v.zoom + 1;
          ctx.stroke();
          ctx.font = `${Math.max(9, r * 0.8)}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = theme.ink;
          ctx.fillText(placeGlyph(data.place.kind), sn.x, sn.y + 0.5);
          if (selected || ego.has(sn.id)) {
            ctx.strokeStyle = selected ? theme.accent : theme.accent2;
            ctx.lineWidth = (selected ? 3 : 1.5) / v.zoom;
            diamond(3 / v.zoom);
            ctx.stroke();
          }
          if (!dim) placeLabels.push({ x: sn.x, y: sn.y + r + 4 / v.zoom, text: data.name, rank: selected ? 2 : ego.has(sn.id) ? 1 : 0, size: data.place.count });
          continue;
        }

        const img = data.portrait && !data.private ? images.get(sn.id) : undefined;
        if (data.portrait && !data.private && img === undefined) loadImage(sn.id, data.portrait);

        // Soft glow behind connected nodes (the constellation look).
        const p = paletteOf(sn.id, data);
        if (!sn.orbit && !dim && p) {
          const glow = ctx.createRadialGradient(sn.x, sn.y, sn.r * 0.4, sn.x, sn.y, sn.r * 2.2);
          glow.addColorStop(0, p.from);
          glow.addColorStop(1, "transparent");
          ctx.globalAlpha = dim ? 0.05 : 0.25;
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(sn.x, sn.y, sn.r * 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = dim ? 0.15 : 1;
        }

        ctx.beginPath();
        ctx.arc(sn.x, sn.y, sn.r, 0, Math.PI * 2);
        if (img && img !== "failed") {
          ctx.save();
          ctx.clip();
          ctx.drawImage(img, sn.x - sn.r, sn.y - sn.r, sn.r * 2, sn.r * 2);
          ctx.restore();
          // A portrait keeps its face; under kind or cluster colouring a ring says which.
          if (by !== "character") {
            ctx.strokeStyle = p ? p.from : theme.line;
            ctx.lineWidth = 3 / v.zoom + 1;
            ctx.beginPath();
            ctx.arc(sn.x, sn.y, sn.r, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else {
          const grad = ctx.createLinearGradient(sn.x - sn.r, sn.y - sn.r, sn.x + sn.r, sn.y + sn.r);
          if (!p) {
            grad.addColorStop(0, theme.line);
            grad.addColorStop(1, theme.muted);
          } else {
            grad.addColorStop(0, p.from);
            grad.addColorStop(1, p.to);
          }
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.font = `600 ${Math.max(9, sn.r * 0.72)}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(data.private ? "🔒" : initials(data.name), sn.x, sn.y + 0.5);
        }

        if (selected || ego.has(sn.id)) {
          ctx.strokeStyle = selected ? theme.accent : theme.accent2;
          ctx.lineWidth = (selected ? 3 : 1.5) / v.zoom;
          ctx.beginPath();
          ctx.arc(sn.x, sn.y, sn.r + 2 / v.zoom, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Semantic zoom: labels when zoomed in, or for the ego network / orbit hover.
        const showLabel = v.zoom >= 1.4 || ego.has(sn.id) || selected;
        if (showLabel && !dim) {
          ctx.font = `500 ${12 / v.zoom}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = theme.muted;
          ctx.fillText(data.name, sn.x, sn.y + sn.r + 4 / v.zoom);
        }
      }

      // The places' names, the sky's landmarks: the picked place and its neighbours first, then the most shared, each drawn
      // only where it clears the names already down (30 places in a dense middle wrote over each other). Zooming in
      // spreads them out, so more fit; zoomed out (a phone's whole sky) only the few biggest, so the names don't bury
      // the faces. A dark edge keeps each readable over the lines.
      if (placeLabels.length) {
        let room = v.zoom >= 0.5 ? Infinity : PLACE_NAMES_ZOOMED_OUT;
        ctx.globalAlpha = 1;
        ctx.font = `600 ${11 / v.zoom}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineJoin = "round";
        ctx.lineWidth = 3 / v.zoom;
        ctx.strokeStyle = theme.bg;
        ctx.fillStyle = theme.muted;
        const pad = 3 / v.zoom;
        const h = 13 / v.zoom;
        const down: { l: number; t: number; r: number; b: number }[] = [];
        placeLabels.sort((a, b) => b.rank - a.rank || b.size - a.size);
        for (const lab of placeLabels) {
          const w = ctx.measureText(lab.text).width;
          const box = { l: lab.x - w / 2 - pad, t: lab.y - pad, r: lab.x + w / 2 + pad, b: lab.y + h + pad };
          if (lab.rank === 0 && (room <= 0 || down.some((d) => box.l < d.r && box.r > d.l && box.t < d.b && box.b > d.t))) continue;
          if (lab.rank === 0) room--;
          down.push(box);
          ctx.strokeText(lab.text, lab.x, lab.y);
          ctx.fillText(lab.text, lab.x, lab.y);
        }
      }
      ctx.globalAlpha = 1;
    };

    /** Until the viewer takes the camera: ease toward framing the stars each frame, and land on it once they're still. */
    const autoFrame = (settled: boolean) => {
      const sim = simRef.current;
      if (!sim || !autoFitRef.current || touchedRef.current) return;
      const target = framing(sim, sizeRef.current.w, sizeRef.current.h, true);
      if (!target) return;
      const v = viewRef.current;
      const k = settled ? 1 : 0.18;
      v.zoom += (target.zoom - v.zoom) * k;
      v.panX += (target.panX - v.panX) * k;
      v.panY += (target.panY - v.panY) * k;
      if (settled) autoFitRef.current = false;
    };
    const loop = () => {
      const sim = simRef.current;
      if (sim && !reducedRef.current && sim.alpha >= ALPHA_MIN) {
        tick(sim);
        autoFrame(false);
        draw();
        rafRef.current = requestAnimationFrame(loop);
      } else {
        autoFrame(true);
        draw();
        rafRef.current = 0;
      }
    };
    /** Reheat and make sure the loop is running (or just redraw under reduced motion). */
    const wake = (alpha = REHEAT) => {
      const sim = simRef.current;
      if (!sim) return;
      if (reducedRef.current) {
        settle(sim);
        autoFrame(true);
        draw();
        return;
      }
      sim.alpha = Math.max(sim.alpha, alpha);
      if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
    };

    // Small copies (?w=128, not the 1024px originals), a few at a time: on 2026-11-01 a phone opening /graph asked for
    // 176 full portraits at once and the show's one replica stopped answering until it was restarted.
    const queued: (() => void)[] = [];
    let loading = 0;
    const next = () => {
      while (loading < IMAGES_AT_ONCE && queued.length) queued.shift()!();
    };
    const loadImage = (id: string, src: string) => {
      const images = imagesRef.current;
      if (images.has(id)) return;
      images.set(id, "failed"); // replaced on load; marks "requested" so we don't refetch
      queued.push(() => {
        loading++;
        const img = new Image();
        const done = () => {
          loading--;
          next();
        };
        img.onload = () => {
          images.set(id, img);
          if (!rafRef.current) draw();
          done();
        };
        img.onerror = done;
        img.src = sized(src, 64) ?? src;
      });
      next();
    };

    // ---- pointers: drag a node, pan the sky, pinch to zoom, tap to select ----
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging: { index: number } | null = null;
    let panning = false;
    let moved = 0;
    let lastPinch = 0;

    const onPointerDown = (ev: PointerEvent) => {
      touchedRef.current = true;
      canvas.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
      moved = 0;
      if (pointers.size > 1) return; // pinch handles itself in move
      const sim = simRef.current;
      if (!sim) return;
      const p = toWorld(ev.offsetX, ev.offsetY);
      const hit = pick(sim, p.x, p.y, viewRef.current.zoom);
      if (hit?.kind === "node") {
        dragging = { index: hit.index };
        sim.nodes[hit.index].pinned = true;
        wake();
      } else {
        panning = true;
      }
    };
    const onPointerMove = (ev: PointerEvent) => {
      const prev = pointers.get(ev.pointerId);
      if (!prev) {
        // No button down: hover.
        const sim = simRef.current;
        if (!sim) return;
        const p = toWorld(ev.offsetX, ev.offsetY);
        const hit = pick(sim, p.x, p.y, viewRef.current.zoom);
        const changed = JSON.stringify(hit) !== JSON.stringify(hoverRef.current);
        hoverRef.current = hit;
        canvas.style.cursor = hit ? "pointer" : "grab";
        if (changed && !rafRef.current) draw();
        return;
      }
      const dx = ev.offsetX - prev.x;
      const dy = ev.offsetY - prev.y;
      moved += Math.abs(dx) + Math.abs(dy);
      pointers.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });

      if (pointers.size === 2) {
        // Pinch: zoom anchored at the midpoint.
        const [p1, p2] = [...pointers.values()];
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (lastPinch > 0) {
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          zoomAt(mid.x, mid.y, dist / lastPinch);
        }
        lastPinch = dist;
        return;
      }
      lastPinch = 0;

      const sim = simRef.current;
      const v = viewRef.current;
      if (dragging && sim) {
        const n = sim.nodes[dragging.index];
        const p = toWorld(ev.offsetX, ev.offsetY);
        n.x = p.x;
        n.y = p.y;
        wake();
      } else if (panning) {
        v.panX += dx;
        v.panY += dy;
        if (!rafRef.current) draw();
      }
    };
    const onPointerUp = (ev: PointerEvent) => {
      pointers.delete(ev.pointerId);
      lastPinch = 0;
      const sim = simRef.current;
      if (dragging && sim) sim.nodes[dragging.index].pinned = false;
      const wasTap = moved < 6;
      if (wasTap && sim) {
        const p = toWorld(ev.offsetX, ev.offsetY);
        const hit = pick(sim, p.x, p.y, viewRef.current.zoom);
        const { edges: es, onSelect: select } = propsRef.current;
        if (hit?.kind === "node") select({ kind: "node", id: sim.nodes[hit.index].id });
        else if (hit?.kind === "edge") {
          const data = es[hit.index];
          if (data) select({ kind: "edge", a_id: data.a_id, b_id: data.b_id });
        } else select(null);
      }
      dragging = null;
      panning = false;
      if (!rafRef.current) draw();
    };

    const zoomAt = (sx: number, sy: number, factor: number) => {
      const v = viewRef.current;
      const next = Math.min(3, Math.max(0.4, v.zoom * factor));
      const world = toWorld(sx, sy);
      v.panX = sx - world.x * next;
      v.panY = sy - world.y * next;
      v.zoom = next;
      if (!rafRef.current) draw();
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      touchedRef.current = true;
      zoomAt(ev.offsetX, ev.offsetY, Math.exp(-ev.deltaY * 0.0015));
    };

    const onTheme = () => {
      themeRef.current = readTheme();
      if (!rafRef.current) draw();
    };
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");

    // A rebuilt sky says how warm to start (./sim.ts warmStart): gently when most of it carried over.
    const onWake = (ev: Event) => wake(ev instanceof CustomEvent && typeof ev.detail === "number" ? ev.detail : 1);
    // A new colouring or selection only repaints: the layout stays where it is.
    const onRedraw = () => {
      if (!rafRef.current) draw();
    };
    canvas.addEventListener("constellation:redraw", onRedraw);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement ?? canvas);
    resize();
    canvas.addEventListener("constellation:wake", onWake);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    scheme.addEventListener("change", onTheme);
    reduced.addEventListener("change", onTheme);
    wake(1);

    const images = imagesRef.current;
    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      ro.disconnect();
      canvas.removeEventListener("constellation:wake", onWake);
      canvas.removeEventListener("constellation:redraw", onRedraw);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      scheme.removeEventListener("change", onTheme);
      reduced.removeEventListener("change", onTheme);
      simRef.current = null;
      images.clear();
    };
  }, []);

  // Rebuild the sim when the (filtered) data changes. Everyone still on the sky keeps their place (./sim.ts warmStart),
  // so a filter changes the sky under the viewer's eye; deterministic seeds place the newcomers.
  const dataKey = `${nodes.map((n) => n.id).join(",")}|${edges.map(edgeKey).join(",")}`;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = sizeRef.current;
    const sim = createSim(
      simNodes(nodes),
      edges.map((e) => ({ a_id: e.a_id, b_id: e.b_id, weight: e.weight })),
      w,
      h,
    );
    if (simRef.current) warmStart(simRef.current, sim);
    // A new sky (a filter, the whole sky arriving) is framed again for whoever hasn't moved the camera.
    if (!touchedRef.current) autoFitRef.current = true;
    const alpha = sim.alpha;
    if (reducedRef.current) settle(sim);
    simRef.current = sim;
    canvas.dispatchEvent(new CustomEvent("constellation:wake", { detail: alpha }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  useEffect(() => {
    canvasRef.current?.dispatchEvent(new Event("constellation:redraw"));
  }, [colorBy, showOutcomes]);

  // Search-to-focus: center and zoom on the node, without fighting the user's own panning afterwards.
  useEffect(() => {
    if (!focusId) return;
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas) return;
    const n = sim.nodes.find((x) => x.id === focusId);
    if (!n) return;
    const { w, h } = sizeRef.current;
    const v = viewRef.current;
    touchedRef.current = true;
    v.zoom = 1.6;
    v.panX = w / 2 - n.x * v.zoom;
    v.panY = h / 2 - n.y * v.zoom;
    onSelect({ kind: "node", id: focusId });
    canvas.dispatchEvent(new Event("constellation:wake"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  // Frame the sky: every star (the orbit's too when nothing else is on it) in view, centred, no closer than a focus.
  useEffect(() => {
    if (!fit) return;
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas) return;
    const target = framing(sim, sizeRef.current.w, sizeRef.current.h);
    if (!target) return;
    Object.assign(viewRef.current, target);
    canvas.dispatchEvent(new Event("constellation:wake"));
  }, [fit]);

  return <canvas ref={canvasRef} className="constellation-canvas" aria-label={label ?? "The Botchelor constellation: every character and who they've dated"} role="img" />;
}
