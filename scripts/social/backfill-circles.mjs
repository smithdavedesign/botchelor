#!/usr/bin/env node
/**
 * The show's characters get their circles (docs/PRDs/social-network.md section 6.2, Phase 2b): for each of the show's own
 * characters (the season's cast, the other house characters, then the show's own agent-made cast) the free local model
 * writes the people in their life, where they live, work and hang out, and how they know one or two others on the show;
 * the site checks every item and writes what passes (POST /api/admin/social/circles, lib/social/circles.ts), as the house,
 * with the model that answered and this prompt's version on every row.
 *
 *   node scripts/social/backfill-circles.mjs --limit 3 --dry-run       # what it would write, for three characters
 *   node scripts/social/backfill-circles.mjs --limit 400                # every show character still without a circle
 *     [--force] (write over the show's earlier circle) [--only id,id] [--base https://botchelor.com]
 *
 * Free: the model is LiteLLM's `local-chat` on this Mac (scripts/loop/crowd.mjs createBrain refuses anything that isn't
 * local Ollama with no fallbacks), and it stops when the local model is off. Idempotent: a character that has the show's
 * circle is skipped (the site skips it too) unless --force. The admin key comes from the keychain
 * (vault/botchelor/FRONTIER_PASSWORD) or FRONTIER_PASSWORD, straight into the header: never printed.
 *
 * The web, not a row of stars: each character is offered up to eight others to know (the cast and house for the house,
 * the agent cast for the agent cast), the least-tied first, never one they've dated or are tied to already; the
 * workplaces earlier characters named are offered again, so coworkers share a place; and a sibling's parents are passed
 * on, so two siblings have the same mum.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { brainFromEnv } from "../loop/crowd.mjs";

export const PROMPT_VERSION = "backfill-circles-v1";
const USER_AGENT = "botchelor-social-backfill/1.0";
/** How many other show characters a character is offered to know, and how many workplaces to reuse. */
export const CANDIDATES = 8;
const WORKPLACES_OFFERED = 10;
const ORDER = { cast: 0, house: 1, agent: 2 };

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};
const first = (name) => String(name ?? "").split(/\s+/)[0];

/** The command line: --limit (required), --dry-run, --force, --only, --base. */
export function parseArgs(argv) {
  const o = { limit: null, dryRun: false, force: false, only: null, base: "https://botchelor.com" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--limit") o.limit = Number(value());
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--force") o.force = true;
    else if (a === "--only") o.only = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--base") o.base = value().replace(/\/$/, "");
    else throw new Error(`unknown flag ${a}`);
  }
  if (!Number.isInteger(o.limit) || o.limit < 1) throw new Error("--limit <n> is required (a whole number, 1 or more)");
  return o;
}

/** Who to write, in order: the cast, then the house, then the agent cast; by id within each. Those with a circle only with force. */
export function queue(characters, { force = false, only = null, limit }) {
  return characters
    .filter((c) => (only ? only.includes(c.id) : true) && (force || !c.has_circle))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
}

/** The run's own record of who's tied to whom (the site's, then what this run wrote), so nobody is offered twice. */
export function tieIndex(characters) {
  const tied = new Map();
  const add = (a, b) => {
    if (!tied.has(a)) tied.set(a, new Set());
    tied.get(a).add(b);
  };
  for (const c of characters) for (const t of c.circle?.ties ?? []) (add(c.id, t.with), add(t.with, c.id));
  return { tied, add: (a, b) => (add(a, b), add(b, a)), count: (id) => tied.get(id)?.size ?? 0, has: (a, b) => tied.get(a)?.has(b) === true };
}

/**
 * The others a character is offered to know: the same side of the show first (house with house, agents with agents),
 * the least-tied first (`random` breaks ties), never themselves, anyone they've dated or anyone they're tied to.
 */
export function pickCandidates(me, everyone, ties, { n = CANDIDATES, random = Math.random } = {}) {
  const dated = new Set(me.dated ?? []);
  const side = (c) => (c.kind === "agent" ? "agent" : "house");
  const pool = everyone.filter((c) => c.id !== me.id && !dated.has(c.id) && !ties.has(me.id, c.id));
  const keyed = pool.map((c) => ({ c, same: side(c) === side(me) ? 0 : 1, load: ties.count(c.id), r: random() }));
  keyed.sort((a, b) => a.same - b.same || a.load - b.load || a.r - b.r);
  return keyed.slice(0, n).map((k) => k.c);
}

const SIBLING = /^(sibling|sister|brother|twin)/i;
/** Relations that read the same from both ends. */
const TWO_WAY = /^(?:(?:old |childhood |best |close )?friend|sibling|sister|brother|twin|cousin|ex|coworker|colleague|classmate|neighbou?r|roommate|flatmate|rival|nemesis|frenemy|teammate|bandmate|in-law)$/i;
const ELDERS = /^(parent|mother|father|mum|mom|dad|grandparent|grandmother|grandfather|gran)/i;

/** Their sibling's parents and grandparents, already named: theirs too. */
export function familyHints(me, byId) {
  const out = [];
  for (const t of me.circle?.ties ?? []) {
    if (!SIBLING.test(t.relation)) continue;
    const sib = byId.get(t.with);
    const elders = (sib?.circle?.people ?? []).filter((p) => ELDERS.test(p.relation));
    if (elders.length) out.push(`${first(sib.name)} is their ${t.relation}, so ${first(sib.name)}'s family is theirs too: ${elders.map((p) => `${p.name} (${p.relation})`).join(", ")}.`);
  }
  return out;
}

/** The prompt for one character's circle: who they are, what's in their life already, the world to place them in, and whom they might know. */
export function circleMessages(me, { world, candidates, byId, workplaces }) {
  const kit = [me.archetype, me.occupation && `works as ${me.occupation}`, me.hometown && `from ${me.hometown}`].filter(Boolean).join("; ");
  const already = [
    ...(me.circle?.people ?? []).map((p) => `${p.name} (their ${p.relation})`),
    ...(me.circle?.ties ?? []).map((t) => `${byId.get(t.with)?.name ?? t.with} (${t.phrase ?? `their ${t.relation}`}, on the show)`),
  ];
  const hints = familyHints(me, byId);
  const system = [
    "You write the people and places in one character's life for Botchelor, a PG dating show where AI characters go on dates the audience watches.",
    "Everyone you name is a fictional adult: their children are grown up. Nobody real or famous, no brands, nothing sexual, violent, hateful or cruel.",
    "The character is single (they're on a dating show): an ex is fine, a current partner or spouse is not. A late spouse is fine if it suits them.",
    "Reply with one JSON object and nothing else.",
  ].join("\n");
  const user = [
    `The character: ${me.name}${me.age ? `, ${me.age}` : ""}${me.pronouns ? ` (${me.pronouns})` : ""}${kit ? `. ${kit}` : ""}.`,
    `About them: ${clip(me.bio, 500)}`,
    ...(me.voice ? [`How they talk: ${clip(me.voice, 200)}`] : []),
    ...(already.length ? [`Already in their life (keep to it, don't repeat them): ${already.join("; ")}.`] : []),
    ...hints,
    "",
    `They live in ${world.city.name}, a seaside town. Its neighbourhoods: ${world.neighbourhoods.map((n) => `${n.name} (${clip(n.description, 90)})`).join("; ")}.`,
    `Places to be a regular at, by id: ${world.hangouts.map((h) => `${h.key.replace(/^venue:/, "")} (${clip(h.name, 40)}, ${h.neighbourhood})`).join("; ")}.`,
    ...(workplaces.length ? [`Workplaces in town others already work at (pick one if their job fits, so they're coworkers): ${workplaces.map((w) => `${w.name} (${w.neighbourhood ?? world.city.name})`).join("; ")}.`] : []),
    ...(candidates.length
      ? [
          "Others on the show they might know from before:",
          ...candidates.map((c) => `- ${c.name}: ${clip([c.archetype, c.occupation, c.hometown && `from ${c.hometown}`].filter(Boolean).join(", ") || c.bio, 120)}`),
        ]
      : []),
    "",
    "Return this JSON:",
    "{",
    '  "people": [3 to 6 people in their life, off the show: {"name": "a first name, or first and last", "relation": "their mother, father, sister, brother, son, daughter, grandmother, cousin, aunt, best friend, friend, ex, boss, coworker, neighbour, rival, mentor or roommate", "pronouns": "she/her, he/him or they/them", "note": "one specific, warm or funny line about them, under 120 characters", "deceased": false}],',
    '  "lives": "the neighbourhood they live in (its name)",',
    '  "works": {"name": "where they work: one of the workplaces above, or a new one with an invented name", "neighbourhood": "its neighbourhood"} (or null if they don\'t work),',
    '  "regular": "the id of one place they\'re a regular at",',
    `  "knows": [1 or 2 of the others above: {"name": "their full name, as above", "relation": "what they are to ${first(me.name)}: sibling, cousin, old friend, childhood friend, ex, coworker, classmate, neighbour, roommate, rival or mentor", "story": "how they know each other, one line the audience would hear, under 200 characters"}]`,
    "}",
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** The JSON object in a model's reply, or null. */
export function parseReply(raw) {
  const text = String(raw ?? "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const str = (v, n) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const lower = (s) => String(s ?? "").trim().toLowerCase();

/**
 * The reply as the site takes it (lib/social/circles.ts CircleIn): people as given; lives, works and regular as places
 * (a workplace by its key when it's one the show has, else by name, made new); knows by name to ids, among the
 * candidates only. Leaves the checks to the site; drops only what isn't the right shape.
 */
export function toCircle(me, reply, { candidates, workplaces, everyone = [] }) {
  // Someone on the show isn't an off-screen person (2026-11-20 dry run: "Barnaby Thorne, rival" as one of Juniper's
  // people, while Barnaby is in the cast): one of the candidates becomes a tie, anyone else on the show is left out.
  const onShow = new Set(everyone.map((c) => lower(c.name)));
  const asTies = [];
  const people = (Array.isArray(reply?.people) ? reply.people : []).slice(0, 8).flatMap((p) => {
    const name = str(p?.name, 120);
    const relation = str(p?.relation, 80);
    if (!name || !relation) return [];
    const candidate = candidates.find((c) => lower(c.name) === lower(name));
    if (candidate) {
      asTies.push({ name: candidate.name, relation });
      return [];
    }
    if (onShow.has(lower(name)) || lower(name) === lower(me.name)) return [];
    return [{ name, relation, pronouns: str(p?.pronouns, 40), note: str(p?.note, 400), deceased: p?.deceased === true }];
  });
  const places = [];
  const lives = str(reply?.lives, 80);
  if (lives) places.push({ role: "lives", place: lives });
  const works = reply?.works && typeof reply.works === "object" ? reply.works : typeof reply?.works === "string" ? { name: reply.works } : null;
  const workName = str(works?.name, 120);
  if (workName) {
    const known = workplaces.find((w) => lower(w.name) === lower(workName));
    places.push(known ? { role: "works", place: known.key } : { role: "works", name: workName, neighbourhood: str(works?.neighbourhood, 80) });
  }
  // A hangout by its id ("dive_bar"), key or name: the site reads all three.
  const regular = str(reply?.regular, 80);
  if (regular) places.push({ role: "regular", place: regular });
  const byName = new Map(candidates.flatMap((c) => [[lower(c.name), c], [lower(first(c.name)), c]]));
  const knows = [...(Array.isArray(reply?.knows) ? reply.knows : []), ...asTies];
  const ties = [];
  for (const k of knows) {
    const other = byName.get(lower(k?.name)) ?? byName.get(lower(first(k?.name)));
    const relation = str(k?.relation, 80);
    if (!other || other.id === me.id || !relation || ties.some((t) => t.with === other.id && lower(t.relation) === lower(relation))) continue;
    ties.push({ with: other.id, relation, story: str(k?.story, 600) });
    if (ties.length === 2) break;
  }
  return { character_id: me.id, people, places, ties };
}

/** What a result wrote, back into the run's picture: the people (minus the refused), the ties, a new workplace. */
export function remember(me, circle, result, { byId, ties, workplaces, world }) {
  if (!result || result.status !== "written") return;
  const refused = new Set((result.refused ?? []).map((r) => `${r.item}|${lower(r.what)}`));
  me.circle = me.circle ?? { people: [], ties: [] };
  for (const p of circle.people) if (!refused.has(`person|${lower(p.name)}`)) me.circle.people.push({ name: p.name, relation: p.relation });
  for (const t of circle.ties) {
    const other = byId.get(t.with);
    if (!other || refused.has(`tie|${lower(`${t.relation} ${t.with}`)}`)) continue;
    ties.add(me.id, t.with);
    me.circle.ties.push({ with: t.with, relation: t.relation });
    // From the other end: a two-way relation reads the same ("sibling", "ex"); a one-way one is said whole.
    other.circle = other.circle ?? { people: [], ties: [] };
    other.circle.ties.push(TWO_WAY.test(t.relation) ? { with: me.id, relation: t.relation } : { with: me.id, relation: t.relation, phrase: `they are ${first(me.name)}'s ${t.relation}` });
  }
  const work = circle.places.find((p) => p.role === "works" && p.name);
  if (work && !refused.has(`place|${lower(`works ${work.name}`)}`) && !workplaces.some((w) => lower(w.name) === lower(work.name))) {
    const hood = world.neighbourhoods.find((n) => lower(n.name) === lower(work.neighbourhood) || n.key === lower(work.neighbourhood));
    workplaces.push({ key: `workplace:${lower(work.name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`, name: work.name, kind: "workplace", neighbourhood: hood?.name ?? null });
  }
  me.has_circle = true;
}

/** Up to `n` of the workplaces, the newest first (so a run's own become coworkers), with a few of the older ones mixed in. */
export function offerWorkplaces(workplaces, { n = WORKPLACES_OFFERED, random = Math.random } = {}) {
  if (workplaces.length <= n) return [...workplaces];
  const recent = workplaces.slice(-Math.ceil(n / 2));
  const older = workplaces.slice(0, -Math.ceil(n / 2)).map((w) => ({ w, r: random() })).sort((a, b) => a.r - b.r).slice(0, n - recent.length).map((x) => x.w);
  return [...older, ...recent];
}

function adminKey() {
  if (process.env.FRONTIER_PASSWORD) return process.env.FRONTIER_PASSWORD;
  return execFileSync("security", ["find-generic-password", "-s", "vault/botchelor/FRONTIER_PASSWORD", "-w"], { encoding: "utf8" }).trim();
}

/** The system log (RepoHQ docs/logging.md): best effort. */
function emit(status, message) {
  try {
    execFileSync(join(homedir(), "ai-stack", "bin", "emit-event"), ["botchelor", "social-backfill", "circles", status, message], { stdio: "ignore", timeout: 5000 });
  } catch {
    /* no ai-stack: the console has it */
  }
}

async function api(base, path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "x-frontier-key": adminKey(), "user-agent": USER_AGENT, ...(init.body ? { "content-type": "application/json" } : {}) },
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 300) ?? ""}`);
  return body;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const log = (m) => console.log(m);
  // Every show character, a page at a time (the run offers any of them to know), and the world.
  let after = "";
  let world = null;
  const everyone = [];
  for (;;) {
    const page = await api(o.base, `/api/admin/social/circles?limit=500${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    if (page.on === false) throw new Error("the social network is off on the site (SOCIAL_TIES=0)");
    world = world ?? page.world;
    everyone.push(...page.characters);
    if (!page.next) break;
    after = page.next;
  }
  const byId = new Map(everyone.map((c) => [c.id, c]));
  const todo = queue(everyone, o);
  log(`${everyone.length} show characters, ${everyone.filter((c) => c.has_circle).length} with a circle; writing ${todo.length}${o.dryRun ? " (dry run: nothing is written)" : ""}`);
  if (!todo.length) return;

  const brain = await brainFromEnv(process.env, { log, timeoutMs: 240_000 });
  if (!brain.enabled) throw new Error(`the local model is off (${brain.reason}): nothing written`);
  const ties = tieIndex(everyone);
  const workplaces = [...(world.workplaces ?? [])];
  const totals = { characters: 0, people: 0, places: 0, ties: 0, refused: 0, skipped: 0, failed: 0 };
  const models = new Set();
  for (const me of todo) {
    const candidates = pickCandidates(me, everyone, ties);
    const offered = offerWorkplaces(workplaces);
    const messages = circleMessages(me, { world, candidates, byId, workplaces: offered });
    let circle = null;
    let served = null;
    for (let attempt = 0; attempt < 2 && !circle; attempt++) {
      try {
        const raw = await brain.complete(messages, { maxTokens: 1200, temperature: 0.8, json: true, onServed: (m) => (served = m) });
        const reply = parseReply(raw);
        if (reply) circle = toCircle(me, reply, { candidates, workplaces: offered, everyone });
        else log(`${me.name}: reply ${attempt + 1} wasn't JSON`);
      } catch (e) {
        log(`${me.name}: model try ${attempt + 1} failed: ${e.message}`);
        if (!brain.enabled) break;
      }
    }
    if (!circle || !served) {
      totals.failed++;
      if (!brain.enabled) break;
      continue;
    }
    models.add(served);
    let out;
    try {
      out = await api(o.base, "/api/admin/social/circles", {
        method: "POST",
        body: JSON.stringify({ origin_model: served, prompt_version: PROMPT_VERSION, replace: o.force, dry_run: o.dryRun, circles: [circle] }),
      });
    } catch (e) {
      log(`${me.name}: ${e.message}`);
      totals.failed++;
      continue;
    }
    const r = out.results[0];
    if (r.status === "skipped" || r.status === "refused") {
      totals.skipped++;
      log(`${me.name}: ${r.status} (${r.reason})`);
      continue;
    }
    totals.characters++;
    totals.people += r.people;
    totals.places += r.places;
    totals.ties += r.ties;
    totals.refused += r.refused.length;
    const named = (ids) => ids.map((t) => `${t.relation} ${byId.get(t.with)?.name ?? t.with}`).join(", ");
    const placed = circle.places.map((p) => `${p.role} ${p.name ?? p.place}${p.neighbourhood ? ` (${p.neighbourhood})` : ""}`).join(", ");
    log(
      `${me.name} [${me.kind}]: ${r.people} people (${circle.people.map((p) => `${p.name}, ${p.relation}`).join("; ")}), ${r.places} places${placed ? ` (${placed})` : ""}, ${r.ties} ties${circle.ties.length ? ` (${named(circle.ties)})` : ""}` +
        (r.refused.length ? `; refused: ${r.refused.map((x) => `${x.item} ${x.what}: ${x.reason}`).join("; ")}` : ""),
    );
    if (!o.dryRun) remember(me, circle, r, { byId, ties, workplaces, world });
  }
  const summary = `${o.dryRun ? "dry run: would write" : "wrote"} ${totals.characters} circles: ${totals.people} people, ${totals.places} places, ${totals.ties} ties; ${totals.refused} items refused, ${totals.skipped} skipped, ${totals.failed} failed (model ${[...models].join(", ") || "none"}, ${PROMPT_VERSION})`;
  log(summary);
  if (!o.dryRun) emit(totals.failed > Math.max(2, todo.length / 4) ? "fail" : "ok", summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`backfill-circles: ${e.message}`);
    process.exit(1);
  });
}
