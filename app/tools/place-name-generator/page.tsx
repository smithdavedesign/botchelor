import type { Metadata } from "next";
import { PLACE_NAMES_PATH, readPlaceBatch, readPlaceKind } from "@/lib/place-names";
import JsonLd from "@/app/JsonLd";
import { toolJsonLd } from "@/lib/seo";
import PlacesView from "./PlacesView";

const TITLE = "Place name generator";
const DESCRIPTION =
  "A free place name generator for worldbuilding: towns, forests, kingdoms, planets and taverns in fantasy, modern, sci-fi, gothic and cozy styles, twelve at a time. No sign-up, no AI.";
/** What a search result shows, in full (lib/seo.ts DESCRIPTION_MAX); the share cards keep DESCRIPTION. */
const SEARCH_DESCRIPTION = "Free place names for worldbuilding: towns, wilds, kingdoms and taverns in fantasy, modern, sci-fi, gothic or cozy. Twelve at a time, no sign-up, no AI.";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  // Another kind or batch is the same tool: one page in search, the rest followed but not indexed.
  const variant = sp.kind !== undefined || sp.batch !== undefined;
  return {
    title: `${TITLE}: towns, kingdoms and taverns for your world · Botchelor`,
    description: SEARCH_DESCRIPTION,
    alternates: { canonical: PLACE_NAMES_PATH },
    ...(variant ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: "website", siteName: "Botchelor", title: TITLE, description: DESCRIPTION, url: PLACE_NAMES_PATH },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

/** The place name generator (lib/place-names.ts), every style mixed; each style has its own page at /tools/place-name-generator/<style>. */
export default async function PlaceNameGeneratorPage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <>
      <PlacesView style={null} kind={readPlaceKind(sp.kind)} batch={readPlaceBatch(sp.batch)} />
      {/* The tool as a free web app under the tools hub, for search (lib/seo.ts toolJsonLd). */}
      <JsonLd data={toolJsonLd(PLACE_NAMES_PATH)} />
    </>
  );
}
