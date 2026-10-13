import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/** robots.txt: the pages are public; the JSON API isn't for crawlers. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
