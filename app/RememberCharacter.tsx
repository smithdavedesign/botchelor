"use client";

import { useEffect } from "react";
import { CHARACTER_COOKIE, CHARACTER_COOKIE_MAX_AGE } from "@/lib/current-character";

/**
 * Remembers the character this page is about (lib/current-character.ts), so the next door (Chat, the Studio, Matches,
 * the swipe deck) opens on the same one. A cookie in this browser, written here because a page can't set one while it
 * renders. Renders nothing; a page with no character picked doesn't mount it, so "All" on Chat never forgets the last.
 */
export default function RememberCharacter({ id }: { id: string }) {
  useEffect(() => {
    try {
      document.cookie = `${CHARACTER_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${CHARACTER_COOKIE_MAX_AGE}; samesite=lax`;
    } catch {
      // No cookies here: every page still has its own default.
    }
  }, [id]);
  return null;
}
