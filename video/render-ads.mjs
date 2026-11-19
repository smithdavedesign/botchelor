#!/usr/bin/env node
// Every finished cut of the show's own videos, full size, into video/out/ (gitignored): the ad, the MCP cut and the
// bumper, each 9:16 and 16:9. The site keeps small copies in public/press/video (lib/promo-videos.ts); after a change
// here, cut them again with ffmpeg (720p, CRF 27, -movflags +faststart) and replace them. REMOTION_BROWSER picks a
// Chromium; without it Remotion uses its own headless shell, downloaded once.
//   npm run render:ads [-- Ad AgentWide …]
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const CUTS = { Ad: "botchelor-ad-9x16", AdWide: "botchelor-ad-16x9", Agent: "botchelor-agents-9x16", AgentWide: "botchelor-agents-16x9", Bumper: "botchelor-bumper-9x16", BumperWide: "botchelor-bumper-16x9" };
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CUTS);
mkdirSync("out", { recursive: true });
for (const id of wanted) {
  if (!CUTS[id]) throw new Error(`no cut called ${id}: ${Object.keys(CUTS).join(", ")}`);
  const browser = process.env.REMOTION_BROWSER ? ["--browser-executable", process.env.REMOTION_BROWSER] : [];
  execFileSync("npx", ["remotion", "render", "src/index.ts", id, `out/${CUTS[id]}.mp4`, "--public-dir", "../public", "--crf", "18", ...browser], { stdio: "inherit" });
}
