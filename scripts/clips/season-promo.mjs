#!/usr/bin/env node
// The season's promo cuts (David, 2026-11-27, for the Product Hunt launch and December's The Botchelor):
//   cast-reveal.mp4 (9:16) and cast-reveal-wide.mp4 (16:9): "Meet the suitors", the stage, the lead with their rose,
//     each suitor on a card with their bio's first line, everyone under "Who gets the final rose?", the end card
//     (video/src/CastReveal.tsx). Before the 1st it shows casting's top of the vote instead of the suitors.
//   trailer/ (with --trailer <episode_id>): that date as the branded clip (scripts/clips/branded-clip.mjs), its end card
//     the season's: give it the pilot (Sunday's "meet the lead" date) once it has aired.
// Reads only public JSON: GET /api/seasons/<slug>/cast and the episode's. David posts; this never does.
//   node scripts/clips/season-promo.mjs [december-2026] [--trailer <episode_id>] [--silent] [--only cast|trailer]
//   Out: CLIPS_DIR/season/<slug>/ (CLIPS_DIR default ~/BotchelorClips). The first run installs video/'s packages.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { VIDEO_DIR, brandedClip } from "./branded-clip.mjs";

const COUNT = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** The slug of next month's season ("december-2026") on the 20th or later, else this month's (pure). */
export function defaultSlug(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (now.getUTCDate() >= 20 ? 1 : 0), 1));
  return `${d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toLowerCase()}-${d.getUTCFullYear()}`;
}

/** A face's picture for the video (pure): a public/ path for the show's own art, else the site's full address. */
export function imageOf(path, base) {
  if (!path) return null;
  return path.startsWith("/cast/") ? path.slice(1) : new URL(path, base).href;
}

/** "Starts Tuesday, December 1", or "Night 5 of 31" once it runs (pure). */
export function clockOf(season) {
  if (season.phase === "preseason") {
    const day = new Date(`${season.id}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
    return `Starts ${day}`;
  }
  return season.arc ? `Night ${season.arc.night} of ${season.arc.nights}` : "On now";
}

/** The cast reveal's props from GET /api/seasons/<slug>/cast (pure). */
export function castProps(cast, base) {
  const s = cast.season;
  const member = (c) => ({ name: c.name, line: c.line ?? "", image: imageOf(c.rose ?? c.portrait, base), hue: c.hue ?? null });
  const short = s.path.replace(/^\/seasons\//, "").replace(/-\d{4}$/, "");
  return {
    kicker: `Season ${s.number} · ${s.month}`,
    title: s.title,
    sub: /botchelor/i.test(s.title) ? `One lead. ${COUNT[s.places] ?? s.places} suitors. A rose ceremony every Sunday.` : s.pitch,
    lead: cast.lead ? member(cast.lead) : null,
    suitors: cast.faces.slice(0, 6).map(member),
    facesAre: cast.faces_are,
    clock: clockOf(s),
    url: s.month === "December" ? `botchelor.com/${short}` : `botchelor.com${s.path}`,
  };
}

/** The trailer's end card: the season, not the site (pure). */
export function trailerCard(props) {
  return { chip: `${props.title}: the pilot`, endLines: [`${props.title}.`, `${props.clock}.`, "Who gets the rose?"], url: props.url, small: "Vote who goes home · call every date · free" };
}

/** The caption to post with the cast reveal (pure). */
export function castCaption(props, base, path) {
  const names = props.suitors.map((s) => s.name.split(" ")[0]).join(", ");
  return [
    `${props.kicker}: ${props.title}. ${props.lead ? `${props.lead.name} is the lead.` : ""} ${props.facesAre === "suitors" ? `The suitors: ${names}.` : `Top of casting so far: ${names}.`}`.replace(/\s+/g, " ").trim(),
    "",
    `${props.clock}. Every Sunday the audience sends one home. Who gets the final rose? 🌹`,
    "",
    `${base}${path}`,
    "",
    "AI-generated: original characters, nobody steering.",
    "",
    "#botchelor #originalcharacter #oc #aidating #datingshow",
  ].join("\n") + "\n";
}

function render(composition, props, file, dir) {
  const propsFile = join(dir, `${composition}.json`);
  writeFileSync(propsFile, JSON.stringify(props));
  const browser = process.env.REMOTION_BROWSER ? ["--browser-executable", process.env.REMOTION_BROWSER] : [];
  execFileSync("npx", ["remotion", "render", "src/index.ts", composition, file, "--props", propsFile, "--public-dir", "../public", "--crf", "18", "--log", "error", ...browser], { cwd: VIDEO_DIR, stdio: ["ignore", "inherit", "inherit"] });
}

/** Make the season's cuts. Returns { dir, files }. */
export async function seasonPromo({ slug = defaultSlug(), base = "https://botchelor.com", out, trailer = null, silent = false, only = null, log = console.error }) {
  const res = await fetch(`${base}/api/seasons/${slug}/cast`, { headers: { "user-agent": "botchelor-clip/1.0" } });
  if (!res.ok) throw new Error(`no cast for ${slug}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const cast = await res.json();
  const props = castProps(cast, base);
  if (!existsSync(join(VIDEO_DIR, "node_modules", "remotion"))) execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: VIDEO_DIR, stdio: ["ignore", "inherit", "inherit"] });
  const dir = out ?? join(process.env.CLIPS_DIR || join(homedir(), "BotchelorClips"), "season", slug);
  mkdirSync(dir, { recursive: true });
  const files = [];
  if (only !== "trailer") {
    const tmp = mkdtempSync(join(tmpdir(), "bz-season-"));
    try {
      for (const [composition, name] of [
        ["CastReveal", "cast-reveal.mp4"],
        ["CastRevealWide", "cast-reveal-wide.mp4"],
      ]) {
        log(`rendering ${name}`);
        render(composition, props, join(dir, name), tmp);
        files.push(join(dir, name));
      }
      writeFileSync(join(dir, "caption-cast.txt"), castCaption(props, base, cast.season.path));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  if (trailer && only !== "cast") {
    const made = await brandedClip({ id: trailer, base, out: join(dir, "trailer"), silent, wide: true, card: trailerCard(props), log });
    files.push(...made.files);
  }
  return { dir, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const slug = argv.find((x, i) => !x.startsWith("--") && !["--trailer", "--only"].includes(argv[i - 1])) ?? defaultSlug();
  const base = (process.env.CROWD_BASE || "https://botchelor.com").replace(/\/$/, "");
  seasonPromo({ slug, base, trailer: flag("--trailer"), silent: argv.includes("--silent") || process.env.CLIP_SILENT === "1", only: flag("--only") })
    .then(({ dir, files }) => console.log(`Season promo: ${dir}\n  ${files.map((f) => f.slice(dir.length + 1)).join(", ")}`))
    .catch((err) => {
      console.error(err?.message ?? err);
      process.exit(1);
    });
}
