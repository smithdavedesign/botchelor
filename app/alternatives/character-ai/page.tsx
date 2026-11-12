import type { Metadata } from "next";
import AlternativePage from "@/app/alternatives/AlternativePage";
import { alternativeBySlug } from "@/lib/alternatives";
import { CHARACTER_AI_ALTERNATIVE_PATH } from "@/lib/import-character";
import { pageMetadata } from "@/lib/seo";

const ALT = alternativeBySlug("character-ai")!;

export const metadata: Metadata = pageMetadata({ title: ALT.title, description: ALT.description, path: CHARACTER_AI_ALTERNATIVE_PATH });

/**
 * The first search landing (#1391, 2026-11-08), now one of several from the same template (lib/alternatives.ts,
 * app/alternatives/AlternativePage.tsx): the same words, the same address.
 */
export default function CharacterAiAlternativePage() {
  return <AlternativePage alt={ALT} />;
}
