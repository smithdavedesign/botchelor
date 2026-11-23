import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PLACE_STYLE_INFO, PLACE_STYLES, placeNamesHref, readPlaceBatch, readPlaceKind, readPlaceStyle } from "@/lib/place-names";
import PlacesView from "../PlacesView";

type Props = {
  params: Promise<{ style: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function generateStaticParams() {
  return PLACE_STYLES.map((style) => ({ style }));
}
export const dynamicParams = false;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const style = readPlaceStyle((await params).style);
  // No such style: the not-found page's title and robots, not the home page's (its page turns it away below too).
  if (!style) notFound();
  const sp = await searchParams;
  const { title, blurb } = PLACE_STYLE_INFO[style];
  const path = placeNamesHref(style);
  const description = `${blurb} A free ${title.toLowerCase()}, twelve places at a time. No sign-up, no AI.`;
  const variant = sp.kind !== undefined || sp.batch !== undefined;
  return {
    title: `${title} · Botchelor`,
    description,
    alternates: { canonical: path },
    ...(variant ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: "website", siteName: "Botchelor", title, description, url: path },
    twitter: { card: "summary_large_image", title, description },
  };
}

/** One style's places (lib/place-names.ts): a page of its own for people searching "<style> place name generator". */
export default async function PlaceNameStylePage({ params, searchParams }: Props) {
  const style = readPlaceStyle((await params).style);
  if (!style) notFound();
  const sp = await searchParams;
  return <PlacesView style={style} kind={readPlaceKind(sp.kind)} batch={readPlaceBatch(sp.batch)} />;
}
