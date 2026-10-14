#!/usr/bin/env node
/**
 * npm run portraits — the offline portrait batch (docs/image-strategy.md).
 *
 * Builds one prompt per house character and per date venue straight from lib/house.ts and
 * lib/venues.ts (the seed data is the input, so the cast and the set can never drift from their
 * pictures), generates them with a local image model, records every result in the character_assets
 * ledger as PENDING, and writes a contact sheet for a human to review.
 *
 * It never approves anything. Generated files land in .data/portraits/ (gitignored, not servable);
 * only `--approve` copies a file into public/cast/ and flips its row to approved, and that is David's
 * call. Nothing here reaches the live site on its own.
 *
 *   npm run portraits                 # plan: write the manifest and the prompts, no model needed
 *   npm run portraits -- --generate   # also run the model for every job that has no file yet
 *   npm run portraits -- --record     # record generated files in the ledger as pending
 *   npm run portraits -- --sheet      # (re)build the contact sheet
 *   npm run portraits -- --approve house-rafe venue-rooftop_bar
 *
 * The model is whatever PORTRAIT_CMD names, so the backend is swappable:
 *   PORTRAIT_CMD='~/ai-stack/image-gen/.venv/bin/mflux-generate-z-image-turbo --quantize 4 --low-ram \
 *     --steps 8 --seed {seed} --width {width} --height {height} --negative-prompt {negative} \
 *     --prompt {prompt} --output {out}'
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { buildBatch } from "./prompts.mjs";
import { ROOT } from "./harness.mjs";

const OUT_DIR = join(ROOT, ".data", "portraits");
const PUBLIC_DIR = join(ROOT, "public", "cast");
/**
 * Where an approved file is served from: a WebP next to the app, so twenty-five images cost a few MB in
 * the repo rather than ~17 MB of PNG. Recorded on the row at generation time; only approval writes it.
 */
const servedName = (file) => `${basename(file, ".png")}.webp`;
const servedUrl = (file) => `/cast/${servedName(file)}`;
const DIMS = { "3:4": { width: 768, height: 1024 }, "16:9": { width: 1024, height: 576 } };

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--") && !a.startsWith("--only=")));
const names = process.argv.slice(2).filter((a) => !a.startsWith("--"));
/** `--only=house-rafe,house-nell`: limit generation to a few jobs, to test a prompt before a full batch. */
const only = process.argv.slice(2).find((a) => a.startsWith("--only="))?.slice(7).split(",").filter(Boolean) ?? null;

async function loadBatch() {
  const [house, venues] = await Promise.all([import("../lib/house.ts"), import("../lib/venues.ts")]);
  return buildBatch({ house: house.ALL_HOUSE_CHARACTERS, venues: venues.DATE_VENUES });
}

/** The same database the app uses: the configured one, or the local PGlite file. */
async function openDb() {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    return { query: (sql, params) => pool.query(sql, params), close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(join(ROOT, ".data", "pglite"));
  return { query: (sql, params) => pg.query(sql, params), close: () => pg.close() };
}

/** The ledger has to exist already: its DDL lives in lib/db.ts and runs on the app's first query. */
async function requireLedger(db) {
  const { rows } = await db.query("select to_regclass('character_assets') is not null as ok");
  if (!rows[0]?.ok) throw new Error("no character_assets table: run `npm run seed` (or start the app) once first");
}

function planFile(batch) {
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = batch.map((job) => ({ ...job, out: join(OUT_DIR, job.file) }));
  writeFileSync(join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/** Runs PORTRAIT_CMD once per job, sequentially — a 16GB machine cannot hold two image models at once. */
async function generate(manifest) {
  if (only) manifest = manifest.filter((job) => only.includes(job.character_id ?? "") || only.includes(job.id));
  const template = process.env.PORTRAIT_CMD;
  if (!template) throw new Error("set PORTRAIT_CMD to the image-model command (see the header of this file)");
  let made = 0;
  let failed = 0;
  for (const job of manifest) {
    if (existsSync(job.out)) {
      console.log(`· ${job.file} exists, skipping`);
      continue;
    }
    const { width, height } = DIMS[job.aspect];
    // Tokenised, then spawned without a shell: a prompt is data, never a command line to be parsed.
    const parts = template.trim().split(/\s+/);
    const argv = parts.map((part) =>
      part
        .replace("{prompt}", job.prompt)
        .replace("{out}", job.out)
        .replace("{seed}", String(job.seed))
        .replace("{negative}", job.negative ?? "")
        .replace("{width}", String(width))
        .replace("{height}", String(height)),
    );
    const [cmd, ...args] = argv;
    const started = Date.now();
    const code = await new Promise((done) => {
      const child = spawn(cmd.replace(/^~/, process.env.HOME ?? "~"), args, { stdio: ["ignore", "ignore", "pipe"] });
      let err = "";
      child.stderr.on("data", (d) => (err += d));
      child.on("close", (c) => {
        if (c !== 0) console.error(`  ${job.file}: exit ${c}\n  ${err.trim().split("\n").slice(-3).join("\n  ")}`);
        done(c);
      });
      child.on("error", (e) => {
        console.error(`  ${job.file}: ${e.message}`);
        done(1);
      });
    });
    if (code === 0 && existsSync(job.out)) {
      made++;
      console.log(`✓ ${job.file}  ${Math.round((Date.now() - started) / 1000)}s  ${job.label}`);
    } else {
      failed++;
    }
  }
  return { made, failed };
}

/**
 * Records every generated file as a pending asset: which model made it, from which prompt and version,
 * with which seed. Idempotent on the served url, so re-running adds nothing.
 */
async function record(db, manifest) {
  const model = process.env.PORTRAIT_MODEL;
  if (!model) throw new Error("set PORTRAIT_MODEL to the generator's name and version (the ledger requires it)");
  let added = 0;
  for (const job of manifest) {
    if (!existsSync(job.out)) continue;
    const url = servedUrl(job.file);
    const { rows } = await db.query("select id from character_assets where url = $1", [url]);
    if (rows[0]) continue;
    await db.query(
      `insert into character_assets (id, character_id, kind, source_type, source_model, prompt, prompt_version,
                                     seed, url, review_status)
       values ($1, $2, $3, 'generated', $4, $5, $6, $7, $8, 'pending')`,
      [crypto.randomUUID(), job.character_id, job.kind, model, job.prompt, job.prompt_version, job.seed, url],
    );
    added++;
  }
  return added;
}

/** A contact sheet for review: every pending image, what made it, and the command to approve it. */
async function sheet(db, manifest) {
  const { rows } = await db.query(
    "select id, character_id, kind, url, review_status, source_model, seed::text as seed from character_assets order by kind, character_id",
  );
  const byUrl = new Map(rows.map((r) => [r.url, r]));
  const cards = manifest
    .filter((job) => existsSync(job.out))
    .map((job) => {
      const row = byUrl.get(servedUrl(job.file));
      const name = job.character_id ?? basename(job.file, ".png");
      return `<figure class="${row?.review_status ?? "unrecorded"}">
  <img src="${job.file}" alt="${job.label}" loading="lazy">
  <figcaption>
    <strong>${job.label}</strong>
    <span class="meta">${job.kind} · seed ${job.seed} · ${row?.review_status ?? "not recorded"}${row?.source_model ? ` · ${row.source_model}` : ""}</span>
    <code>npm run portraits -- --approve ${name}</code>
    <details><summary>prompt</summary><pre>${job.prompt.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])}</pre></details>
  </figcaption>
</figure>`;
    })
    .join("\n");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Botchelor portraits — review</title>
<style>
  :root { color-scheme: light dark; --line: #8884; }
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 2rem; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  p.lede { margin: 0 0 2rem; opacity: .75; max-width: 46rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); gap: 1.25rem; }
  figure { margin: 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  figure.approved { outline: 2px solid #19a974; }
  figure.rejected { opacity: .45; }
  img { width: 100%; display: block; background: #8882; }
  figcaption { padding: .6rem .7rem; display: grid; gap: .35rem; }
  .meta { font-size: .78rem; opacity: .7; }
  code { font-size: .74rem; background: #8882; padding: .15rem .35rem; border-radius: 4px; overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; font-size: .72rem; opacity: .8; }
</style></head><body>
<h1>Botchelor portraits — review</h1>
<p class="lede">Every image below is <strong>pending</strong>: recorded in the asset ledger, not served anywhere.
Approving one copies it into <code>public/cast/</code> and flips its row to approved — that is the only step that
publishes it. Reject by simply not approving it (and delete the file to regenerate). Check each for: a plausible
adult, no resemblance to a real person, no franchise character, no text or watermark, and a look that matches the
character sheet.</p>
<div class="grid">
${cards}
</div>
</body></html>`;
  const path = join(OUT_DIR, "index.html");
  writeFileSync(path, html);
  return path;
}

/** David's approval: copy the file where it can be served, then flip the row. Nothing else publishes. */
async function approve(db, manifest, wanted) {
  mkdirSync(PUBLIC_DIR, { recursive: true });
  let ok = 0;
  for (const name of wanted) {
    const job = manifest.find(
      (j) => basename(j.file, ".png") === name || j.id === name || j.character_id === name || `venue-${name}` === basename(j.file, ".png"),
    );
    if (!job) {
      console.error(`· no job called "${name}"`);
      continue;
    }
    if (!existsSync(job.out)) {
      console.error(`· ${name}: nothing generated yet`);
      continue;
    }
    // The ledger row comes first. A file in public/ is servable the moment it lands, so it must never be
    // written for an image the ledger has no record of — an earlier version wrote the file first and
    // left a published path with no approval behind it when the row was missing.
    const { rows } = await db.query(
      "select id, review_status from character_assets where url = $1",
      [servedUrl(job.file)],
    );
    if (!rows[0]) {
      console.error(`· ${name}: no ledger row — run --record first (nothing written to public/)`);
      continue;
    }
    if (rows[0].review_status === "rejected") {
      console.error(`· ${name}: rejected in review — not publishing it`);
      continue;
    }
    const { default: sharp } = await import("sharp");
    await sharp(job.out).webp({ quality: 82, effort: 6 }).toFile(join(PUBLIC_DIR, servedName(job.file)));
    // Only once the file exists does the row say so; if the write failed above, the row stays pending.
    await db.query(
      `update character_assets set review_status = 'approved', reviewed_at = now(),
              reviewed_note = coalesce(reviewed_note, $2)
        where id = $1`,
      [rows[0].id, process.env.PORTRAIT_REVIEW_NOTE || "approved from the contact sheet"],
    );
    ok++;
    console.log(`✓ approved ${job.file} → public/cast/${servedName(job.file)}`);
  }
  return ok;
}

async function main() {
  const batch = await loadBatch();
  const manifest = planFile(batch);
  const portraits = manifest.filter((j) => j.kind === "portrait").length;
  console.log(`Planned ${manifest.length} images: ${portraits} portraits, ${manifest.length - portraits} backdrops.`);
  console.log(`Prompts and manifest: ${join(OUT_DIR, "manifest.json")}`);

  const needsDb = flags.has("--record") || flags.has("--sheet") || flags.has("--approve");
  const db = needsDb ? await openDb() : null;
  try {
    if (db) await requireLedger(db);
    if (flags.has("--generate")) {
      const { made, failed } = await generate(manifest);
      console.log(`Generated ${made}, failed ${failed}.`);
    }
    if (flags.has("--record")) console.log(`Recorded ${await record(db, manifest)} new pending assets.`);
    if (flags.has("--approve")) {
      if (!names.length) throw new Error("--approve needs at least one name, e.g. --approve house-rafe");
      console.log(`Approved ${await approve(db, manifest, names)} of ${names.length}.`);
    }
    if (flags.has("--sheet")) console.log(`Contact sheet: ${await sheet(db, manifest)}`);
    if (!flags.has("--generate") && !needsDb) {
      console.log("Nothing else to do. Add --generate (needs PORTRAIT_CMD), --record, --sheet or --approve.");
    }
  } finally {
    await db?.close();
  }
}

main().catch((err) => {
  console.error(`portraits failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
