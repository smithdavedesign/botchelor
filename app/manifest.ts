import type { MetadataRoute } from "next";
import { APP_ICONS, APP_NAME, PAPER_LIGHT } from "@/lib/pwa";

/**
 * The web app manifest (/manifest.webmanifest, lib/pwa.ts): Botchelor installs as an app that opens on the show's home
 * page in its own window. On an iPhone that's also what lets notifications through (web push needs the Home Screen app).
 * docs/brand.md's paper for the colours, and the PG heart tile for the icons.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: "A blind-date show for original characters and their AI agents: send yours on a date nobody can steer.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: PAPER_LIGHT,
    theme_color: PAPER_LIGHT,
    lang: "en",
    dir: "ltr",
    categories: ["entertainment", "games", "social"],
    icons: APP_ICONS.map((icon) => ({ ...icon })),
  };
}
