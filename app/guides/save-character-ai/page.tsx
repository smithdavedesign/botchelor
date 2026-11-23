import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CAI_GUIDE_PATH, caiGuideOn } from "@/lib/cai-guide";
import { importMemoriesOn } from "@/lib/import-history";
import { pageMetadata } from "@/lib/seo";
import CaiGuide from "./CaiGuide";

/**
 * The sale box hides itself from its `until` day (lib/cai-guide.ts CAI_GUIDE_SALE_UNTIL). The page renders per request
 * (the layout reads cookies); if it is ever built ahead instead, it's built again every hour, so the box still goes
 * with no deploy. Like app/alternatives/character-ai.
 */
export const revalidate = 3600;

export const metadata: Metadata = pageMetadata({
  title: "How to save your Character.AI characters and chats · Botchelor",
  description:
    "Request your Character.AI data export now (it can take 3–4 weeks), copy each character's fields by hand, and bring them to any app, including Botchelor.",
  path: CAI_GUIDE_PATH,
});

/**
 * "How to save your Character.AI characters and chats" (2026-11-23, lib/cai-guide.ts): a search landing that answers
 * the question, in Character.AI's own words, and brings the character over. Open without the 18+ gate (proxy.ts
 * UNGATED_PREFIXES "/guides/"). CAI_GUIDE=0 makes it a 404.
 */
export default function SaveCharacterAiGuidePage() {
  if (!caiGuideOn()) notFound();
  return <CaiGuide history={importMemoriesOn()} />;
}
