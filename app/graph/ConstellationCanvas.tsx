"use client";

import { useEffect, useRef } from "react";
import { avatarPalette, initials } from "@/lib/avatar";
import type { GraphEdge, GraphNode } from "@/lib/graph";
import { ALPHA_MIN, createSim, pick, REHEAT, settle, tick, type Sim } from "./sim";

export type Selection = { kind: "node"; id: string } | { kind: "edge"; a_id: string; b_id: string } | null;

type Props = {
  /** Already filtered by the wrapper; the sim rebuilds (deterministically) when these change. */
  nodes: GraphNode[];
  edges: GraphEdge[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  /** Search-to-focus: pan/zoom to this node and select it (cleared by the wrapper after use). */
  focusId: string | null;
};

type View = { zoom: number; panX: number; panY: number };
type Theme = { bg: string; ink: string; muted: string; line: string; accent: string; accent2: string };

const edgeKey = (e: GraphEdge) => `${e.a_id}~${e.b_id}`;

/**
 * The night-sky canvas: hand-rolled force layout (./sim.ts), ego-network highlight on hover, drag/pan/pinch/wheel,
 * portraits drawn in circular clips with the avatar gradient as fallback. All per-frame state lives in refs — React
 * renders this component exactly once per data change. Colors come from the CSS tokens so both themes just work.
 */
export default function ConstellationCanvas({ nodes, edges, selection, onSelect, focusId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim | null>(null);
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const hoverRef = useRef<ReturnType<typeof pick>>(null);
  const rafRef = useRef<number>(0);
  const imagesRef = useRef<Map<string, HTMLImageElement | "failed">>(new Map());
  const themeRef = useRef<Theme | null>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 900, h: 600 });
  const reducedRef = useRef(false);
  const propsRef = useRef({ nodes, edges, selection, onSelect });
  propsRef.current = { nodes, edges, selection, onSelect };

  // One effect owns everything (strict-mode double-invoke safe: full teardown, idempotent setup).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const readTheme = (): Theme => {
      const s = getComputedStyle(canvas);
      return {
        bg: s.getPropertyValue("--constellation-bg").trim() || "#141018",
        ink: s.getPropertyValue("--ink").trim() || "#fff",
        muted: s.getPropertyValue("--constellation-label").trim() || "#aaa",
        line: s.getPropertyValue("--constellation-line").trim() || "#444",
        accent: s.getPropertyValue("--accent").trim() || "#e5356b",
        accent2: s.getPropertyValue("--accent-2").trim() || "#7a36c9",
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
      if (!simRef.current) rebuild();
      wake(0.1);
    };

    const rebuild = () => {
      const { w, h } = sizeRef.current;
      const { nodes: ns, edges: es } = propsRef.current;
      simRef.current = createSim(
        ns.map((n) => ({ id: n.id, degree: n.degree })),
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
      const { nodes: ns, edges: es, selection: sel } = propsRef.current;
      const byId = new Map(ns.map((n, i) => [n.id, i]));

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

      // Edges under nodes.
      for (let i = 0; i < sim.edges.length; i++) {
        const se = sim.edges[i];
        const data = es[i];
        const a = sim.nodes[se.a];
        const b = sim.nodes[se.b];
        const inEgo = ego.has(a.id) && ego.has(b.id);
        const isSel = selEdge && selEdge.a_id === data.a_id && selEdge.b_id === data.b_id;
        ctx.globalAlpha = dimming && !inEgo ? 0.08 : 0.25 + 0.6 * se.weight;
        ctx.strokeStyle = isSel || hoverEdge === se ? theme.accent : data.masked ? theme.line : theme.accent2;
        ctx.lineWidth = (isSel ? 2.5 : 1 + 2.5 * se.weight) / v.zoom + (1 + 2.5 * se.weight) * 0.6;
        ctx.setLineDash(data.masked ? [4, 5] : []);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Nodes.
      const images = imagesRef.current;
      for (const sn of sim.nodes) {
        const idx = byId.get(sn.id);
        const data = idx === undefined ? null : ns[idx];
        if (!data) continue;
        const dim = dimming && !ego.has(sn.id);
        ctx.globalAlpha = dim ? 0.15 : 1;

        const img = data.portrait && !data.private ? images.get(sn.id) : undefined;
        if (data.portrait && !data.private && img === undefined) loadImage(sn.id, data.portrait);

        // Soft glow behind connected nodes (the constellation look).
        if (!sn.orbit && !dim) {
          const glow = ctx.createRadialGradient(sn.x, sn.y, sn.r * 0.4, sn.x, sn.y, sn.r * 2.2);
          const p = avatarPalette(sn.id, data.hue);
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
        } else {
          const p = avatarPalette(sn.id, data.hue);
          const grad = ctx.createLinearGradient(sn.x - sn.r, sn.y - sn.r, sn.x + sn.r, sn.y + sn.r);
          if (data.private) {
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

        const selected = sel?.kind === "node" && sel.id === sn.id;
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
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      const sim = simRef.current;
      if (sim && !reducedRef.current && sim.alpha >= ALPHA_MIN) {
        tick(sim);
        draw();
        rafRef.current = requestAnimationFrame(loop);
      } else {
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
        draw();
        return;
      }
      sim.alpha = Math.max(sim.alpha, alpha);
      if (!rafRef.current) rafRef.current = requestAnimationFrame(loop);
    };

    const loadImage = (id: string, src: string) => {
      const images = imagesRef.current;
      if (images.has(id)) return;
      const img = new Image();
      images.set(id, "failed"); // replaced on load; marks "requested" so we don't refetch
      img.onload = () => {
        images.set(id, img);
        if (!rafRef.current) draw();
      };
      img.src = src;
    };

    // ---- pointers: drag a node, pan the sky, pinch to zoom, tap to select ----
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging: { index: number } | null = null;
    let panning = false;
    let moved = 0;
    let lastPinch = 0;

    const onPointerDown = (ev: PointerEvent) => {
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
      zoomAt(ev.offsetX, ev.offsetY, Math.exp(-ev.deltaY * 0.0015));
    };

    const onTheme = () => {
      themeRef.current = readTheme();
      if (!rafRef.current) draw();
    };
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");

    const onWake = () => wake(1);
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

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      ro.disconnect();
      canvas.removeEventListener("constellation:wake", onWake);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      scheme.removeEventListener("change", onTheme);
      reduced.removeEventListener("change", onTheme);
      simRef.current = null;
      imagesRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild the sim when the (filtered) data changes — deterministic seeds keep the layout familiar.
  const dataKey = `${nodes.map((n) => n.id).join(",")}|${edges.map(edgeKey).join(",")}`;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = sizeRef.current;
    const sim = createSim(
      nodes.map((n) => ({ id: n.id, degree: n.degree })),
      edges.map((e) => ({ a_id: e.a_id, b_id: e.b_id, weight: e.weight })),
      w,
      h,
    );
    if (reducedRef.current) settle(sim);
    simRef.current = sim;
    canvas.dispatchEvent(new Event("constellation:wake"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

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
    v.zoom = 1.6;
    v.panX = w / 2 - n.x * v.zoom;
    v.panY = h / 2 - n.y * v.zoom;
    onSelect({ kind: "node", id: focusId });
    canvas.dispatchEvent(new Event("constellation:wake"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  return <canvas ref={canvasRef} className="constellation-canvas" aria-label="The Botchelor constellation: every character and who they've dated" role="img" />;
}
