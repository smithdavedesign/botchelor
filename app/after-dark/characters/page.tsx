import { redirect } from "next/navigation";

/**
 * After Dark's Characters page became the Studio door (2026-11-15, app/after-dark/studio/page.tsx): whose Studio, then
 * who's in, nothing dropped. Old links and bookmarks land there.
 */
export default function AfterDarkCharactersPage() {
  redirect("/after-dark/studio");
}
