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
