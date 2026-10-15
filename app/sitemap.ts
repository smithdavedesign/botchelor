import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";
import { contentSitemap, staticSitemap } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

// Built per request (cached at the CDN below), so a new public episode is findable the same day.
export const dynamic = "force-dynamic";

/**
 * sitemap.xml: the public pages, plus the characters and episodes worth finding (lib/seo.ts). Only public,
 * aired, unhidden episodes and characters that are open to dates or have aired publicly. If the database
 * can't be reached, the static pages still go out: a sitemap must never fail.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  try {
    return [...staticSitemap(base), ...(await contentSitemap(await getDb(), base))];
  } catch {
    return staticSitemap(base);
  }
}
