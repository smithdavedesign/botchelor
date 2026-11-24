/**
 * The show's own videos (2026-11-18): the Rose Ceremony ad, the MCP cut and the bumper, made in video/ (Remotion) and
 * kept small in public/press/video for the site (720p, H.264, faststart). The full-size cuts are rendered on the Mac
 * (`npm run render:ads` in video/). The press kit offers them to download; /agents plays the MCP cut; the home hero
 * loops the ad when nothing has aired to show.
 */
import type { Promo } from "@/app/PromoVideo";

const v = (name: string, width: number, height: number, label: string): Promo => ({
  src: `/press/video/${name}.mp4`,
  poster: `/press/video/${name}.jpg`,
  width,
  height,
  label,
});

export const PROMO = {
  adWide: v("botchelor-ad-16x9", 1280, 720, "Botchelor's 20-second ad: two contestants, three lines of their real date, and how does it end?"),
  adTall: v("botchelor-ad-9x16", 720, 1280, "Botchelor's 20-second ad, upright for phones"),
  agentsWide: v("botchelor-agents-16x9", 1280, 720, "An agent connects to Botchelor's MCP server, creates a character and sends it on a date"),
  bumperTall: v("botchelor-bumper-9x16", 720, 1280, "A six-second Botchelor bumper"),
  /** The making of (2026-11-23, app/making-of): the site growing day by day, from its pull requests' screenshots. */
  makingOf: v("botchelor-making-of-16x9", 1280, 720, "The making of Botchelor: the site on a laptop and a phone as it grew, day by day, with each day's pull request count"),
  /** The home hero's loop: the ad, small and muted (lib/home-clip.ts's sizes). */
  homeLoop: v("botchelor-ad-loop", 480, 854, "Botchelor's ad"),
} as const;

/** What the press kit offers to download, in order. */
export const PRESS_VIDEOS: { video: Promo; title: string; note: string }[] = [
  { video: PROMO.adWide, title: "The ad (16:9)", note: "20 seconds, 1280×720: for YouTube and articles." },
  { video: PROMO.adTall, title: "The ad (9:16)", note: "20 seconds, 720×1280: for TikTok, Reels and Shorts." },
  { video: PROMO.agentsWide, title: "For AI agents (16:9)", note: "20 seconds: an agent books a date over MCP." },
  { video: PROMO.bumperTall, title: "Bumper (9:16)", note: "6 seconds: the name, a verdict, the address." },
  { video: PROMO.makingOf, title: "The making of (16:9)", note: "A time-lapse of the site being built, day by day." },
];
