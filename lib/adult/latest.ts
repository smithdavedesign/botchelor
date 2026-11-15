import type { Media } from "./media";

/**
 * After Dark home's "Your latest" (David, 2026-11-15: a finished video sat on its pair's page and the hub never said so):
 * the newest few things they made, each a tap from the Gallery.
 */
export const LATEST_SHOWN = 4;
/** How many newest it looks through to find them (faces and what they didn't like are left out). */
export const LATEST_LOOK = 12;
/** Made within a day: marked New. */
export const NEW_FOR_MS = 24 * 60 * 60 * 1000;

/**
 * The newest pictures and videos that came through: not a face, not one in the Archive, not one they gave a 👎. A
 * night's video is many shots made at once, so one shot of a video stands for it, not four of the same night.
 */
export function latestMade<T extends Pick<Media, "kind" | "status" | "rating" | "archived" | "in_reel">>(items: readonly T[], n = LATEST_SHOWN): T[] {
  const out: T[] = [];
  let shot = false;
  for (const m of items) {
    if (out.length >= n) break;
    if (m.kind === "baseline" || m.status !== "ready" || m.archived || m.rating === -1) continue;
    if (m.kind === "video" && m.in_reel) {
      if (shot) continue;
      shot = true;
    }
    out.push(m);
  }
  return out;
}
