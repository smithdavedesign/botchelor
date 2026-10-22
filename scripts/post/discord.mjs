#!/usr/bin/env node
/**
 * Post aired episodes to a Discord webhook.
 *
 * Usage: node scripts/post/discord.mjs [--dry] [--limit N] [--base URL]
 *
 * Env: DISCORD_WEBHOOK_URL (required for a real post), BOTCHELOR_BASE_URL (defaults to https://botchelor.com),
 *      DATABASE_URL for the Postgres connection.
 *
 * Picks up to N public, aired, unhidden episodes with no `last_posted_discord_at`, in airing order, posts them,
 * stamps the row. Idempotent, so a cron re-run never double-posts.
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const BASE = process.env.BOTCHELOR_BASE_URL ?? "https://botchelor.com";
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const args = new Set(process.argv.slice(2));
const dry = args.has("--dry");
const limit = Number((process.argv.find((a, i, l) => l[i - 1] === "--limit") ?? "5")) || 5;

if (!WEBHOOK && !dry) {
  console.log("skipped: no DISCORD_WEBHOOK_URL");
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const ENDING_TAG = {
  second_date: "a second date was planned",
  friends: "just friends",
  disaster: "a disaster",
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function pickEpisodes() {
  const { rows } = await pool.query(
    `select e.id, e.revealed_at, e.ending, e.setup->>'venue' as venue,
            ca.name as a_name, cb.name as b_name
       from episodes e
       join characters ca on ca.id = e.character_a
       join characters cb on cb.id = e.character_b
      where e.visibility = 'public'
        and e.revealed_at is not null
        and coalesce(e.hidden, false) = false
        and e.last_posted_discord_at is null
      order by e.revealed_at asc
      limit $1`,
    [limit],
  );
  return rows;
}

async function post(ep) {
  const tag = ENDING_TAG[ep.ending] ?? ep.ending;
  const url = `${BASE}/episodes/${ep.id}?utm_source=discord&utm_medium=post&utm_campaign=airing`;
  const content = `**${ep.a_name} × ${ep.b_name}** had a blind date at ${ep.venue ?? "the show"} — **${tag}**.\n${url}`;
  const payload = { content, allowed_mentions: { parse: [] } };
  if (dry) {
    console.log("[dry] would post:", content);
    return true;
  }
  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("discord post failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  await pool.query(`update episodes set last_posted_discord_at = now() where id = $1`, [ep.id]);
  console.log("posted", ep.id);
  return true;
}

try {
  const eps = await pickEpisodes();
  if (!eps.length) {
    console.log("nothing to post");
  } else {
    for (const ep of eps) await post(ep);
  }
} finally {
  await pool.end();
}
