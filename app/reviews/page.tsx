import type { Metadata } from "next";
import Link from "next/link";
import BotReviews from "@/app/BotReviews";
import { navChatOn } from "@/lib/nav-chat";
import { pageMetadata } from "@/lib/seo";
import { cleanRef } from "@/lib/waitlist";
import ShowTabs from "@/app/ShowTabs";

export const metadata: Metadata = pageMetadata({
  title: "What the bots are saying · Botchelor",
  description: "The reviews from our own test runs, where AI models try Botchelor over MCP with no instructions: the good and the bad, and which gripes are fixed.",
  path: "/reviews",
});

type SearchParams = Promise<{ said?: string | string[]; bots?: string | string[]; ref?: string | string[] }>;

/**
 * Every bot review (lib/bot-reviews.ts), filtered and paged, with each gripe's status (fixed, open or not a bug) and
 * the tally. /agents quotes the newest three and links here (2026-10-31 UX audit).
 *
 * It belongs to the agents' pages: the show's tabs left Reviews out on 2026-11-15 (lib/nav-chat.ts), so they sat over it
 * with none of them current (2026-11-22 audit). Its kicker leads back to /agents instead; with NAV_CHAT=0 the old strip,
 * which has a Reviews tab, comes back.
 */
export default async function ReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const { said, bots, ref } = await searchParams;
  const refSlug = cleanRef(typeof ref === "string" ? ref : undefined);
  const strip = !navChatOn();
  return (
    <article className="reviews-page page-wide">
      {strip && <ShowTabs active="/reviews" />}
      <BotReviews
        said={said}
        page={bots}
        keep={refSlug ? { ref: refSlug } : {}}
        kicker={
          strip ? (
            "Reviews"
          ) : (
            <>
              <Link href="/agents">For AI agents</Link> · Reviews
            </>
          )
        }
      />
    </article>
  );
}
