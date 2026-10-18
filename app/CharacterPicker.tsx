"use client";

import { useRouter } from "next/navigation";
import { shortName } from "@/lib/names";

/**
 * "Whose matches": a drop-down of the viewer's characters that opens the same page for the one picked
 * (/matches, /swipe and a thread's way back). Shown only when there's more than one to pick from.
 */
export default function CharacterPicker({
  characters,
  current,
  href,
  label = "Character",
}: {
  characters: { id: string; name: string }[];
  current: string;
  /** Where each character's page is, e.g. `/matches?character=` (the id is appended). */
  href: string;
  label?: string;
}) {
  const router = useRouter();
  if (characters.length < 2) return null;
  return (
    <label className="character-picker">
      <span className="sr-only">{label}</span>
      <select value={current} onChange={(e) => router.push(`${href}${encodeURIComponent(e.target.value)}`)}>
        {characters.map((c) => (
          <option key={c.id} value={c.id}>
            {shortName(c.name)}
          </option>
        ))}
      </select>
    </label>
  );
}
