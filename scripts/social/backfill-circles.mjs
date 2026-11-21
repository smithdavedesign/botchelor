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
 *   node scripts/social/backfill-circles.mjs --limit 400 --redo-broken  # those, and again the circles whose names break the rules
 *   node scripts/social/backfill-circles.mjs --stats                    # the names as they stand, and which circles break the rules
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
 *
 * Names (lib/social/person-names.ts): each character is offered a few first names and surnames from the OC name
 * generator's lists, in its own style and seeded by its id; then no first name goes past FIRST_NAME_MAX uses, no full
 * name is used twice, close family (parents, full siblings, children) has the character's surname, the rest of the
 * family never has another character's, and nobody else has a character's surname, theirs included. A person who breaks
 * a rule is renamed (the site renames by the same rules), and the log says why.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { nameDraws, nameIdeas } from "../../lib/oc-name-pools.ts";
import { familySurnameOf, FIRST_NAME_MAX, firstNameOf, isFamilyWords, nameStyleOf, personName, sharesSurnameWords, surnameOf } from "../../lib/social/person-names.ts";
import { brainFromEnv } from "../loop/crowd.mjs";

/**
 * v2 (2026-11-21): the names offered, family's surname, a best friend only if they have one. v3: close family shares
 * the character's surname (v2's "mostly" left most brothers and sisters with surnames of their own).
 */
export const PROMPT_VERSION = "backfill-circles-v3";
const USER_AGENT = "botchelor-social-backfill/1.0";
/** How many other show characters a character is offered to know, and how many workplaces to reuse. */
export const CANDIDATES = 8;
const WORKPLACES_OFFERED = 10;
/** How many neighbourhoods a character is offered to live in: the emptiest so far. */
export const HOMES_OFFERED = 3;
const ORDER = { cast: 0, house: 1, agent: 2 };

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};
const first = (name) => String(name ?? "").split(/\s+/)[0];

/** The command line: --limit (required, but for --stats), --dry-run, --force, --redo-broken, --stats, --only, --base. */
export function parseArgs(argv) {
  const o = { limit: null, dryRun: false, force: false, redoBroken: false, stats: false, only: null, base: "https://botchelor.com" };
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
    else if (a === "--redo-broken") o.redoBroken = true;
    else if (a === "--stats") o.stats = true;
    else if (a === "--only") o.only = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--base") o.base = value().replace(/\/$/, "");
    else throw new Error(`unknown flag ${a}`);
  }
  if (!o.stats && (!Number.isInteger(o.limit) || o.limit < 1)) throw new Error("--limit <n> is required (a whole number, 1 or more)");
  return o;
}

/**
 * Who to write, in order: the cast, then the house, then the agent cast; by id within each. Those with a circle only
 * with force, or when `redo` has them (circles written again for their names).
 */
export function queue(characters, { force = false, only = null, limit, redo = null }) {
  return characters
    .filter((c) => (only ? only.includes(c.id) : true) && (force || !c.has_circle || redo?.has(c.id) === true))
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

/**
 * A copy in a random order. The local model leans to the last place listed (2026-11-20 dry run: all three characters
 * lived in The Heights, the last neighbourhood, and two were regulars at its hill), so each character sees its own order.
 */
export function shuffled(list, random = Math.random) {
  return list.map((x) => ({ x, r: random() })).sort((a, b) => a.r - b.r).map((k) => k.x);
}

/**
 * What the prompt says about names: the first names and surnames offered (`names`, lib/oc-name-pools.ts nameIdeas),
 * family's surname, and that a best friend is theirs only if they have one (the first run gave 104 of 118 one).
 */
export function nameLines(me, names) {
  const own = familySurnameOf(me.name);
  const others = names?.last?.length ? names.last.join(", ") : null;
  return [
    ...(names?.first?.length ? [`First names to pick from for them (or others like these): ${names.first.join(", ")}.`] : []),
    own
      ? `Their parents, brothers, sisters and children share their surname, ${own}; other family may have their own. Nobody else has it, nor the surname of anyone on the show${others ? `: others have surnames like ${others}` : ""}.`
      : `Nobody has the surname of anyone on the show${others ? `: use surnames like ${others}` : ""}.`,
    "A best friend only if they really have one: most people here don't.",
  ];
}

/** The prompt for one character's circle: who they are, what's in their life already, the world to place them in, and whom they might know. */
export function circleMessages(me, { world, candidates, byId, workplaces, neighbourhoods = world.neighbourhoods, random = Math.random, names = null }) {
  const kit = [me.archetype, me.occupation && `works as ${me.occupation}`, me.hometown && `from ${me.hometown}`].filter(Boolean).join("; ");
  const already = [
    ...(me.circle?.people ?? []).map((p) => `${p.name} (their ${p.relation})`),
    ...(me.circle?.ties ?? []).map((t) => `${byId.get(t.with)?.name ?? t.with} (${t.phrase ?? `their ${t.relation}`}, on the show)`),
  ];
  const hints = familyHints(me, byId);
  const hoods = shuffled(neighbourhoods, random);
  const hangouts = shuffled(world.hangouts, random);
  const system = [
    "You write the people and places in one character's life for Botchelor, a PG dating show where AI characters go on dates the audience watches.",
    "Everyone you name is a fictional adult: their children are grown up. Nobody real or famous, no brands, nothing sexual, violent, hateful or cruel.",
    "The character is single (they're on a dating show): an ex is fine, a current partner or spouse is not. A late spouse is fine if it suits them.",
    "The people in their life are new: invent each one, with a name of their own. Nobody on the show goes in people (the character, or anyone listed as on the show): the ones they know from the show go in knows.",
    "Reply with one JSON object and nothing else.",
  ].join("\n");
  const user = [
    `The character: ${me.name}${me.age ? `, ${me.age}` : ""}${me.pronouns ? ` (${me.pronouns})` : ""}${kit ? `. ${kit}` : ""}.`,
    `About them: ${clip(me.bio, 500)}`,
    ...(me.voice ? [`How they talk: ${clip(me.voice, 200)}`] : []),
    ...(already.length ? [`Already in their life (keep to it, don't repeat them): ${already.join("; ")}.`] : []),
    ...hints,
    ...nameLines(me, names),
    "",
    `They live in ${world.city.name}, a seaside town. Neighbourhoods their home could be in: ${hoods.map((n) => `${n.name} (${clip(n.description, 90)})`).join("; ")}.`,
    `Places to be a regular at, by id: ${hangouts.map((h) => `${h.key.replace(/^venue:/, "")} (${clip(h.name, 40)}, ${h.neighbourhood})`).join("; ")}.`,
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
    '  "people": [3 to 6 people in their life, off the show, at least one of them family: {"name": "an invented first and last name (a real name, never only Mum, Dad or Auntie)", "relation": "their mother, father, sister, brother, son, daughter, grandmother, cousin, aunt, friend, ex, boss, coworker, neighbour, rival, mentor, roommate or best friend", "pronouns": "she/her, he/him or they/them", "note": "one specific, warm or funny line about them, under 120 characters", "deceased": false}],',
    '  "lives": "the one of those neighbourhoods that suits them, where their own home is (its name): not the show\'s house, where only the season\'s cast stays while it airs",',
    '  "works": {"name": "where they work: one of the workplaces above, or a new one with an invented name", "neighbourhood": "its neighbourhood"} (or null if they don\'t work),',
    '  "regular": "the id of the one place above that suits them best, where they\'re a regular",',
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
/**
 * A title on its own isn't a name (2026-11-20 dry run: "Mum", "Auntie" and "Al" as Nell's three people): "Mum" alone is
 * left out; "Auntie Meg" or "Uncle Fen" keeps its name.
 */
const TITLE_ONLY = /^(the\s+)?(mum|mom|mommy|mummy|mama|ma|mother|dad|daddy|papa|pa|pop|father|auntie|aunty|aunt|uncle|gran|granny|grandma|grandpa|grandmother|grandfather|nan|nana|nanna|gramps|sis|bro|sister|brother|cousin|boss|my\s+\w+)$/i;
export const isTitleOnly = (name) => TITLE_ONLY.test(String(name ?? "").replace(/\s+/g, " ").trim());
/** A possessive, not a name (2026-11-21 run: "Ignatius's Cinder, sister" for Ignatius Cinder): the backfill leaves that person out. */
export const isPossessive = (name) => /\p{L}['’]s(?:\s|$)/u.test(String(name ?? ""));

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
    if (onShow.has(lower(name)) || lower(name) === lower(me.name) || isTitleOnly(name) || isPossessive(name)) return [];
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

/**
 * What a result wrote, back into the run's picture: the people (minus the refused, under the names the site gave them),
 * the ties, a new workplace. `replace`: the circle was written again, so its earlier people are gone.
 */
export function remember(me, circle, result, { byId, ties, workplaces, world, homes = null, replace = false }) {
  if (!result || result.status !== "written") return;
  const refused = new Set((result.refused ?? []).map((r) => `${r.item}|${lower(r.what)}`));
  const renamedTo = new Map((result.renamed ?? []).map((r) => [lower(r.from), r.to]));
  const home = circle.places.find((p) => p.role === "lives");
  const bare = (x) => lower(x).replace(/^the\s+/, "");
  const hood = home && world.neighbourhoods.find((n) => n.key === lower(home.place) || bare(n.name) === bare(home.place));
  if (homes && hood && !refused.has(`place|${lower(`lives ${home.place}`)}`)) homes.set(hood.key, (homes.get(hood.key) ?? 0) + 1);
  me.circle = me.circle ?? { people: [], ties: [] };
  if (replace) me.circle.people = [];
  for (const p of circle.people) if (!refused.has(`person|${lower(p.name)}`)) me.circle.people.push({ name: renamedTo.get(lower(p.name)) ?? p.name, relation: p.relation });
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

/**
 * The neighbourhoods a character is offered to live in: the `n` with the fewest homes this run so far (`homes`, by key),
 * ties broken at random. The local model puts nearly everyone in The Heights when it can (2026-11-20 dry runs: 5 of 6,
 * in any order), so each neighbourhood gets its share and the model picks among the emptiest by what suits them.
 */
export function offerNeighbourhoods(neighbourhoods, homes, { n = HOMES_OFFERED, random = Math.random } = {}) {
  return neighbourhoods
    .map((h) => ({ h, count: homes.get(h.key) ?? 0, r: random() }))
    .sort((a, b) => a.count - b.count || a.r - b.r)
    .slice(0, n)
    .map((k) => k.h);
}

/**
 * How many of the show's people may have a surname before the prompt stops offering it. The name generator's lists are
 * short (32 modern surnames), so without a cap the same few came back for everyone (the first minutes of the
 * 2026-11-21 run: three unrelated Ferreiras and three Duvals in ten circles); past it the offers move on to the other
 * lists. Only what's offered: a surname the model picks itself isn't capped.
 */
export const SURNAME_OFFERED_MAX = 4;

/** The style of names that suits a character (lib/social/person-names.ts nameStyleOf), from its own words. */
export const styleOf = (c) => nameStyleOf([c.bio, c.archetype, c.occupation, c.hometown, ...(c.traits ?? [])].filter(Boolean).join(" "));

/**
 * The run's record of names (lib/social/person-names.ts NameBook): how often each first name and surname is used among
 * the show's people, every full name taken (theirs and the characters'), and the characters' surnames. `skip`:
 * characters whose circles the run writes again, whose people don't count.
 */
export function nameBook(everyone, { skip = new Set() } = {}) {
  const firsts = new Map();
  const lasts = new Map();
  const full = new Set();
  const surnames = new Set();
  for (const c of everyone) {
    full.add(lower(c.name));
    const last = surnameOf(c.name);
    if (last) surnames.add(lower(last));
  }
  const book = {
    firstCount: (f) => firsts.get(lower(f)) ?? 0,
    lastCount: (l) => lasts.get(lower(l)) ?? 0,
    hasFull: (n) => full.has(lower(n)),
    surnameTaken: (l) => surnames.has(lower(l)),
    add(name) {
      const f = lower(firstNameOf(name));
      firsts.set(f, (firsts.get(f) ?? 0) + 1);
      const l = lower(surnameOf(name));
      if (l) lasts.set(l, (lasts.get(l) ?? 0) + 1);
      full.add(lower(name));
    },
    remove(name) {
      const drop = (map, key) => {
        const n = (map.get(key) ?? 0) - 1;
        if (n > 0) map.set(key, n);
        else map.delete(key);
      };
      drop(firsts, lower(firstNameOf(name)));
      const l = lower(surnameOf(name));
      if (l) drop(lasts, l);
      full.delete(lower(name));
    },
  };
  for (const c of everyone) if (!skip.has(c.id)) for (const p of c.circle?.people ?? []) book.add(p.name);
  return book;
}

/**
 * A circle's people by the naming rules, against the run's book: renamed where one breaks a rule (with why), left out
 * where no name would do. Each name kept goes in the book.
 */
export function nameCircle(me, circle, book) {
  const draws = nameDraws(me.id, styleOf(me));
  const holderLast = surnameOf(me.name);
  const familyLast = familySurnameOf(me.name);
  const renamed = [];
  const dropped = [];
  const people = [];
  for (const p of circle.people) {
    const r = personName(p, { kin: isFamilyWords(p.relation), shares: sharesSurnameWords(p.relation), holderLast, familyLast, book, draws });
    if (!r.ok) {
      dropped.push({ name: p.name, reason: r.reason });
      continue;
    }
    if (r.why.length) renamed.push({ from: p.name, to: r.name, why: r.why.join("; ") });
    book.add(r.name);
    people.push({ ...p, name: r.name, note: r.note });
  }
  return { circle: { ...circle, people }, renamed, dropped };
}

/**
 * The characters whose circles break the naming rules, each with what's wrong, in the order the run writes them (so the
 * first three Eleanors keep the name and the fourth is the break): a first name used FIRST_NAME_MAX times already, a
 * full name someone has, someone outside the family with a character's surname (theirs too), family with another
 * character's surname, close family without theirs, a possessive for a name. --redo-broken writes these again and
 * leaves the rest.
 */
export function brokenHolders(everyone) {
  const book = nameBook(everyone, { skip: new Set(everyone.map((c) => c.id)) });
  const broken = new Map();
  for (const c of queue(everyone, { force: true, limit: everyone.length })) {
    const people = c.circle?.people ?? [];
    if (!people.length) continue;
    const own = lower(surnameOf(c.name));
    const family = lower(familySurnameOf(c.name));
    const why = [];
    const seen = new Map();
    const names = new Set();
    for (const p of people) {
      const f = lower(firstNameOf(p.name));
      const last = lower(surnameOf(p.name));
      const kin = isFamilyWords(p.relation);
      if (book.firstCount(f) + (seen.get(f) ?? 0) >= FIRST_NAME_MAX) why.push(`${p.name}: ${FIRST_NAME_MAX} called ${firstNameOf(p.name)} already`);
      if (book.hasFull(p.name) || names.has(lower(p.name))) why.push(`${p.name}: a name someone has`);
      if (last && (kin ? last !== own && book.surnameTaken(last) : last === own || book.surnameTaken(last))) why.push(`${p.name}: ${kin ? "another character's surname" : "a character's surname"}`);
      else if (last && family && sharesSurnameWords(p.relation) && last !== family) why.push(`${p.name}: close family without their surname`);
      if (isPossessive(p.name)) why.push(`${p.name}: not a name`);
      seen.set(f, (seen.get(f) ?? 0) + 1);
      names.add(lower(p.name));
    }
    if (why.length) broken.set(c.id, why);
    else for (const p of people) book.add(p.name);
  }
  return broken;
}

/**
 * The names as they stand, for a report: people and the characters holding them, distinct first names and the five
 * most used, first names past FIRST_NAME_MAX, full names used twice, characters' surnames on people (outside the
 * family; another character's on family), family and close family with the character's own surname, and how many have
 * a best friend.
 */
export function nameStats(everyone) {
  const surnames = new Set(everyone.map((c) => lower(surnameOf(c.name))).filter(Boolean));
  const firsts = new Map();
  const lasts = new Map();
  const fulls = new Map();
  const s = { holders: 0, people: 0, distinctFirst: 0, top: [], topLast: [], overCap: 0, fullTwice: 0, outsideTaken: 0, kin: 0, kinOwn: 0, kinOther: 0, close: 0, closeOwn: 0, bestFriends: 0 };
  for (const c of everyone) {
    const people = c.circle?.people ?? [];
    if (!people.length) continue;
    s.holders++;
    if (people.some((p) => /best friend/i.test(p.relation))) s.bestFriends++;
    const own = lower(surnameOf(c.name));
    for (const p of people) {
      s.people++;
      const f = lower(firstNameOf(p.name));
      firsts.set(f, (firsts.get(f) ?? 0) + 1);
      fulls.set(lower(p.name), (fulls.get(lower(p.name)) ?? 0) + 1);
      const last = lower(surnameOf(p.name));
      if (last) lasts.set(last, (lasts.get(last) ?? 0) + 1);
      if (isFamilyWords(p.relation)) {
        s.kin++;
        if (last && last === own) s.kinOwn++;
        else if (last && surnames.has(last)) s.kinOther++;
        if (last && sharesSurnameWords(p.relation)) {
          s.close++;
          if (last === own) s.closeOwn++;
        }
      } else if (last && surnames.has(last)) s.outsideTaken++;
    }
  }
  s.distinctFirst = firsts.size;
  const top5 = (m) => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5);
  s.top = top5(firsts);
  s.topLast = top5(lasts);
  s.overCap = [...firsts.values()].filter((n) => n > FIRST_NAME_MAX).length;
  s.fullTwice = [...fulls.values()].filter((n) => n > 1).length;
  return s;
}

/** nameStats as one line. */
export const statsLine = (s) =>
  `${s.people} people for ${s.holders} characters: ${s.distinctFirst} first names (most used ${s.top.map(([f, n]) => `${f} ${n}`).join(", ") || "none"}; ${s.overCap} past ${FIRST_NAME_MAX}), ` +
  `surnames most used ${s.topLast.map(([l, n]) => `${l} ${n}`).join(", ") || "none"}, ` +
  `${s.fullTwice} full names twice, ${s.outsideTaken} outside the family with a character's surname, ${s.kinOther} family with another character's, ` +
  `${s.kinOwn} of ${s.kin} family with the character's own (close family ${s.closeOwn} of ${s.close}), ${s.bestFriends} of ${s.holders} with a best friend`;

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
  const broken = o.redoBroken || o.stats ? brokenHolders(everyone) : new Map();
  if (o.stats) {
    log(`names: ${statsLine(nameStats(everyone))}`);
    log(`${broken.size} circles break the naming rules${broken.size ? `, e.g. ${[...broken].slice(0, 5).map(([id, why]) => `${byId.get(id)?.name ?? id} (${why[0]})`).join("; ")}` : ""}`);
    return;
  }
  const todo = queue(everyone, { ...o, redo: new Set(broken.keys()) });
  // The circles written again (with --force, or for their names): their earlier people go, so their names don't count.
  const rewrite = new Set(todo.filter((c) => c.has_circle && (o.force || broken.has(c.id))).map((c) => c.id));
  const book = nameBook(everyone, { skip: rewrite });
  log(
    `${everyone.length} show characters, ${everyone.filter((c) => c.has_circle).length} with a circle; writing ${todo.length}` +
      `${rewrite.size ? ` (${rewrite.size} again${o.force ? "" : ", for their names"})` : ""}${o.dryRun ? " (dry run: nothing is written)" : ""}`,
  );
  if (!todo.length) return;

  const brain = await brainFromEnv(process.env, { log, timeoutMs: 240_000 });
  if (!brain.enabled) throw new Error(`the local model is off (${brain.reason}): nothing written`);
  const ties = tieIndex(everyone);
  const workplaces = [...(world.workplaces ?? [])];
  const homes = new Map();
  const totals = { characters: 0, people: 0, places: 0, ties: 0, refused: 0, renamed: 0, skipped: 0, failed: 0 };
  const models = new Set();
  for (const me of todo) {
    const replace = rewrite.has(me.id);
    const candidates = pickCandidates(me, everyone, ties);
    const offered = offerWorkplaces(workplaces);
    const neighbourhoods = offerNeighbourhoods(world.neighbourhoods, homes);
    const names = nameIdeas(me.id, styleOf(me), { okFirst: (f) => book.firstCount(f) < FIRST_NAME_MAX, okLast: (l) => !book.surnameTaken(l) && book.lastCount(l) < SURNAME_OFFERED_MAX });
    // A circle written again starts from nobody: its earlier people go when it's written.
    const view = replace ? { ...me, circle: { ...(me.circle ?? {}), people: [] } } : me;
    const messages = circleMessages(view, { world, candidates, byId, workplaces: offered, neighbourhoods, names });
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
    const naming = nameCircle(me, circle, book);
    circle = naming.circle;
    let out;
    try {
      out = await api(o.base, "/api/admin/social/circles", {
        method: "POST",
        body: JSON.stringify({ origin_model: served, prompt_version: PROMPT_VERSION, replace, dry_run: o.dryRun, circles: [circle] }),
      });
    } catch (e) {
      log(`${me.name}: ${e.message}`);
      for (const p of circle.people) book.remove(p.name);
      totals.failed++;
      continue;
    }
    const r = out.results[0];
    // The book follows what the site did: a person it refused frees the name, one it renamed takes the new one.
    for (const x of r.renamed ?? []) (book.remove(x.from), book.add(x.to));
    for (const x of r.refused ?? []) if (x.item === "person" && circle.people.some((p) => lower(p.name) === lower(x.what))) book.remove(x.what);
    if (r.status === "skipped" || r.status === "refused") {
      for (const p of circle.people) book.remove(p.name);
      totals.skipped++;
      log(`${me.name}: ${r.status} (${r.reason})`);
      continue;
    }
    totals.characters++;
    totals.people += r.people;
    totals.places += r.places;
    totals.ties += r.ties;
    totals.refused += r.refused.length;
    const renames = [...naming.renamed, ...(r.renamed ?? [])];
    totals.renamed += renames.length;
    const named = (ids) => ids.map((t) => `${t.relation} ${byId.get(t.with)?.name ?? t.with}`).join(", ");
    const placed = circle.places.map((p) => `${p.role} ${p.name ?? p.place}${p.neighbourhood ? ` (${p.neighbourhood})` : ""}`).join(", ");
    log(
      `${me.name} [${me.kind}]: ${r.people} people (${circle.people.map((p) => `${p.name}, ${p.relation}`).join("; ")}), ${r.places} places${placed ? ` (${placed})` : ""}, ${r.ties} ties${circle.ties.length ? ` (${named(circle.ties)})` : ""}` +
        (renames.length ? `; renamed: ${renames.map((x) => `${x.from} → ${x.to} (${x.why})`).join("; ")}` : "") +
        (naming.dropped.length ? `; left out: ${naming.dropped.map((x) => `${x.name} (${x.reason})`).join("; ")}` : "") +
        (r.refused.length ? `; refused: ${r.refused.map((x) => `${x.item} ${x.what}: ${x.reason}`).join("; ")}` : ""),
    );
    if (!o.dryRun) remember(me, circle, r, { byId, ties, workplaces, world, homes, replace });
  }
  const summary = `${o.dryRun ? "dry run: would write" : "wrote"} ${totals.characters} circles: ${totals.people} people, ${totals.places} places, ${totals.ties} ties; ${totals.renamed} people renamed, ${totals.refused} items refused, ${totals.skipped} skipped, ${totals.failed} failed (model ${[...models].join(", ") || "none"}, ${PROMPT_VERSION})`;
  if (homes.size) log(`homes: ${[...homes].map(([key, n]) => `${world.neighbourhoods.find((h) => h.key === key)?.name ?? key} ${n}`).join(", ")}`);
  log(summary);
  if (!o.dryRun) log(`names now: ${statsLine(nameStats(everyone))}`);
  if (!o.dryRun) emit(totals.failed > Math.max(2, todo.length / 4) ? "fail" : "ok", summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(`backfill-circles: ${e.message}`);
    process.exit(1);
  });
}
