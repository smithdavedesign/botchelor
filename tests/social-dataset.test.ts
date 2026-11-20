// The social network dataset (scripts/social/export-dataset.mjs; docs/PRDs/social-network.md sections 8 and 10;
// docs/data-plan.md "Social network dataset"): only public rows of public, opted-in characters, no account id and no
// raw id anywhere, the model filter, a story from a tie's private past dropped, and a manifest whose hashes match.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import * as consent from "@/lib/ml-consent";
import * as origin from "@/lib/origin";
import { DELETED_OWNER } from "@/lib/rules";
import { buildSocialDataset, FILES, parseArgs, pseudonym, saltFor, writeSocialDataset } from "../scripts/social/export-dataset.mjs";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from ml_consents");
  await t.db.query("delete from social_places");
});
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "social-dataset-"));
  dirs.push(d);
  return d;
};

const SALT = "test-salt";
const query = async (sql: string, params: unknown[] = []) => (await t.db.query(sql, params)).rows as Record<string, unknown>[];
const build = (allowModels: string[] | "all" = []) => buildSocialDataset(query, { consent, origin, salt: SALT, allowModels, version: "test" });
const [H1, H2, H3] = HOUSE_CHARACTERS.map((c) => c.id);
const YES = "ds-yes";
const NO = "ds-no";
const HIDDEN = "ds-hidden";
const GONE = "ds-gone";
const ACCOUNTS = ["u-yes", "u-no", "u-hidden"];

async function character(id: string, owner: string, visibility = "public") {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
     values ($1, $2, false, $3, 30, 'x', '["dry"]'::jsonb, 'x', 'x', $4)`,
    [id, owner, `Name ${id}`, visibility],
  );
}
let serial = 0;
const TIES: Record<string, string> = {};
async function tie(name: string, from: string, to: string | null, kind: string, layer: string, o: { visibility?: string; status?: string; model?: string | null; toPerson?: string; source?: string; createdBy?: string } = {}) {
  const id = `ds-tie-${++serial}`;
  TIES[name] = id;
  await t.db.query(
    `insert into social_ties (id, from_id, to_id, to_person_id, kind, layer, status, visibility, source, origin_model, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, from, to, o.toPerson ?? null, kind, layer, o.status ?? "active", o.visibility ?? "public", o.source ?? "house", o.model ?? null, o.createdBy ?? null],
  );
  return id;
}

/**
 * The house's three, an opted-in owner's character, one whose owner never opted in, an opted-in owner's private one, a
 * deleted account's. Every way a row can be left out has a row.
 */
async function world() {
  await character(YES, "u-yes");
  await character(NO, "u-no");
  await character(HIDDEN, "u-hidden", "private");
  await character(GONE, DELETED_OWNER);
  for (const u of ["u-yes", "u-hidden"]) {
    await t.db.query(`insert into ml_consents (user_id, granted, version, decided_at) values ($1, true, $2, '2026-11-01')`, [u, consent.ML_CONSENT_VERSION]);
  }
  await t.db.query(`insert into social_people (id, holder_id, name, source, visibility) values ('ds-mum', $1, 'Mum', 'house', 'public'), ('ds-secret', $1, 'Secret', 'house', 'owner')`, [H1]);
  const friends = await tie("friends", H1, H2, "friend", "friendship", { source: "derived" });
  await tie("rivals", H2, H3, "rival", "conflict", { status: "ended" });
  await tie("coworkers", H1, YES, "coworker", "work", { source: "owner", createdBy: "u-yes" });
  await tie("unconsented", H1, NO, "friend", "friendship");
  await tie("private", H1, HIDDEN, "friend", "friendship");
  await tie("deleted", H1, GONE, "friend", "friendship");
  await tie("owner_only", H2, H3, "friend", "friendship", { visibility: "owner" });
  await tie("proposed", H1, H3, "best_friend", "friendship", { status: "proposed" });
  await tie("mum", H1, null, "parent", "kin", { toPerson: "ds-mum" });
  await tie("secret", H1, null, "sibling", "kin", { toPerson: "ds-secret" });
  await tie("model", H2, YES, "friend", "friendship", { model: "closed-model-x" });
  await t.db.query(
    `insert into social_tie_events (tie_id, event, changes, source, actor) values ($1, 'created', $2::jsonb, 'owner', 'u-yes')`,
    [friends, JSON.stringify({ layer: [null, "friendship"], story: [null, "PRIVATE-STORY-TEXT"] })],
  );
  await t.db.query(
    `insert into social_places (id, key, kind, name, source, visibility) values
       ('ds-kitchen', 'house:kitchen', 'room', 'The kitchen', 'house', 'public'),
       ('ds-leeds', 'hometown:leeds', 'hometown', 'Leeds', 'owner', 'public'),
       ('ds-den', 'secret:den', 'hangout', 'The den', 'owner', 'private')`,
  );
  await t.db.query(
    `insert into social_place_members (place_id, character_id, role, source, visibility) values
       ('ds-leeds', $1, 'from', 'owner', 'public'), ('ds-den', $2, 'regular', 'owner', 'public'), ('ds-leeds', $3, 'from', 'owner', 'public')`,
    [YES, H1, NO],
  );
  await t.db.query(`insert into social_metrics (character_id, day, layer, degree) values ($1, '2026-11-19', 'all', 2), ($2, '2026-11-19', 'all', 1)`, [H1, NO]);
  await t.db.query(`insert into social_network_daily (day, nodes, complete) values ('2026-11-18', 5, true), ('2026-11-19', 5, false)`);
}

const c = (id: string) => pseudonym(SALT, "c", id);
const tid = (name: string) => pseudonym(SALT, "t", TIES[name]);

describe("buildSocialDataset", () => {
  it("holds only public rows of public, opted-in characters", async () => {
    await world();
    const set = await build();
    const nodes = set.files.nodes.map((n) => n.id);
    expect(nodes).toEqual(expect.arrayContaining([c(H1), c(H2), c(H3), c(YES)]));
    for (const out of [NO, HIDDEN, GONE]) expect(nodes).not.toContain(c(out));
    expect(set.files.ties.map((x) => x.id).sort()).toEqual([tid("friends"), tid("rivals"), tid("coworkers"), tid("mum")].sort());
    expect(set.files.ties.find((x) => x.id === tid("mum"))).toMatchObject({ from: c(H1), to: null, to_person: pseudonym(SALT, "p", "ds-mum"), kind: "parent" });
    expect(set.files.people.map((p) => p.name)).toEqual(["Mum"]);
    expect(set.files.places.map((p) => p.key).sort()).toEqual(["hometown:leeds", "house:kitchen"]);
    expect(set.files.memberships).toEqual([expect.objectContaining({ place: pseudonym(SALT, "pl", "ds-leeds"), character: c(YES), role: "from" })]);
    expect(set.files.metrics.map((m) => m.character)).toEqual([c(H1)]);
    expect(set.files.network_daily.map((d) => d.day)).toEqual(["2026-11-18"]);
    // Only the owners could see one; one is a proposal; four have an end that's out (no yes, private, deleted, a person
    // only the owner sees); one was written by a model that isn't on the list.
    expect(set.excluded).toEqual({ ties_not_public: 1, ties_proposed_or_declined: 1, ties_not_consented_or_private_end: 4, ties_model_not_allowed: 1 });
    // Its history, without who did it or the story it had before it was public.
    expect(set.files.tie_events).toEqual([{ tie: tid("friends"), event: "created", changes: { layer: [null, "friendship"] }, source: "owner", at: expect.any(String) }]);
  });

  it("lets a model's writing in only when it's on the list", async () => {
    await world();
    expect((await build()).files.ties.map((x) => x.id)).not.toContain(tid("model"));
    expect((await build(["closed-model-x"])).files.ties.map((x) => x.id)).toContain(tid("model"));
    expect((await build("all")).files.ties.map((x) => x.id)).toContain(tid("model"));
    expect((await build(["other-model"])).excluded.ties_model_not_allowed).toBe(1);
  });

  it("an owner who takes their yes back takes their character out", async () => {
    await world();
    await t.db.query(`update ml_consents set granted = false where user_id = 'u-yes'`);
    const set = await build();
    expect(set.files.nodes.map((n) => n.id)).not.toContain(c(YES));
    expect(set.files.ties.map((x) => x.id)).not.toContain(tid("coworkers"));
    expect(set.files.memberships).toEqual([]);
  });
});

describe("writeSocialDataset", () => {
  it("writes every file, the datasheet and a manifest whose hashes match, with no raw id or account id anywhere", async () => {
    await world();
    const set = await build();
    const dir = join(tmp(), "test");
    const { manifest } = writeSocialDataset(dir, set);
    expect(readdirSync(dir).sort()).toEqual([...FILES.map((f) => `${f}.jsonl`), "datasheet.md", "manifest.json"].sort());
    for (const [file, meta] of Object.entries(manifest.files)) {
      expect(createHash("sha256").update(readFileSync(join(dir, file))).digest("hex")).toBe(meta.sha256);
    }
    expect(manifest.counts.ties).toBe(4);
    const everything = readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
    for (const raw of [H1, H2, H3, YES, NO, HIDDEN, GONE, ...ACCOUNTS, ...Object.values(TIES), "ds-mum", "ds-leeds", "PRIVATE-STORY-TEXT"]) {
      expect(everything).not.toContain(raw);
    }
    expect(readFileSync(join(dir, "datasheet.md"), "utf8")).toContain("## Motivation");
    // A version is written once.
    expect(() => writeSocialDataset(dir, set)).toThrow(/exists/);
  });

  it("keeps the version's salt beside the folder, and a new version gets a new one", () => {
    const out = tmp();
    const salt = saltFor(out, "v1");
    expect(saltFor(out, "v1")).toBe(salt);
    expect(saltFor(out, "v2")).not.toBe(salt);
    expect(existsSync(join(out, "v1.salt"))).toBe(true);
    expect(pseudonym(salt, "c", H1)).not.toBe(pseudonym(saltFor(out, "v2"), "c", H1));
  });
});

describe("parseArgs", () => {
  it("reads the flags, and never exports After Dark", () => {
    expect(parseArgs(["--version", "v1", "--allow-model", "a,b", "--allow-model", "c"])).toMatchObject({ version: "v1", allowModels: ["a", "b", "c"] });
    expect(parseArgs(["--allow-model", "all"]).allowModels).toBe("all");
    expect(() => parseArgs(["--include-after-dark"])).toThrow(/never exported/);
    expect(() => parseArgs(["--version", "../x"])).toThrow(/letters/);
  });
});
