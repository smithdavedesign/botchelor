import type { Metadata } from "next";
import AlternativePage, { alternativeMetadata } from "@/app/alternatives/AlternativePage";
import { alternativeBySlug } from "@/lib/alternatives";

const ALT = alternativeBySlug("character-ai")!;

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
