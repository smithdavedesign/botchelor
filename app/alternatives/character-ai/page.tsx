import type { Metadata } from "next";
import AlternativePage, { alternativeMetadata } from "@/app/alternatives/AlternativePage";
import { alternativeBySlug } from "@/lib/alternatives";

const ALT = alternativeBySlug("character-ai")!;

/**
 * The page reads the date: its dated note and Status fact hide from their `until` day, and the title drops the month
 * once the list is stale (lib/alternative-apps.ts). It renders per request (the layout reads cookies); if it is ever
 * built ahead instead, it's built again every hour, so the switch-over still needs no deploy. Like app/seasons.
 */
export const revalidate = 3600;

/** Per request, like the page: the title names the month the list was checked while it's fresh (lib/alternatives.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return alternativeMetadata(ALT);
}

/**
 * The first search landing (#1391, 2026-11-08), now one of several from the same template (lib/alternatives.ts,
 * app/alternatives/AlternativePage.tsx): the same words, the same address.
 */
export default function CharacterAiAlternativePage() {
  return <AlternativePage alt={ALT} />;
}
