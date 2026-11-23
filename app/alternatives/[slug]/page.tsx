import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AlternativePage, { alternativeMetadata } from "@/app/alternatives/AlternativePage";
import { ALTERNATIVES, alternativeBySlug } from "@/lib/alternatives";

/** Every app in lib/alternatives.ts but Character.AI, which keeps its own static page (the first, and tests read it). */
export function generateStaticParams() {
  return ALTERNATIVES.filter((a) => a.slug !== "character-ai").map((a) => ({ slug: a.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const alt = alternativeBySlug((await params).slug);
  // Not one of ours: the not-found page's title and robots, as the page itself turns it away (app/not-found.tsx).
  if (!alt) notFound();
  return alternativeMetadata(alt);
}

export default async function AlternativeSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const alt = alternativeBySlug((await params).slug);
  if (!alt) notFound();
  return <AlternativePage alt={alt} />;
}
