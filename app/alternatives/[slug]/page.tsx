import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AlternativePage from "@/app/alternatives/AlternativePage";
import { ALTERNATIVES, alternativeBySlug, alternativePath } from "@/lib/alternatives";
import { pageMetadata } from "@/lib/seo";

/** Every app in lib/alternatives.ts but Character.AI, which keeps its own static page (the first, and tests read it). */
export function generateStaticParams() {
  return ALTERNATIVES.filter((a) => a.slug !== "character-ai").map((a) => ({ slug: a.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const alt = alternativeBySlug((await params).slug);
  if (!alt) return { title: "Botchelor", robots: { index: false, follow: false } };
  return pageMetadata({ title: alt.title, description: alt.description, path: alternativePath(alt.slug) });
}

export default async function AlternativeSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const alt = alternativeBySlug((await params).slug);
  if (!alt) notFound();
  return <AlternativePage alt={alt} />;
}
