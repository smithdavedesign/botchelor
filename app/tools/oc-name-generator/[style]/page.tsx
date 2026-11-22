import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OC_NAME_STYLE_INFO, OC_NAME_STYLES, ocNamesHref, readBatch, readKind, readStyle } from "@/lib/oc-names";
import NamesView from "../NamesView";

type Props = {
  params: Promise<{ style: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export function generateStaticParams() {
  return OC_NAME_STYLES.map((style) => ({ style }));
}
export const dynamicParams = false;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const style = readStyle((await params).style);
  // No such style: the not-found page's title and robots, not the home page's (its page turns it away below too).
  if (!style) notFound();
  const sp = await searchParams;
  const { title, blurb } = OC_NAME_STYLE_INFO[style];
  const path = ocNamesHref(style);
  const description = `${blurb} A free ${title.toLowerCase()}, twelve names at a time. No sign-up, no AI.`;
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

/** One style's names (lib/oc-names.ts): a page of its own for people searching "<style> OC name generator". */
export default async function OcNameStylePage({ params, searchParams }: Props) {
  const style = readStyle((await params).style);
  if (!style) notFound();
  const sp = await searchParams;
  return <NamesView style={style} kind={readKind(sp.kind)} batch={readBatch(sp.batch)} />;
}
