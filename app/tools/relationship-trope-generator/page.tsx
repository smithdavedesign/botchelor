import type { Metadata } from "next";
import { readTropeBatch, readTropeNames, TROPES_PATH } from "@/lib/relationship-tropes";
import JsonLd from "@/app/JsonLd";
import { toolJsonLd } from "@/lib/seo";
import TropesView from "./TropesView";

const TITLE = "Relationship trope generator";
const DESCRIPTION =
  "A free relationship trope generator: random romance tropes for your ship, six at a time, sweet, slow burn, angsty, funny or flirty, each with a first scene for your two characters. No sign-up, no AI.";
/** What a search result shows, in full (lib/seo.ts DESCRIPTION_MAX); the share cards keep DESCRIPTION. */
const SEARCH_DESCRIPTION = "Free random romance tropes for your ship: enemies to lovers, fake dating, only one bed and more, each with a first scene. No sign-up, no AI.";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  // Another batch, or two names, is the same tool: one page in search, the rest followed but not indexed.
  const variant = Object.keys(sp).length > 0;
  return {
    title: `${TITLE}: random romance tropes · Botchelor`,
    description: SEARCH_DESCRIPTION,
    alternates: { canonical: TROPES_PATH },
    ...(variant ? { robots: { index: false, follow: true } } : {}),
    openGraph: { type: "website", siteName: "Botchelor", title: TITLE, description: DESCRIPTION, url: TROPES_PATH },
    twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  };
}

/** The relationship trope generator (lib/relationship-tropes.ts), every mood mixed; each mood has its own page at /tools/relationship-trope-generator/<mood>. */
export default async function RelationshipTropeGeneratorPage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <>
      <TropesView mood={null} batch={readTropeBatch(sp.batch)} names={readTropeNames(sp.a, sp.b)} faqData />
      {/* The tool as a free web app under the tools hub, for search (lib/seo.ts toolJsonLd). */}
      <JsonLd data={toolJsonLd(TROPES_PATH)} />
    </>
  );
}
