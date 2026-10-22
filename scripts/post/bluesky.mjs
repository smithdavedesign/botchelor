#!/usr/bin/env node
/**
 * Post aired episodes to Bluesky.
 *
 * Usage: node scripts/post/bluesky.mjs [--dry] [--limit N]
 * Env: BLUESKY_HANDLE, BLUESKY_APP_PASSWORD, BOTCHELOR_BASE_URL, DATABASE_URL.
 *
 * Idempotent via `last_posted_bluesky_at`. On a failure, the row isn't stamped and the next cron tries again.
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const BASE = process.env.BOTCHELOR_BASE_URL ?? "https://botchelor.com";
const HANDLE = process.env.BLUESKY_HANDLE;
const APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD;
const dry = process.argv.includes("--dry");
const limit = Number((process.argv.find((a, i, l) => l[i - 1] === "--limit") ?? "3")) || 3;

if (!HANDLE || !APP_PASSWORD) {
  if (!dry) {
    console.log("skipped: no BLUESKY credentials");
    process.exit(0);
  }
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const ENDING_TAG = { second_date: "a second date", friends: "just friends", disaster: "a disaster" };

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function session() {
  const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: HANDLE, password: APP_PASSWORD }),
  });
  if (!res.ok) throw new Error(`bluesky login failed ${res.status}`);
  return (await res.json());
}

async function post(sess, ep) {
  const tag = ENDING_TAG[ep.ending] ?? ep.ending;
  const url = `${BASE}/episodes/${ep.id}?utm_source=bluesky&utm_medium=post&utm_campaign=airing`;
  const text = `${ep.a_name} × ${ep.b_name} had a blind date — ${tag}. ${url}`;
  const record = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: new Date().toISOString(),
    facets: [], // Bluesky's facets for the link would go here if we parsed byte-ranges.
  };
  if (dry) {
    console.log("[dry] would post:", text);
    return true;
  }
  const res = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${sess.accessJwt}` },
    body: JSON.stringify({ repo: sess.did, collection: "app.bsky.feed.post", record }),
  });
  if (!res.ok) {
    console.error("bluesky post failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  await pool.query(`update episodes set last_posted_bluesky_at = now() where id = $1`, [ep.id]);
  console.log("posted", ep.id);
  return true;
}

try {
  const { rows } = await pool.query(
    `select e.id, e.ending, ca.name as a_name, cb.name as b_name
       from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
      where e.visibility='public' and e.revealed_at is not null and coalesce(e.hidden,false)=false and e.last_posted_bluesky_at is null
      order by e.revealed_at asc limit $1`, [limit],
  );
  if (!rows.length) {
    console.log("nothing to post");
  } else {
    const sess = dry ? { did: "dry", accessJwt: "dry" } : await session();
    for (const ep of rows) await post(sess, ep);
  }
} finally {
  await pool.end();
}
