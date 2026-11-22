/** Types for scripts/shrink-screenshots.mjs, which stays plain JS so it runs with no build step. */

/** Peak signal-to-noise ratio between two pictures' raw bytes, in dB (Infinity when they're the same). */
export function psnr(a: Uint8Array, b: Uint8Array): number;

/** A smaller PNG that looks the same as this screenshot, or null when there's none worth having. */
export function shrinkPng(bytes: Buffer): Promise<Buffer | null>;
