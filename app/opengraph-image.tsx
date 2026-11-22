import { SHARE_IMAGE_ALT } from "@/lib/seo";
import { SITE_CARD_SIZE, siteCard } from "./site-card";

// The share card for a page that names none (og:image), rendered once at build time. Every page that sets its own
// openGraph names lib/seo.ts's SHARE_IMAGE instead: the same card at /share-card.png, which the CDN keeps
// (app/share-card.png/route.tsx).
export const alt = SHARE_IMAGE_ALT;
export const size = SITE_CARD_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return siteCard();
}
