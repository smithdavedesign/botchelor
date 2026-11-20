#!/usr/bin/env node
/**
 * The social network dataset (docs/PRDs/social-network.md §8 and §10; docs/data-plan.md "Social network dataset"): the
 * characters' social graph as a versioned folder of JSONL files, for licensing to researchers and for our own models.
 * Admin and offline: it reads the database (read-only), writes files on this Mac, and never uploads anything.
 *
 *   DATABASE_URL="$(neon connection-string --profile davejobs-agent --project-id cool-boat-29098893)" \
 *     node scripts/social/export-dataset.mjs [--out .data/social-dataset] [--version 2026-11-20]
 *       [--allow-model glm-4.6,local-chat | --allow-model all] [--db url | --pglite dir]
 *
 * Writes <out>/<version>/:
 *  - nodes.jsonl (the characters), people.jsonl (their off-screen people), places.jsonl, memberships.jsonl, ties.jsonl,
 *    tie_events.jsonl (every change to those ties), metrics.jsonl (social_metrics), network_daily.jsonl;
 *  - datasheet.md, in the "Datasheets for Datasets" form (Gebru et al.), with this version's counts;
 *  - manifest.json: the counts, each file's sha256 and size, the filters, and what each filter left out.
 * and <out>/<version>.salt beside it (never inside the folder): the version's pseudonym salt, so the same version can be
 * rebuilt with the same ids. A new version gets a new salt, so two versions can't be joined on their ids.
 *
 * What gets in (PRD §8; lib/ml-consent.ts is the gate, loaded as the app's own code, never a copy):
 *  - characters that are public and still someone's (a deleted account's are out), and house characters or characters
 *    whose owner opted in to training (consentedCharacterSql, at the time of each row: a tie's creation);
 *  - public rows only: a tie, person, place or membership only when its visibility is public; a tie only when it is
 *    active or ended (never a proposal or a declined one); an off-screen person only with a public holder;
 *  - no account id anywhere: every id is pseudonymised, `actor` and every person column are dropped, evidence becomes the
 *    kinds of record it came from, and a change's story text is dropped (a story written while the tie was private);
 *  - no After Dark: no social row comes from it (lib/social/derive.ts never reads it), and the flag to ask is refused;
 *  - provenance: a row a model wrote any part of (origin_model) only when that model is on --allow-model, so a closed
 *    model's writing never reaches a training set unless its terms allow it. Default: no model's writing.
 * Free: no model call. Every connection is read-only.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDb } from "../eval/after-dark-observer.mjs";
import { loadLib } from "../eval/export-preferences.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The deleted-account owner (lib/rules.ts DELETED_OWNER): a deleted account's characters are left out. */
const DELETED_OWNER = "deleted";
export const DATASET_NAME = "botchelor-social-network";
/** The files, in the order the datasheet and manifest list them. */
export const FILES = ["nodes", "people", "places", "memberships", "ties", "tie_events", "metrics", "network_daily"];
/** Text a change can carry that was written while a tie may not have been public: dropped from tie_events. */
const TEXT_CHANGES = new Set(["story", "since_text"]);

const asArray = (v) => (Array.isArray(v) ? v : typeof v === "string" ? JSON.parse(v) : []);
const asObject = (v) => (v && typeof v === "object" ? v : typeof v === "string" ? JSON.parse(v) : {});
const iso = (d) => (d ? new Date(d).toISOString() : null);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const num = (x) => (x === null || x === undefined ? null : Number(x));

/** lib/ml-consent.ts: consentedCharacterSql and the current wording's version. */
export const loadConsent = () => loadLib("lib/ml-consent.ts");
/** lib/origin.ts: who made a character (cast, person, agent, original, house_bot), as the site says it. */
export const loadOrigin = () => loadLib("lib/origin.ts");

/** A pseudonym: the HMAC of the id under the version's salt, typed, so ids from different tables never collide. */
export function pseudonym(salt, type, id) {
  if (id === null || id === undefined) return null;
  return `${type}_${createHmac("sha256", salt).update(`${type}:${id}`).digest("hex").slice(0, 20)}`;
}

/**
 * The SQL that keeps a row whose writer is allowed: no model, or one on the list ($1, every statement's one parameter);
 * "all" keeps every row. Each form reads $1, so every statement takes the same parameter.
 */
function modelOk(column, allowModels) {
  if (allowModels === "all") return "cardinality($1::text[]) >= 0";
  return `(${column} is null or ${column} = any($1::text[]))`;
}

/**
 * The dataset, in memory: { files: {name: rows[]}, counts, excluded, filters }. query(sql, params) returns rows; deps:
 * consent (lib/ml-consent.ts), salt, allowModels (model ids, or "all"), version, now.
 */
export async function buildSocialDataset(query, { consent, origin, salt, allowModels = [], version, now = new Date() }) {
  if (!consent?.consentedCharacterSql) throw new Error("the consent gate (lib/ml-consent.ts) is required");
  if (!origin?.originSql) throw new Error("lib/origin.ts is required");
  if (!salt) throw new Error("a salt is required");
  const models = allowModels === "all" ? "all" : [...new Set(allowModels)].sort();
  // Every statement takes one parameter, the allowed models ($1), and reads it.
  const q = async (sql) => query(sql, [models === "all" ? [] : models]);
  const pass = (c, at) => consent.consentedCharacterSql(c, at);
  const usable = (c) => `${c}.visibility = 'public' and ${c}.owner_id is distinct from '${DELETED_OWNER}'`;

  // The characters: public, still someone's, and the show's own or opted in (as of now, for what they are today).
  const characters = await q(
    `select c.id, c.is_house, c.created_at, ${origin.originSql("c")} as origin, c.extras->>'kind' as kind,
            (select array_agg(ct.tag order by ct.tag) from character_tags ct where ct.character_id = c.id) as tags
       from characters c
      where ${usable("c")} and ${pass("c", "now()")} and cardinality($1::text[]) >= 0
      order by c.id`,
  );
  const ok = new Set(characters.map((c) => c.id));
  const cid = (id) => (ok.has(id) ? pseudonym(salt, "c", id) : null);

  // Ties: public, active or ended, every character on them in and opted in when the tie was made, the writer allowed.
  const tieWhere = `t.visibility = 'public' and t.status in ('active', 'ended')
    and ${usable("a")} and ${pass("a", "t.created_at")}
    and (case when t.to_id is not null then ${usable("b")} and ${pass("b", "t.created_at")}
              else p.visibility = 'public' end)`;
  const tieFrom = `from social_ties t
       join characters a on a.id = t.from_id
       left join characters b on b.id = t.to_id
       left join social_people p on p.id = t.to_person_id`;
  const ties = await q(
    `select t.id, t.from_id, t.to_id, t.to_person_id, t.kind, t.layer, t.directed, t.valence, t.closeness, t.status, t.source,
            t.evidence, t.detail, t.story, t.since_text, t.origin_model, t.prompt_version, t.confidence, t.started_at, t.ended_at,
            t.last_contact_at, t.created_at, t.updated_at
       ${tieFrom}
      where ${tieWhere} and ${modelOk("t.origin_model", models)}
      order by t.id`,
  );
  // A tie to a person whose own writer isn't allowed goes too (the person is part of what the tie says).
  const people = await q(
    `select p.id, p.holder_id, p.name, p.pronouns, p.note, p.deceased, p.source, p.origin_model, p.prompt_version, p.promoted_to, p.created_at
       from social_people p
       join characters h on h.id = p.holder_id
      where p.visibility = 'public' and ${usable("h")} and ${pass("h", "p.created_at")} and ${modelOk("p.origin_model", models)}
      order by p.id`,
  );
  const personOk = new Set(people.map((r) => r.id));
  const keptTies = ties.filter((t) => ok.has(t.from_id) && (t.to_id ? ok.has(t.to_id) : personOk.has(t.to_person_id)));
  const tieOk = new Set(keptTies.map((t) => t.id));

  const events = (
    await q(
      `select e.tie_id, e.event, e.changes, e.source, e.at
         from social_tie_events e
         join social_ties t on t.id = e.tie_id
         ${tieFrom.replace("from social_ties t", "")}
        where ${tieWhere} and ${modelOk("t.origin_model", models)}
        order by e.tie_id, e.at, e.id`,
    )
  ).filter((e) => tieOk.has(e.tie_id));

  const memberships = await q(
    `select m.place_id, m.character_id, m.role, m.since_text, m.started_at, m.ended_at, m.source, m.detail, m.origin_model, m.created_at
       from social_place_members m
       join characters c on c.id = m.character_id
       join social_places pl on pl.id = m.place_id
      where m.visibility = 'public' and pl.visibility = 'public' and ${usable("c")} and ${pass("c", "m.created_at")}
        and ${modelOk("m.origin_model", models)} and ${modelOk("pl.origin_model", models)}
      order by m.place_id, m.character_id, m.role`,
  );
  const keptMembers = memberships.filter((m) => ok.has(m.character_id));
  // Places: the show's world, and any public place someone in the set belongs to.
  const usedPlaces = new Set(keptMembers.map((m) => m.place_id));
  const places = (
    await q(
      `select pl.id, pl.key, pl.kind, pl.name, pl.parent_id, pl.description, pl.source, pl.origin_model, pl.created_at
         from social_places pl
        where pl.visibility = 'public' and ${modelOk("pl.origin_model", models)}
        order by pl.id`,
    )
  ).filter((pl) => pl.source === "house" || usedPlaces.has(pl.id));
  const placeOk = new Set(places.map((pl) => pl.id));

  const metrics = (
    await q(
      `select character_id, day, layer, degree, weighted_degree, in_valence, out_valence, reciprocity, clustering, pagerank, betweenness,
              kcore, community, burt_constraint, triads_balanced, triads_unbalanced, ring_inner, ring_close, ring_friends, ring_acquaintances
         from social_metrics where cardinality($1::text[]) >= 0
        order by day, character_id, layer`,
    )
  ).filter((m) => ok.has(m.character_id));
  const daily = await q(
    `select day, nodes, ties, density, avg_degree, clustering, modularity, communities, giant_component, assortativity, balance,
            reciprocity, stats
       from social_network_daily where complete and cardinality($1::text[]) >= 0
      order by day`,
  );

  // What the filters left out, by reason, for the datasheet's known gaps (counts only).
  const [left] = await q(
    `select count(*) filter (where not (t.visibility = 'public'))::int as not_public,
            count(*) filter (where t.visibility = 'public' and t.status not in ('active', 'ended'))::int as not_settled,
            count(*) filter (where t.visibility = 'public' and t.status in ('active', 'ended') and not (${tieWhere}))::int as not_consented,
            count(*) filter (where (${tieWhere}) and not (${modelOk("t.origin_model", models)}))::int as model_not_allowed
       ${tieFrom}`,
  );

  const files = {
    nodes: characters.map((c) => ({
      id: cid(c.id),
      house: Boolean(c.is_house),
      origin: c.origin,
      kind: c.kind ?? null,
      tags: asArray(c.tags),
      created_on: day(c.created_at),
    })),
    people: people
      .filter((r) => ok.has(r.holder_id))
      .map((r) => ({
        id: pseudonym(salt, "p", r.id),
        holder: cid(r.holder_id),
        name: r.name,
        pronouns: r.pronouns ?? null,
        note: r.note ?? null,
        deceased: Boolean(r.deceased),
        source: r.source,
        origin_model: r.origin_model ?? null,
        prompt_version: r.prompt_version ?? null,
        promoted_to: r.promoted_to ? cid(r.promoted_to) : null,
        created_at: iso(r.created_at),
      })),
    places: places.map((pl) => ({
      id: pseudonym(salt, "pl", pl.id),
      key: pl.key,
      kind: pl.kind,
      name: pl.name,
      parent: pl.parent_id && placeOk.has(pl.parent_id) ? pseudonym(salt, "pl", pl.parent_id) : null,
      description: pl.description ?? null,
      source: pl.source,
      origin_model: pl.origin_model ?? null,
    })),
    memberships: keptMembers
      .filter((m) => placeOk.has(m.place_id))
      .map((m) => ({
        place: pseudonym(salt, "pl", m.place_id),
        character: cid(m.character_id),
        role: m.role,
        since_text: m.since_text ?? null,
        started_at: iso(m.started_at),
        ended_at: iso(m.ended_at),
        source: m.source,
        detail: asObject(m.detail),
        origin_model: m.origin_model ?? null,
        created_at: iso(m.created_at),
      })),
    ties: keptTies.map((t) => {
      const evidence = asArray(t.evidence);
      const from = {};
      for (const e of evidence) {
        const kind = String(e?.ref ?? "").split(":")[0] || "other";
        from[kind] = (from[kind] ?? 0) + 1;
      }
      return {
        id: pseudonym(salt, "t", t.id),
        from: cid(t.from_id),
        to: t.to_id ? cid(t.to_id) : null,
        to_person: t.to_person_id ? pseudonym(salt, "p", t.to_person_id) : null,
        kind: t.kind,
        layer: t.layer,
        directed: Boolean(t.directed),
        valence: num(t.valence),
        closeness: num(t.closeness),
        status: t.status,
        source: t.source,
        // What it came from, as kinds of record (episode, scene, night...) and how many: never a record's id.
        evidence: from,
        detail: asObject(t.detail),
        story: t.story ?? null,
        since_text: t.since_text ?? null,
        origin_model: t.origin_model ?? null,
        prompt_version: t.prompt_version ?? null,
        confidence: num(t.confidence),
        started_at: iso(t.started_at),
        ended_at: iso(t.ended_at),
        last_contact_at: iso(t.last_contact_at),
        created_at: iso(t.created_at),
      };
    }),
    tie_events: events.map((e) => {
      const changes = {};
      for (const [k, v] of Object.entries(asObject(e.changes))) if (!TEXT_CHANGES.has(k)) changes[k] = v;
      return { tie: pseudonym(salt, "t", e.tie_id), event: e.event, changes, source: e.source ?? null, at: iso(e.at) };
    }),
    metrics: metrics.map((m) => ({
      character: cid(m.character_id),
      day: day(m.day),
      layer: m.layer,
      degree: num(m.degree),
      weighted_degree: num(m.weighted_degree),
      in_valence: num(m.in_valence),
      out_valence: num(m.out_valence),
      reciprocity: num(m.reciprocity),
      clustering: num(m.clustering),
      pagerank: num(m.pagerank),
      betweenness: num(m.betweenness),
      kcore: num(m.kcore),
      community: num(m.community),
      burt_constraint: num(m.burt_constraint),
      triads_balanced: num(m.triads_balanced),
      triads_unbalanced: num(m.triads_unbalanced),
      ring_inner: num(m.ring_inner),
      ring_close: num(m.ring_close),
      ring_friends: num(m.ring_friends),
      ring_acquaintances: num(m.ring_acquaintances),
    })),
    network_daily: daily.map((d) => ({
      day: day(d.day),
      nodes: num(d.nodes),
      ties: asObject(d.ties),
      density: num(d.density),
      avg_degree: num(d.avg_degree),
      clustering: num(d.clustering),
      modularity: num(d.modularity),
      communities: num(d.communities),
      giant_component: num(d.giant_component),
      assortativity: asObject(d.assortativity),
      balance: d.balance ? asObject(d.balance) : null,
      reciprocity: num(d.reciprocity),
      stats: asObject(d.stats),
    })),
  };
  const counts = Object.fromEntries(FILES.map((f) => [f, files[f].length]));
  return {
    version,
    created_at: now.toISOString(),
    files,
    counts,
    excluded: {
      ties_not_public: left?.not_public ?? 0,
      ties_proposed_or_declined: left?.not_settled ?? 0,
      ties_not_consented_or_private_end: left?.not_consented ?? 0,
      ties_model_not_allowed: left?.model_not_allowed ?? 0,
    },
    filters: {
      consent: `lib/ml-consent.ts consentedCharacterSql, wording ${consent.ML_CONSENT_VERSION ?? "current"}, at each row's creation`,
      visibility: "public",
      tie_statuses: ["active", "ended"],
      after_dark: false,
      account_ids: false,
      allow_models: models,
    },
  };
}

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");

/** The datasheet (Gebru et al., "Datasheets for Datasets"), filled with this version's numbers. */
export function datasheet(set) {
  const c = set.counts;
  const x = set.excluded;
  const models = set.filters.allow_models === "all" ? "every model's" : set.filters.allow_models.length ? set.filters.allow_models.join(", ") : "no model's";
  return `# Datasheet: ${DATASET_NAME}, version ${set.version}

Built ${set.created_at} by scripts/social/export-dataset.mjs. The design is docs/PRDs/social-network.md (sections 5, 8 and 10).

## Motivation
- **Why it exists.** A multiplex, signed, directed and temporal social network of fictional characters on Botchelor, a
  dating show where people's and the show's characters go on AI-written dates. It is for research on social networks,
  link prediction, structural balance and community structure, and for training models of social behaviour.
- **Who made it.** Botchelor LLC, from its own records. It is licensed, never sold: the privacy page's promise stands.

## Composition
- ${c.nodes} characters (nodes.jsonl): fictional adults, the show's own cast and characters people or agents made.
  Attributes: house or not, origin (cast, person, agent, original, house_bot), kind (a vampire, a robot...), public tags, the day it was made.
- ${c.ties} ties (ties.jsonl) on eight layers (kin, romance, friendship, work, place, conflict, acquaintance,
  communication): kind, direction, valence (-2..2), closeness (0..1), status, who made it (source), what it came from
  (kinds of record, never their ids), when it started, ended and last had contact, and the model that wrote any of it.
- ${c.tie_events} changes to those ties (tie_events.jsonl), append-only: the graph can be replayed to any day.
- ${c.people} off-screen people (people.jsonl): a character's mum or boss, by name, never a real person.
- ${c.places} places (places.jsonl) and ${c.memberships} memberships (memberships.jsonl): the show's town, its venues and
  the house, and who lives, works or is a regular where.
- ${c.metrics} daily metric rows (metrics.jsonl): each character's degree, centrality (PageRank, betweenness), clustering,
  k-core, community, Burt's constraint, signed triads and Dunbar ring sizes, per layer and overall.
- ${c.network_daily} days of whole-network numbers (network_daily.jsonl): size, density, clustering, modularity,
  communities, the largest component, assortativity, balance and reciprocity.
- **Ids** are pseudonyms: an HMAC of the id under a salt this version alone has. Two versions can't be joined on them.
- **No personal data.** No account id, handle or email; who declared or answered a tie is never in it.

## Collection process
- **Derived** ties come only from what aired publicly: public dates, house scenes, group nights, a season's cast.
  Never from a character's private opinions, what it heard, what it wants, its private soul, the private relationship
  layer, a private character's dates, or After Dark.
- **Declared** ties, people and places were made by owners (about their own characters), agents, the show's generator
  or an admin, and only the public ones are here.
- **Models.** Some rows were written by a model (origin_model, prompt_version). This version includes ${models} writing.

## Consent and filtering
- Every character is the show's own or its owner opted in to training (lib/ml-consent.ts), judged at the time of each
  tie; a private character, a deleted account's character, and anything not public are left out.
- Left out of this version: ${x.ties_not_public} ties that weren't public, ${x.ties_proposed_or_declined} proposals and
  declined ties, ${x.ties_not_consented_or_private_end} ties with a character that isn't public or opted in, and
  ${x.ties_model_not_allowed} ties written by a model not on the list.
- Story text in a tie's history is dropped (it may have been written while the tie wasn't public).

## Uses
- Fits: network science, link prediction (tie_events dates each tie's first day, so a model can be scored on the ties
  that formed after any cut-off), balance theory, temporal network models, simulation of fictional social worlds.
- Doesn't fit: anything about real people. Every character is fictional; their ties are the show's story.

## Known gaps
- The network is young: most ties are derived from dates and the house, so romance and acquaintance dominate.
- Closeness moves with aired contact and decays with time since; a day without contact is not evidence of anything.
- Opted-in owners are a minority, so people's characters are under-represented next to the show's cast.
- metrics.jsonl and network_daily.jsonl were measured on the whole public network, including characters that aren't
  in this version: a character's degree can be higher than its ties here.

## Distribution and maintenance
- Shared only under a licence that forbids re-identification. Never uploaded by this script.
- A character deleted after this version was built is gone from the next one.
- Contact: the address on botchelor.com/contact.
`;
}

/** Writes the folder: every JSONL file, datasheet.md and manifest.json (counts, sha256 and bytes). Returns the paths. */
export function writeSocialDataset(dir, set) {
  if (existsSync(dir)) throw new Error(`${dir} exists: a version is written once`);
  mkdirSync(dir, { recursive: true });
  const files = {};
  for (const name of FILES) {
    const body = jsonl(set.files[name]);
    writeFileSync(join(dir, `${name}.jsonl`), body);
    files[`${name}.jsonl`] = { rows: set.files[name].length, bytes: Buffer.byteLength(body), sha256: sha256(body) };
  }
  const sheet = datasheet(set);
  writeFileSync(join(dir, "datasheet.md"), sheet);
  files["datasheet.md"] = { bytes: Buffer.byteLength(sheet), sha256: sha256(sheet) };
  const manifest = { name: DATASET_NAME, version: set.version, created_at: set.created_at, counts: set.counts, files, filters: set.filters, excluded: set.excluded };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifest };
}

export function parseArgs(argv) {
  const o = { out: join(ROOT, ".data", "social-dataset"), version: new Date().toISOString().slice(0, 10), allowModels: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") o.out = resolve(argv[++i]);
    else if (a === "--version") o.version = argv[++i];
    else if (a === "--allow-model") {
      const v = argv[++i] ?? "";
      o.allowModels = v === "all" ? "all" : [...(o.allowModels === "all" ? [] : o.allowModels), ...v.split(",").map((s) => s.trim()).filter(Boolean)];
    } else if (a === "--db") o.db = argv[++i];
    else if (a === "--pglite") o.pglite = argv[++i];
    else if (a === "--include-after-dark") throw new Error("After Dark is never exported: the privacy page promises it's never used for training");
    else throw new Error(`unknown option ${a}`);
  }
  if (!/^[\w.-]+$/.test(o.version)) throw new Error("--version is letters, digits, dots and dashes");
  return o;
}

/** The version's salt: kept beside the folder (never in it), made once. */
export function saltFor(out, version) {
  const file = join(out, `${version}.salt`);
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(out, { recursive: true });
  const salt = randomBytes(32).toString("hex");
  writeFileSync(file, `${salt}\n`, { mode: 0o600 });
  return salt;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const db = await openDb({ db: o.db, pglite: o.pglite });
  try {
    const set = await buildSocialDataset(db.query, {
      consent: await loadConsent(),
      origin: await loadOrigin(),
      salt: saltFor(o.out, o.version),
      allowModels: o.allowModels,
      version: o.version,
    });
    const { dir } = writeSocialDataset(join(o.out, o.version), set);
    console.error(`[social-dataset] ${Object.entries(set.counts).map(([k, v]) => `${v} ${k}`).join(", ")} to ${dir}`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`[social-dataset] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
