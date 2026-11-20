#!/usr/bin/env node
// Requested clips (lib/clip-requests.ts, docs/clips/requested-clips.md; David, 2026-11-20): the owner of a character asks
// for a short vertical clip of one of its finished dates, to post to their own followers, credited to them. This is the
// Mac's half: it claims the oldest queued request from the show (POST /api/clips/worker/claim), cuts that date the way
// the daily episode is cut (daily-episode.mjs autoEdl, rendered by episode-cut.mjs renderCut: the best line cold, the
// lines that lead to it, how it ended), with the person's credit line burned into every frame and a closing card, and
// sends the MP4 and its cover back (POST /api/clips/worker/done), or says why not (POST /api/clips/worker/failed).
// Free apart from the voices (Kokoro on Venice, about a cent a clip, as every cut; macOS say stands in): Chromium and
// ffmpeg on this Mac, never a paid render or video API. The files are rendered into a temporary folder and removed once
// sent: they're the person's, and live in the show's media store from then on.
//
// It reads only the date the claim hands it (the date as a stranger sees it once aired: what its page shows anyone with
// the link), and quotes only its own lines (whole sentences, gaps marked). The credit and caption are the show's.
//
//   node scripts/clips/clip-queue.mjs            render every queued request, then stop (what launchd runs every 5 min)
//   node scripts/clips/clip-queue.mjs --once     at most one
//   node scripts/clips/clip-queue.mjs --watch    keep going, asking again every POLL_SECONDS when the queue is empty
// CROWD_BASE (default https://botchelor.com), SAY=1, CHROMIUM_PATH and FFMPEG as for the other clips. The worker secret
// is CLIP_WORKER_SECRET when the run has it, else the keychain's vault/botchelor/CLIP_WORKER_SECRET: read when needed,
// sent only in the Authorization header to CROWD_BASE, never logged or written.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { autoEdl } from "./daily-episode.mjs";
import { renderCut } from "./episode-cut.mjs";

/** How long --watch waits before asking again when the queue is empty, seconds. */
export const POLL_SECONDS = 60;
/** The most requests one run renders (a run that never ends would hold the Mac). */
export const MAX_PER_RUN = 12;
/** Where the secret is kept on the Mac. */
export const KEYCHAIN_SERVICE = "vault/botchelor/CLIP_WORKER_SECRET";
const UA = "botchelor-clip-queue/1.0";

/** The worker secret: CLIP_WORKER_SECRET when given, else the keychain's (`read`; tests pass their own). Null: none. */
export function workerSecret(env = process.env, read = keychainSecret) {
  const given = env.CLIP_WORKER_SECRET?.trim();
  if (given) return given;
  try {
    return read()?.trim() || null;
  } catch {
    return null;
  }
}

function keychainSecret() {
  return execFileSync("/usr/bin/security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 });
}

/** The closing card (pure): the show's words, the person's credit under them, where to make a character. */
export function creditCard(credit) {
  return {
    kind: "card",
    kicker: "An AI blind date",
    title: "Make your own character. Send them on a date.",
    sub: credit,
    url: "botchelor.com",
    say: "Make your own character at botchelor dot com.",
  };
}

/**
 * The requested clip's edit (pure): the daily episode's edit of the same date, outside the series (no "Day N"), closing
 * on the credit card. Throws (as autoEdl does) when the date has too few spoken lines to cut.
 */
export function requestEdl(e, req) {
  const edl = autoEdl(e, { label: "A blind date on Botchelor", kicker: "Botchelor", card: creditCard(req.credit) });
  const [a, b] = (e.characters ?? []).map((c) => c.name);
  return { ...edl, name: `${a} × ${b}`, direction: "requested clip", episodes: [e.id] };
}

/**
 * Whether a failure is worth another try (pure): a date that can't be cut (too few lines, a line or thought the edit
 * can't find) or a cut over the length limit won't change on a second try; a voice service or the network might.
 */
export function retryable(stage, message) {
  if (stage === "edit") return false;
  return !/over \d+: trim it|has no dialogue|no public|the EDL|keep: no sentence/.test(String(message ?? ""));
}

/** The done route's form (pure apart from Blob): the clip, its cover and the attempt the claim gave. */
export function doneForm({ id, attempt, seconds, clip, poster = null }) {
  const form = new FormData();
  form.set("id", id);
  form.set("attempt", String(attempt));
  form.set("seconds", String(Math.round(seconds * 100) / 100));
  form.set("clip", new Blob([clip], { type: "video/mp4" }), "clip.mp4");
  if (poster) form.set("poster", new Blob([poster], { type: "image/png" }), "cover.png");
  return form;
}

const authHeaders = (secret) => ({ authorization: `Bearer ${secret}`, "user-agent": UA });

/** Asks the show for the next request: the claim, or null when the queue is empty. Throws on a refusal (a bad secret: 404). */
export async function claim(base, secret, f = fetch) {
  const res = await f(`${base}/api/clips/worker/claim`, { method: "POST", headers: authHeaders(secret) });
  if (!res.ok) throw new Error(`claim: HTTP ${res.status}${res.status === 404 ? " (is CLIP_WORKER_SECRET right, and CLIP_REQUESTS on?)" : ""}`);
  return (await res.json()).request ?? null;
}

/** Tells the show a request failed (`retry`: it may be tried again). Best effort: a lost report expires with the lease. */
export async function reportFailure(base, secret, { id, attempt, error, retry }, f = fetch, log = console.error) {
  try {
    const res = await f(`${base}/api/clips/worker/failed`, {
      method: "POST",
      headers: { ...authHeaders(secret), "content-type": "application/json" },
      body: JSON.stringify({ id, attempt, error: String(error).slice(0, 500), retry }),
    });
    if (!res.ok) log(`clip ${id}: the failure report got HTTP ${res.status}`);
  } catch (err) {
    log(`clip ${id}: couldn't report the failure (${err?.message ?? err})`);
  }
}

/**
 * One request, start to end: claim, cut, render, send. Returns "none" (the queue was empty), "done" or "failed".
 * `render` and `f` stand in for renderCut and fetch in tests.
 */
export async function processOne({ base, secret, f = fetch, render = renderCut, log = console.error }) {
  const req = await claim(base, secret, f);
  if (!req) return "none";
  const e = req.episode;
  let edl;
  try {
    edl = requestEdl(e, req);
  } catch (err) {
    log(`clip ${req.id}: can't cut ${e?.id}: ${err?.message ?? err}`);
    await reportFailure(base, secret, { id: req.id, attempt: req.attempt, error: err?.message ?? err, retry: false }, f, log);
    return "failed";
  }
  const out = mkdtempSync(join(tmpdir(), "botchelor-requested-"));
  try {
    const { total } = await render(edl, [e], {
      base,
      out,
      log,
      caption: req.caption,
      credit: req.credit,
      checklist: [`# A requested clip (${req.id})`, "", `Episode: ${base}/episodes/${e.id}`, "Sent back to the person who asked; never posted by the show.", ""],
    });
    const res = await f(`${base}/api/clips/worker/done`, {
      method: "POST",
      headers: authHeaders(secret),
      body: doneForm({ id: req.id, attempt: req.attempt, seconds: total, clip: readFileSync(join(out, "post.mp4")), poster: readFileSync(join(out, "cover.png")) }),
    });
    if (!res.ok) throw new Error(`done: HTTP ${res.status}`);
    log(`clip ${req.id}: ${e.id} sent (${total.toFixed(1)} s)`);
    return "done";
  } catch (err) {
    const message = err?.message ?? String(err);
    log(`clip ${req.id}: ${message}`);
    await reportFailure(base, secret, { id: req.id, attempt: req.attempt, error: message, retry: retryable("render", message) }, f, log);
    return "failed";
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

async function main() {
  const base = (process.env.CROWD_BASE || "https://botchelor.com").replace(/\/$/, "");
  const secret = workerSecret();
  if (!secret) throw new Error(`no worker secret: set CLIP_WORKER_SECRET, or keep it in the keychain as ${KEYCHAIN_SERVICE}`);
  const once = process.argv.includes("--once");
  const watch = process.argv.includes("--watch");
  let ran = 0;
  for (;;) {
    const r = await processOne({ base, secret });
    if (r !== "none") ran++;
    if (once && r !== "none") break;
    if (r === "none" || ran >= MAX_PER_RUN) {
      if (!watch) break;
      await new Promise((ok) => setTimeout(ok, POLL_SECONDS * 1000));
      ran = 0;
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
