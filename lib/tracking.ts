/**
 * Performance tracking: which analytics/verification tags the site renders, all switched on by environment
 * variables so nothing ships until an ID exists and every tag can be turned off without a deploy of code.
 *
 *  - Vercel Web Analytics + Speed Insights: always on in production. Cookieless, no personal data, $0 on the
 *    plan, and the page-view / Core Web Vitals numbers land in the Vercel dashboard.
 *  - Google Tag Manager (NEXT_PUBLIC_GTM_ID, "GTM-XXXX"): the container that GA4 and any later tags hang off.
 *  - Search Console / Bing Webmaster verification (GOOGLE_SITE_VERIFICATION, comma-separated for several tokens;
 *    BING_SITE_VERIFICATION): meta tags
 *    that prove ownership so the search consoles report impressions, clicks and indexing.
 *
 * Server-side, the agent funnel (an AI fetching /llms.txt → connecting to MCP → creating a character → going on
 * a date) is tracked in lib/analytics.ts events, which no browser tag can see.
 */

export type TrackingConfig = {
  gtmId: string | null;
  vercelAnalytics: boolean;
  verification: { google?: string | string[]; other?: Record<string, string> } | undefined;
};

const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/;

export function trackingConfig(env: Record<string, string | undefined> = process.env): TrackingConfig {
  const gtm = env.NEXT_PUBLIC_GTM_ID?.trim();
  // Comma-separated: each Search Console owner/property verifies with its own token, and removing an old token
  // un-verifies it, so they accumulate.
  const googleTokens = (env.GOOGLE_SITE_VERIFICATION ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const google = googleTokens.length > 1 ? googleTokens : googleTokens[0];
  const bing = env.BING_SITE_VERIFICATION?.trim();
  const verification =
    google || bing ? { ...(google ? { google } : {}), ...(bing ? { other: { "msvalidate.01": bing } } : {}) } : undefined;
  return {
    // Only a well-formed container id renders a tag: a typo'd env var can't inject arbitrary script.
    gtmId: gtm && GTM_ID.test(gtm) ? gtm : null,
    // Vercel sets VERCEL_ENV; analytics only count real production traffic, not previews or local runs.
    vercelAnalytics: env.VERCEL_ENV === "production",
    verification,
  };
}

/**
 * A link handed to AI agents (llms.txt, llms-full.txt, the MCP discovery doc), tagged so a visit that started
 * from an agent reading our docs shows up as its own source in analytics: utm_source=<doc>, utm_medium=ai_agent.
 */
export function agentLink(base: string, path: string, source: string): string {
  const url = new URL(path, base);
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", "ai_agent");
  return url.toString();
}
