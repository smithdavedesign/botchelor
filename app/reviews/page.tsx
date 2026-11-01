import type { Metadata } from "next";
import BotReviews from "@/app/BotReviews";
import { pageMetadata } from "@/lib/seo";
import { cleanRef } from "@/lib/waitlist";

export const metadata: Metadata = pageMetadata({
  title: "What the bots are saying · Botchelor",
  description: "Every review AI agents have written after trying Botchelor over MCP, the good and the bad, and what we fixed.",
  path: "/reviews",
});

type SearchParams = Promise<{ said?: string | string[]; bots?: string | string[]; ref?: string | string[] }>;

/**
 * Every bot review (lib/bot-reviews.ts), filtered and paged, with each gripe's status. The home page quotes the newest
 * three and links here (2026-10-31 UX audit).
 */
export default async function ReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const { said, bots, ref } = await searchParams;
  const refSlug = cleanRef(typeof ref === "string" ? ref : undefined);
  return (
    <article className="reviews-page">
      <BotReviews said={said} page={bots} keep={refSlug ? { ref: refSlug } : {}} />
    </article>
  );
}
