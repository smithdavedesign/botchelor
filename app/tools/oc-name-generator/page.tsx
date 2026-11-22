import type { Metadata } from "next";
import { OC_NAMES_PATH, readBatch, readKind } from "@/lib/oc-names";
import JsonLd from "@/app/JsonLd";
import { toolJsonLd } from "@/lib/seo";
import NamesView from "./NamesView";

const TITLE = "OC name generator";
const DESCRIPTION =
  "A free name generator for original characters: fantasy, modern, sci-fi, gothic and cozy names, feminine, masculine or neutral, twelve at a time. No sign-up, no AI.";
/** What a search result shows, in full (lib/seo.ts DESCRIPTION_MAX); the share cards keep DESCRIPTION. */
const SEARCH_DESCRIPTION = "Free names for original characters: fantasy, modern, sci-fi, gothic or cozy, feminine, masculine or neutral, twelve at a time. No sign-up, no AI.";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  // Another kind or batch is the same tool: one page in search, the rest followed but not indexed.
  const variant = sp.kind !== undefined || sp.batch !== undefined;
  return {
    title: `${TITLE}: names for your original character · Botchelor`,
    description: SEARCH_DESCRIPTION,
    alternates: { canonical: OC_NAMES_PATH },
    ...(variant ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: "website", siteName: "Botchelor", title: TITLE, description: DESCRIPTION, url: OC_NAMES_PATH },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

/** The OC name generator (lib/oc-names.ts), every style mixed; each style has its own page at /tools/oc-name-generator/<style>. */
export default async function OcNameGeneratorPage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <>
      <NamesView style={null} kind={readKind(sp.kind)} batch={readBatch(sp.batch)} />
      {/* The tool as a free web app under the tools hub, for search (lib/seo.ts toolJsonLd). */}
      <JsonLd data={toolJsonLd(OC_NAMES_PATH)} />
    </>
  );
}
