import { permanentRedirect } from "next/navigation";

/** "Episodes & leagues" merged into Watch (David, 2026-10-18); a viewer's own dates and badges are on /account. */
export default function FeedPage() {
  permanentRedirect("/watch");
}
