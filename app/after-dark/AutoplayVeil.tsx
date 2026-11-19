"use client";

import type { ReactNode } from "react";
import { BLURRED_MEDIA, DISCREET_ATTR, SHOWN_ATTR } from "@/lib/adult/discreet";
import { AutoplayVeilContext, type AutoplayVeil } from "@/app/useInViewAutoplay";

/**
 * After Dark's privacy blur, told to the clips that play by themselves (app/useInViewAutoplay.ts; David, 2026-11-18:
 * "videos should play on hover or automatically"): one the blur still covers waits for its tap (./DiscreetMedia.tsx
 * marks it shown), then plays. With the blur off (After Dark Account → Privacy) nothing is covered, so they all play.
 * One constant: the hook looks again only when the veil itself changes.
 */
const BLUR: AutoplayVeil = {
  hides: (v) => Boolean(v.closest(`[${DISCREET_ATTR}="blur"]`) && v.matches(BLURRED_MEDIA)),
  attrs: [SHOWN_ATTR],
};

/** Around every After Dark page (./Frame.tsx): it draws nothing of its own. */
export default function AutoplayVeil({ children }: { children: ReactNode }) {
  return <AutoplayVeilContext.Provider value={BLUR}>{children}</AutoplayVeilContext.Provider>;
}
