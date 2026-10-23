import type { Metadata } from "next";

/**
 * After Dark's pages say they're adult (terms review, 2026-10-22; docs/after-dark.md "Terms fixes"): the plain
 * `<meta name="rating" content="adult">`, and the RTA label (rtalabel.org) that parental controls and filters read.
 * app/after-dark/layout.tsx and app/admin/after-dark/layout.tsx set them through the metadata API's `other`, which Next
 * merges key by key, so a page's own `other` adds to them.
 */
export const ADULT_RATING_META: NonNullable<Metadata["other"]> = {
  rating: "adult",
  RATING: "RTA-5042-1996-1400-1577-RTA",
};
