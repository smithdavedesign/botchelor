/**
 * The curated look gallery: twelve hand-picked palettes a creator can choose from instead of hunting
 * for a reference image. Each one is a palette we already read for them, so picking "Golden hour"
 * lands exactly where picking a golden-hour photo would — the same avatar colour, the same appearance
 * line, the same suggested traits and the same behavioural signals the engine decides dates with.
 *
 * This is the competitor report's "give creators visual customization" step, done at $0: the gallery
 * is data, the artwork is drawn (lib/avatar.ts), so there is no image to host, upload or moderate.
 * Client-safe and pure, so the builder, the cast gallery and tests all share it.
 */
import { traitsFromPalette, type ImageSignals, type PaletteStats } from "./avatar";

export type LookPreset = {
  id: string;
  /** What the creator sees in the gallery. */
  label: string;
  /** The palette this look stands for, read down to the same four numbers an image is. */
  palette: PaletteStats;
};

/**
 * Twelve looks spanning the hue wheel and the bright/dark, vivid/muted corners, so the gallery offers
 * a real choice of both appearance and temperament (a dark muted look is a guarded character).
 */
export const LOOK_PRESETS: readonly LookPreset[] = [
  { id: "golden-hour", label: "Golden hour", palette: { hue: 45, lightness: 0.72, saturation: 0.55, variety: 3 } },
  { id: "rose-neon", label: "Rose neon", palette: { hue: 345, lightness: 0.56, saturation: 0.7, variety: 4 } },
  { id: "deep-plum", label: "Deep plum", palette: { hue: 285, lightness: 0.3, saturation: 0.42, variety: 2 } },
  { id: "midnight-azure", label: "Midnight azure", palette: { hue: 225, lightness: 0.28, saturation: 0.46, variety: 2 } },
  { id: "sea-glass", label: "Sea glass", palette: { hue: 165, lightness: 0.64, saturation: 0.3, variety: 3 } },
  { id: "fresh-lime", label: "Fresh lime", palette: { hue: 75, lightness: 0.66, saturation: 0.52, variety: 3 } },
  { id: "ember", label: "Ember", palette: { hue: 15, lightness: 0.44, saturation: 0.66, variety: 2 } },
  { id: "dusty-rose", label: "Dusty rose", palette: { hue: 315, lightness: 0.6, saturation: 0.16, variety: 2 } },
  { id: "storm-grey", label: "Storm grey", palette: { hue: null, lightness: 0.42, saturation: 0.08, variety: 1 } },
  { id: "copper-dusk", label: "Copper dusk", palette: { hue: 30, lightness: 0.4, saturation: 0.5, variety: 2 } },
  { id: "jade-bloom", label: "Jade bloom", palette: { hue: 135, lightness: 0.52, saturation: 0.46, variety: 4 } },
  { id: "ice-violet", label: "Ice violet", palette: { hue: 255, lightness: 0.76, saturation: 0.26, variety: 2 } },
] as const;

export type ResolvedLook = {
  id: string;
  label: string;
  /** The avatar hue, or null for the "auto" (id-derived) colour. */
  hue: number | null;
  /** The appearance line the gallery fills in, identical in form to a read image's. */
  appearance: string;
  traits: string[];
  signals: ImageSignals;
};

/** A preset resolved through the shared palette mapping: look, words and behaviour in one object. */
export function resolveLook(preset: LookPreset): ResolvedLook {
  const read = traitsFromPalette(preset.palette);
  return { id: preset.id, label: preset.label, hue: read.hue, appearance: read.descriptor, traits: read.traits, signals: read.signals };
}

/** The whole gallery, resolved. Cheap and pure, so a server component can map straight over it. */
export const LOOK_GALLERY: readonly ResolvedLook[] = LOOK_PRESETS.map(resolveLook);

export const lookById = (id: string): ResolvedLook | undefined => LOOK_GALLERY.find((l) => l.id === id);
