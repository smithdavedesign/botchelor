#!/usr/bin/env node
/**
 * npm run seed: fills the local dev database (.data/pglite) with a believable season — five OCs across
 * five creators, dates with varied endings, a friend league with predictions, a closed podium feel, and
 * matchmaker proposals — so `npm run dev` shows a lively app instead of an empty one.
 *
 * It drives the production build with the stub showrunner (no model key needed) over HTTP, exactly as a
 * browser would, then stops. To seed a remote database instead, export DATABASE_URL and run this; the
 * app will use it. Safe to re-run (it adds more data).
 */
import { join } from "node:path";
import { appEnv, build, freePort, ROOT, seedDataset, startApp, startShowrunner, stopApp } from "./harness.mjs";

const DATA_DIR = process.env.DATABASE_URL ? "" : join(ROOT, ".data", "pglite");

async function main() {
  if (process.env.SEED_SKIP_BUILD !== "1") build();
  const showrunner = await startShowrunner();
  const port = await freePort();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  // If a real DATABASE_URL is set, let the app use it rather than the local file database.
  if (process.env.DATABASE_URL) env.DATABASE_URL = process.env.DATABASE_URL;
  let app;
  try {
    app = await startApp(port, env);
    console.log("Seeding a demo season…");
    const r = await seedDataset(app.base);
    console.log(`Seeded ${r.chars.length} characters, ${r.episodes.length} dates (endings seen: ${r.endingsSeen.join(", ")}), and the "${r.league.name}" league.`);
    console.log(process.env.DATABASE_URL ? "Seeded the configured DATABASE_URL." : "Run `npm run dev` to see it at http://localhost:3000.");
  } finally {
    await stopApp(app);
    showrunner.close();
  }
}

main().catch((err) => {
  console.error(`seed failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
