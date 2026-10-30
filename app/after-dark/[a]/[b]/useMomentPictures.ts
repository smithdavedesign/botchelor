"use client";

import { useEffect, useState } from "react";
import type { PublicBeat } from "@/lib/adult/beats";
import type { MomentPicture } from "@/lib/adult/scene-match";

/** While a moment's picture is being drawn, asked again this often (it lands in 20 to 60 s), for at most this long. */
const POLL_MS = 6_000;
const POLL_FOR_MS = 4 * 60_000;

/**
 * The running chapter's moments being pictured (lib/adult/scene-match.ts momentPictures; docs/PRDs/theater-immersion.md
 * #5): asked whenever the scene's beats change, and every POLL_MS while one is being drawn, so the stage shows the new
 * picture within seconds of it landing, and a stand-in until then.
 */
export function useMomentPictures(a: string, b: string, beats: readonly PublicBeat[], enabled = true): MomentPicture[] {
  const [moments, setMoments] = useState<MomentPicture[]>([]);
  const [tick, setTick] = useState(0);
  // The beats' statuses as the scene last gave them: a change (one answered, one drawn) asks again.
  const said = beats.map((x) => `${x.id}:${x.status}`).join(",");
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`/api/admin/after-dark/moment-pictures?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { moments?: MomentPicture[] } | null) => live && d && setMoments(d.moments ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [a, b, enabled, said, tick]);
  const drawing = moments.some((m) => m.status === "drawing") || beats.some((x) => x.status === "drawing");
  const [since, setSince] = useState(0);
  useEffect(() => {
    if (!drawing) return setSince(0);
    setSince((s) => s || Date.now());
  }, [drawing]);
  useEffect(() => {
    if (!enabled || !drawing || (since && Date.now() - since > POLL_FOR_MS)) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), POLL_MS);
    return () => window.clearTimeout(t);
  }, [enabled, drawing, since, tick]);
  return moments;
}

/** How many lines a moment's picture stays on the stage after its line. */
export const MOMENT_HOLDS_FOR = 8;

/**
 * The picture for the stage at the line on screen: the latest moment at or before it, within MOMENT_HOLDS_FOR lines,
 * that has its picture or a stand-in. `drawing` when it's the stand-in.
 */
export function stagePicture(moments: readonly MomentPicture[], onStage: number): { id: string; drawing: boolean } | null {
  for (let i = moments.length - 1; i >= 0; i--) {
    const m = moments[i];
    if (m.line > onStage || onStage - m.line > MOMENT_HOLDS_FOR) continue;
    if (m.status === "drawn" && m.picture_id) return { id: m.picture_id, drawing: false };
    if (m.status === "drawing" && m.stand_in) return { id: m.stand_in, drawing: true };
  }
  return null;
}
