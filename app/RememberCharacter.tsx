"use client";

import { useEffect } from "react";
import { rememberCharacterInBrowser } from "@/lib/current-character";

/**
 * Remembers the character this page is about (lib/current-character.ts), so the next door (the Studio, Matches, the
 * deck, the Characters cards) opens on the same one, and tells the header's face (app/CharacterPicker.tsx), which
 * follows. A cookie in this browser, written here because a page can't set one while it renders. Renders nothing; a
 * page with no character picked doesn't mount it, so "All" on Chat never forgets the last.
 */
export default function RememberCharacter({ id }: { id: string }) {
  useEffect(() => rememberCharacterInBrowser(id), [id]);
  return null;
}
