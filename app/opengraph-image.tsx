import { SHARE_IMAGE_ALT } from "@/lib/seo";
import { SITE_CARD_SIZE, siteCard } from "./site-card";

// The site card at /opengraph-image, rendered once at build time, kept for links shared before 2026-11-22. Pages name
// lib/seo.ts's SHARE_IMAGE instead (the root layout and pageMetadata): the same card at /share-card.png, which the CDN
// keeps (app/share-card.png/route.tsx). Next draws this file only where a level's metadata names no images.
export const alt = SHARE_IMAGE_ALT;
export const size = SITE_CARD_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return siteCard();
}
