import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readTropeBatch, readTropeMood, readTropeNames, TROPE_MOOD_INFO, TROPE_MOODS, tropesHref } from "@/lib/relationship-tropes";
import TropesView from "../TropesView";

type Props = {
  params: Promise<{ mood: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function generateStaticParams() {
  return TROPE_MOODS.map((mood) => ({ mood }));
}
export const dynamicParams = false;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const mood = readTropeMood((await params).mood);
  // No such mood: the not-found page's title and robots, not the home page's (its page turns it away below too).
  if (!mood) notFound();
  const sp = await searchParams;
  const { title, blurb } = TROPE_MOOD_INFO[mood];
  const path = tropesHref(mood);
  const description = `${blurb} Six at a time, no sign-up, no AI.`;
  const variant = Object.keys(sp).length > 0;
  return {
    title: `${title} · Botchelor`,
    description,
    alternates: { canonical: path },
    ...(variant ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: "website", siteName: "Botchelor", title, description, url: path },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** One mood's tropes (lib/relationship-tropes.ts): a page of its own for people searching "<mood> trope generator". */
export default async function RelationshipTropeMoodPage({ params, searchParams }: Props) {
  const mood = readTropeMood((await params).mood);
  if (!mood) notFound();
  const sp = await searchParams;
  return <TropesView mood={mood} batch={readTropeBatch(sp.batch)} names={readTropeNames(sp.a, sp.b)} />;
}
