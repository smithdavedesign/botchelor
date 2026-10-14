/**
 * Deterministic, good-looking character avatars with no image hosting and no real-person risk (the $0
 * answer to Character.AI / Talkie avatars). A character's avatar is a gradient + motif + initials
 * derived from its id and name, so it is stable across the feed, episodes and cast. Pure and
 * client-safe, so server components, client components and the OG image route all share it.
 */

/** The hues an owner can pick for a character's avatar; `null`/absent means "auto" (derived from the id). */
export const AVATAR_HUES = [
  { id: 0, label: "Auto" },
  { id: 340, label: "Rose" },
  { id: 275, label: "Violet" },
  { id: 210, label: "Azure" },
  { id: 160, label: "Teal" },
  { id: 95, label: "Lime" },
  { id: 30, label: "Amber" },
] as const;

function hash(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type AvatarPalette = { hue: number; from: string; to: string; ink: string; soft: string };

/** The two-stop gradient and ink for a character. `hueOverride` 1..360 wins; 0/undefined derives it. */
export function avatarPalette(seed: string, hueOverride?: number | null): AvatarPalette {
  const h = hash(seed);
  const hue = hueOverride && hueOverride > 0 ? hueOverride % 360 : h % 360;
  const from = `hsl(${hue} 72% 58%)`;
  const to = `hsl(${(hue + 42) % 360} 68% 44%)`;
  const soft = `hsl(${hue} 80% 85%)`;
  return { hue, from, to, ink: "#ffffff", soft };
}

/** One or two uppercase initials from a name ("Mira Quell" → "MQ", "Rafe" → "R"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

/** A CSS `linear-gradient(...)` string, for the OG card where inline SVG gradients are awkward. */
export const avatarGradientCss = (p: AvatarPalette): string => `linear-gradient(135deg, ${p.from}, ${p.to})`;

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

/**
 * The dominant vivid hue (1..360) in RGBA pixel data, or null if the image is mostly grey. This is how
 * a reference image styles a character's avatar: the browser reads the colours with a canvas and sends
 * only this one number — the image itself is never uploaded or stored, so there is nothing to moderate
 * and no real-person risk. Pure, so it is unit-tested without a canvas.
 */
export function hueFromPixels(data: Uint8ClampedArray | number[]): number | null {
  const bins = new Array(12).fill(0);
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 125) continue; // skip transparent
    const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (s < 0.2 || l < 0.12 || l > 0.9) continue; // skip grey, near-black and near-white
    bins[Math.floor(h / 30) % 12] += s * (1 - Math.abs(l - 0.5) * 0.8);
  }
  let best = -1;
  let bestWeight = 0.5; // a floor, so an almost-grey image stays "auto"
  for (let i = 0; i < 12; i++) {
    if (bins[i] > bestWeight) {
      bestWeight = bins[i];
      best = i;
    }
  }
  return best < 0 ? null : best * 30 + 15; // the bin's centre, always 15..345 (never 0 = "auto")
}

/** A plain colour name for a hue, aligned to the 30-degree bins imageTraits uses (centres 15,45,…,345). */
export function hueName(hue: number): string {
  const h = ((hue % 360) + 360) % 360;
  if (h < 30 || h >= 345) return "red";
  if (h < 60) return "amber"; // centre 45
  if (h < 90) return "lime"; // centre 75
  if (h < 150) return "green"; // centres 105, 135
  if (h < 200) return "teal"; // centres 165, 195
  if (h < 255) return "blue"; // centre 225
  if (h < 290) return "violet"; // centres 255, 285
  return "pink"; // centre 315
}

export type ImageTraits = { hue: number | null; descriptor: string; traits: string[] };

/**
 * What a reference image says about a character, computed entirely in the browser from its pixels: a
 * dominant hue (for the avatar), a short appearance descriptor, and 2-3 suggested personality traits
 * read from the image's brightness, saturation, warmth and colourfulness. The image itself is never
 * uploaded, stored or sent — only these derived values are, exactly like choosing a swatch and typing
 * traits. This is "using an image as training data" for the character's look AND vibe, safely at $0. Pure.
 */
export function imageTraits(data: Uint8ClampedArray | number[]): ImageTraits {
  const bins = new Array(12).fill(0);
  let sumS = 0;
  let sumL = 0;
  let n = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 125) continue;
    const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    sumS += s;
    sumL += l;
    n++;
    if (s < 0.2 || l < 0.12 || l > 0.9) continue;
    bins[Math.floor(h / 30) % 12] += s * (1 - Math.abs(l - 0.5) * 0.8);
  }
  let best = -1;
  let bestWeight = 0.5;
  for (let i = 0; i < 12; i++) {
    if (bins[i] > bestWeight) {
      bestWeight = bins[i];
      best = i;
    }
  }
  const hue = best < 0 ? null : best * 30 + 15;
  const avgS = n ? sumS / n : 0;
  const avgL = n ? sumL / n : 0.5;
  const distinct = bins.filter((b) => b > 0.5).length;
  const light = avgL > 0.62 ? "bright" : avgL < 0.38 ? "dark" : "soft";
  const sat = avgS > 0.45 ? "vivid" : avgS < 0.2 ? "muted" : "balanced";

  // The image's visual properties, mapped to suggested personality traits.
  const traits = [
    avgL > 0.62 ? "sunny" : avgL < 0.38 ? "mysterious" : "gentle",
    avgS > 0.45 ? "bold" : avgS < 0.2 ? "understated" : "steady",
  ];
  if (hue !== null) traits.push(hue < 66 || hue >= 300 ? "warm" : hue < 180 ? "grounded" : "cool");
  if (distinct >= 4 && traits.length < 3) traits.push("playful");
  const uniqueTraits = [...new Set(traits)].slice(0, 3);

  const descriptor =
    hue === null
      ? `a ${light}, neutral palette`
      : `a ${hue < 66 || hue >= 300 ? "warm" : hue < 180 ? "fresh" : "cool"} ${hueName(hue)} palette, ${light} and ${sat}`;
  return { hue, descriptor, traits: uniqueTraits };
}
