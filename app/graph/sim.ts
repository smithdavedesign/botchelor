/**
 * The Constellation's force simulation: pure data in, positions out — no DOM, no React, so vitest covers it
 * without a browser. Hand-rolled (the repo's way: no d3) and sized for this show's graph, which is tens of
 * nodes: pairwise repulsion is O(n²) per tick and that's fine at this scale.
 *
 * Shape of the layout: connected characters cluster mid-stage, pulled together by their dates (spring rest
 * length shrinks as tie strength grows); characters still waiting for a first public date sit on a fixed
 * "orbit ring" around the cluster instead of drifting as a snowstorm. Positions seed deterministically from
 * each character's id, so the same cast always settles into the same sky.
 */

export type SimNode = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Node radius in world units (degree-scaled by createSim). */
  r: number;
  degree: number;
  /** On the orbit ring (no public dates yet): placed once, excluded from forces. */
  orbit: boolean;
  /** Pinned by a drag: forces don't move it. */
  pinned: boolean;
};

export type SimEdge = { a: number; b: number; weight: number };

export type Sim = {
  nodes: SimNode[];
  edges: SimEdge[];
  /** Cooling factor: the rAF loop stops below ALPHA_MIN and reheats on interaction. */
  alpha: number;
  w: number;
  h: number;
};

export const ALPHA_MIN = 0.02;
export const REHEAT = 0.3;

/** FNV-1a (same as lib/avatar.ts): deterministic per-id seeds so layouts and tests are reproducible. */
function hash(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function nodeRadius(degree: number, maxDegree: number): number {
  return 14 + 10 * Math.sqrt(degree / Math.max(1, maxDegree));
}

export function createSim(nodes: { id: string; degree: number }[], edges: { a_id: string; b_id: string; weight: number }[], w: number, h: number): Sim {
  const maxDegree = nodes.reduce((m, n) => Math.max(m, n.degree), 1);
  const cx = w / 2;
  const cy = h / 2;
  const spread = 0.22 * Math.min(w, h);
  const simNodes: SimNode[] = nodes.map((n) => {
    const seed = hash(n.id);
    const angle = (seed / 0xffffffff) * Math.PI * 2;
    const dist = 0.2 + 0.8 * ((seed >>> 8) % 1000) / 1000;
    return {
      id: n.id,
      x: cx + Math.cos(angle) * spread * dist,
      y: cy + Math.sin(angle) * spread * dist,
      vx: 0,
      vy: 0,
      r: nodeRadius(n.degree, maxDegree),
      degree: n.degree,
      orbit: n.degree === 0,
      pinned: false,
    };
  });
  // Singles on the orbit ring: golden-angle spacing in id order (deterministic), outside the cluster.
  const ring = 0.46 * Math.min(w, h);
  const singles = simNodes.filter((n) => n.orbit);
  singles.forEach((n, i) => {
    const angle = i * GOLDEN + (hash(n.id) % 100) / 1000; // a hair of per-id jitter so re-filters don't snap identically
    n.x = cx + Math.cos(angle) * ring;
    n.y = cy + Math.sin(angle) * ring;
  });
  const index = new Map(simNodes.map((n, i) => [n.id, i]));
  const simEdges: SimEdge[] = [];
  for (const e of edges) {
    const a = index.get(e.a_id);
    const b = index.get(e.b_id);
    if (a !== undefined && b !== undefined) simEdges.push({ a, b, weight: e.weight });
  }
  return { nodes: simNodes, edges: simEdges, alpha: 1, w, h };
}

/** One physics step. Orbit-ring and pinned nodes hold their place; everything else repels, springs and centres. */
export function tick(sim: Sim): void {
  const { nodes, edges } = sim;
  const cx = sim.w / 2;
  const cy = sim.h / 2;
  const active = nodes.filter((n) => !n.orbit);

  // Pairwise repulsion, capped up close so overlapping seeds don't explode.
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        // Coincident seeds: nudge apart deterministically.
        dx = ((hash(a.id) % 7) - 3) || 1;
        dy = ((hash(b.id) % 7) - 3) || -1;
        d2 = dx * dx + dy * dy;
      }
      const f = Math.min(2400 / d2, 6);
      const d = Math.sqrt(d2);
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // Springs: a stronger tie pulls the pair closer (shorter rest length, stiffer spring).
  for (const e of edges) {
    const a = nodes[e.a];
    const b = nodes[e.b];
    if (a.orbit || b.orbit) continue;
    const rest = 170 - 110 * e.weight;
    const k = 0.02 + 0.05 * e.weight;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = k * (d - rest);
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  for (const n of active) {
    // Weak centering keeps the cluster on stage.
    n.vx += (cx - n.x) * 0.004;
    n.vy += (cy - n.y) * 0.004;
  }

  // Collision: push overlapping pairs apart directly.
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const overlap = a.r + b.r + 6 - d;
      if (overlap > 0) {
        const push = overlap / 2;
        if (!a.pinned) {
          a.x -= (dx / d) * push;
          a.y -= (dy / d) * push;
        }
        if (!b.pinned) {
          b.x += (dx / d) * push;
          b.y += (dy / d) * push;
        }
      }
    }
  }

  for (const n of active) {
    if (n.pinned) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx *= 0.85;
    n.vy *= 0.85;
    n.x += n.vx * sim.alpha;
    n.y += n.vy * sim.alpha;
  }
  sim.alpha *= 0.985;
}

/** Run the sim to rest (reduced motion, and tests). */
export function settle(sim: Sim, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && sim.alpha >= ALPHA_MIN; i++) tick(sim);
  sim.alpha = 0;
}

export type Pick = { kind: "node"; index: number } | { kind: "edge"; index: number } | null;

/** What's under a world-space point: the nearest node within its radius (+ slack), else the nearest edge segment. */
export function pick(sim: Sim, x: number, y: number, zoom = 1): Pick {
  let best: Pick = null;
  let bestD2 = Infinity;
  const slack = 8 / zoom;
  for (let i = 0; i < sim.nodes.length; i++) {
    const n = sim.nodes[i];
    const dx = x - n.x;
    const dy = y - n.y;
    const d2 = dx * dx + dy * dy;
    const hit = n.r + slack;
    if (d2 <= hit * hit && d2 < bestD2) {
      best = { kind: "node", index: i };
      bestD2 = d2;
    }
  }
  if (best) return best;
  const edgeSlack = 6 / zoom;
  for (let i = 0; i < sim.edges.length; i++) {
    const e = sim.edges[i];
    const a = sim.nodes[e.a];
    const b = sim.nodes[e.b];
    const d2 = pointToSegment2(x, y, a.x, a.y, b.x, b.y);
    if (d2 <= edgeSlack * edgeSlack && d2 < bestD2) {
      best = { kind: "edge", index: i };
      bestD2 = d2;
    }
  }
  return best;
}

function pointToSegment2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const qx = ax + t * dx - px;
  const qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}
