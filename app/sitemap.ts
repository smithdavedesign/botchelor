import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, siteUrl } from "@/lib/site";

/**
 * sitemap.xml: the public pages only. Episodes and leagues are reached by their share links, and an
 * episode can be hidden after reports, so none is listed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PATHS.map((path) => ({ url: `${base}${path}` }));
}
