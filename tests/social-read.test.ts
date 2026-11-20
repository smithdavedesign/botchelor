import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getPair } from "@/app/api/social/pair/[a]/[b]/route";
import { GET as getSky } from "@/app/api/social/sky/route";
import { GET as getWorld } from "@/app/api/social/world/[id]/route";
import { setDbForTests } from "@/lib/db";
import { invalidateGraph } from "@/lib/graph-cache";
import { addPerson } from "@/lib/social/people";
import { ensurePlace, setMembership } from "@/lib/social/places";
import { CO_MEMBERS_KEPT, egoNetwork, pairTies, publicSky } from "@/lib/social/read";
import { upsertTie } from "@/lib/social/ties";
import type { EgoNetwork, PairTies, PlaceKind, PlaceRole, SocialSky, TieInput } from "@/lib/social/types";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// The read layer (lib/social/read.ts, docs/PRDs/social-network.md sections 8 and 9): a world, a pair and the sky show
// what's public, a viewer who owns an end what's theirs too, and a private character's pairs as existence only. The
// routes cache the public builds like the Constellation (lib/social/cache.ts); Next's data cache doesn't exist under
// vitest, so this file stands in a faithful little one, as tests/graph-cache.test.ts does.

const cache = vi.hoisted(() => ({ entries: new Map<string, unknown>() }));
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => Promise<unknown>, keys: string[], opts: { tags?: string[] }) =>
    async (...args: unknown[]) => {
      const key = `${(opts.tags ?? []).join(",")}|${keys.join(",")}-${JSON.stringify(args)}`;
      if (!cache.entries.has(key)) cache.entries.set(key, await fn(...args));
      return cache.entries.get(key);
    },
  revalidateTag: (tag: string) => {
    for (const key of [...cache.entries.keys()]) if (key.split("|")[0].split(",").includes(tag)) cache.entries.delete(key);
  },
}));

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
  setDbForTests(null);
});
beforeEach(async () => {
  await t.reset();
  setDbForTests(t.db);
  cache.entries.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** Each character's owner: a cookie, and its person id. */
const cookies = Object.fromEntries(["ada", "bea", "cal", "dee", "eve", "fin", "hal", "ivy"].map((k) => [k, newUserCookie()])) as Record<string, string>;
const owner = (k: string) => userIdOf(cookies[k]);
const ID = (k: string) => `sr-${k}`;
const [ADA, BEA, CAL, DEE, EVE, FIN, HAL, IVY, GUS, PAT] = ["ada", "bea", "cal", "dee", "eve", "fin", "hal", "ivy", "gus", "pat"].map(ID);
const ordered = (x: string, y: string) => (x < y ? [x, y] : [y, x]);

async function character(k: string, o: { owner?: string; visibility?: string; hue?: number } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, avatar_hue, extras)
     values ($1, $2, false, $3, 30, 'Keeps bees and opinions.', '["kind"]'::jsonb, 'someone kind', 'liars', $4, $5, '{}'::jsonb)`,
    [ID(k), o.owner ?? owner(k), `Read ${k[0].toUpperCase()}${k.slice(1)}`, o.visibility ?? "public", o.hue ?? null],
  );
}
const tie = async (input: TieInput) => {
  const w = await upsertTie(t.db, input);
  if (!w.ok) throw new Error(`tie refused: ${w.reason}`);
  return w.tie;
};
async function place(key: string, kind: PlaceKind, name: string) {
  return (await ensurePlace(t.db, { key: `sr-${key}`, kind, name, source: "admin" })).id;
}
const member = (placeId: string, k: string, role: PlaceRole, o: { visibility?: "public" | "owner"; ended?: boolean } = {}) =>
  setMembership(t.db, { placeId, characterId: ID(k), role, source: "owner", visibility: o.visibility ?? "public", ...(o.ended ? { ended_at: "2026-11-01T00:00:00.000Z" } : {}) });

/**
 * Ada's world: a friend (Bea), a feud (Cal), her mum, a secret sister, an owner-only coworker (Dee), a proposal (Fin), a
 * declined one (Hal), a private tie, two ties to a private character (Eve), and ties to a deleted account's character
 * (Gus) and a persona (Pat). Places: the dive bar (Ada and Bea regulars, Eve too but she's private), Leeds (Ada, Cal,
 * Ivy), the lighthouse (Ada; Dee only owner-visible; Hal left), the house and the city (everyone lives there: not shared),
 * and a school only Ada's owner sees.
 */
async function adasWorld() {
  for (const k of ["ada", "bea", "cal", "dee", "fin", "hal", "ivy"]) await character(k);
  await character("eve", { visibility: "private", hue: 200 });
  await character("gus", { owner: "deleted" });
  await character("pat", { owner: "you:someone" });
  const mum = await addPerson(t.db, { holderId: ADA, name: "Mum", source: "owner" });
  const sis = await addPerson(t.db, { holderId: ADA, name: "Secret sister", source: "owner", visibility: "owner" });
  if (!mum.ok || !sis.ok) throw new Error("people");
  await tie({ from: ADA, to: BEA, kind: "friend", source: "owner", origin_model: "test-model" });
  await tie({ from: ADA, to: CAL, kind: "feud", source: "derived", evidence: { ref: "episode:e1", at: "2026-11-02T20:00:00.000Z" } });
  await tie({ from: ADA, toPerson: mum.person.id, kind: "parent", source: "owner" });
  await tie({ from: ADA, toPerson: sis.person.id, kind: "sibling", source: "owner", visibility: "owner" });
  await tie({ from: ADA, to: DEE, kind: "coworker", source: "owner", visibility: "owner" });
  await tie({ from: ADA, to: FIN, kind: "best_friend", source: "owner", status: "proposed" });
  await tie({ from: ADA, to: HAL, kind: "friend", source: "owner", status: "declined" });
  await tie({ from: ADA, to: BEA, kind: "crush", source: "owner", visibility: "private" });
  await tie({ from: ADA, to: EVE, kind: "sibling", source: "owner" });
  await tie({ from: ADA, to: EVE, kind: "rival", source: "house" });
  await tie({ from: ADA, to: GUS, kind: "friend", source: "owner" });
  await tie({ from: ADA, to: PAT, kind: "friend", source: "owner" });
  const bar = await place("dive-bar", "venue", "the dive bar");
  const leeds = await place("leeds", "hometown", "Leeds");
  const lighthouse = await place("lighthouse", "workplace", "the lighthouse");
  const house = await place("house", "house", "The house");
  const city = await place("city", "city", "Heartsease-on-Sea");
  const school = await place("school", "school", "St Mary's");
  for (const k of ["ada", "bea", "eve"]) await member(bar, k, "regular");
  for (const k of ["ada", "cal", "ivy"]) await member(leeds, k, "from");
  await member(lighthouse, "ada", "works");
  await member(lighthouse, "dee", "works", { visibility: "owner" });
  await member(lighthouse, "hal", "works", { ended: true });
  for (const k of ["ada", "bea"]) await member(house, k, "lives");
  for (const k of ["ada", "cal"]) await member(city, k, "lives");
  await member(school, "ada", "studied", { visibility: "owner" });
  return { mum: mum.person.id, sis: sis.person.id, bar, leeds, lighthouse, house, city, school };
}

const kinds = (w: { ties: { kind: string }[] }) => w.ties.map((x) => x.kind).sort();
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("a character's world", () => {
  it("shows the public ties, people and shared places; a private character's pair as existence only; never the rest", async () => {
    const p = await adasWorld();
    const w = (await egoNetwork(t.db, ADA))!;
    expect(w.centre).toEqual({ id: ADA, name: "Read Ada", private: false, portrait: null, hue: null });
    expect(kinds(w)).toEqual(["feud", "friend", "parent"]);
    // Eve's two ties: one entry, no kind, no id.
    const [a, b] = ordered(ADA, EVE);
    expect(w.masked).toEqual([{ a, b, masked: true }]);
    expect(w.ties.some((x) => x.from === EVE || x.to === EVE)).toBe(false);
    // Every end it names is a node (Ivy through Leeds). The deleted account's and the persona's characters vanish; the
    // owner-only, proposed and declined ones aren't here.
    expect(ids(w.nodes)).toEqual([BEA, CAL, EVE, IVY].sort());
    expect(w.nodes.find((n) => n.id === EVE)).toEqual({ id: EVE, name: "Read Eve", private: true, portrait: null, hue: null });
    expect(w.people.map((x) => x.name)).toEqual(["Mum"]);
    expect(w.people[0]).not.toHaveProperty("created_by");
    expect(w.memberships.map((m) => m.role).sort()).toEqual(["from", "lives", "lives", "regular", "works"]);
    // Shared: the dive bar with Bea (not private Eve), Leeds with Cal and Ivy; not the house or the city, not Dee's
    // owner-only lighthouse or Hal's ended one.
    expect(w.shared.map((s) => `${s.words}: ${s.a === ADA ? s.b : s.a}`).sort()).toEqual(
      [`Both from Leeds: ${CAL}`, `Both from Leeds: ${IVY}`, `Regulars at the dive bar: ${BEA}`].sort(),
    );
    expect(w.shared.find((s) => s.role === "regular")).toMatchObject({ layer: "place", place_id: p.bar });
    expect(ids(w.places)).toEqual([p.bar, p.leeds, p.lighthouse, p.house, p.city].sort());
    // Rings: mum (a parent) in the inner circle; Bea a friend; Cal (a feud) and Ivy (Leeds) acquaintances.
    expect(w.rings).toEqual({ inner: [p.mum], close: [], friends: [BEA], acquaintances: [CAL, IVY], beyond: [] });
    expect(w.personal).toBe(false);
    // Nothing a page mustn't have: the person columns, the model, an owner's id.
    const text = JSON.stringify(w);
    for (const banned of ["created_by", "answered_by", "origin_model", "test-model", "owner_id", owner("ada"), "Secret sister", "crush", "best_friend", "coworker"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("its owner sees their own too: owner-only ties and people, proposals waiting, and the private character's ties", async () => {
    const p = await adasWorld();
    const w = (await egoNetwork(t.db, ADA, { viewer: owner("ada") }))!;
    expect(kinds(w)).toEqual(["best_friend", "coworker", "feud", "friend", "parent", "rival", "sibling", "sibling"]);
    expect(w.ties.find((x) => x.kind === "best_friend")).toMatchObject({ status: "proposed", to: FIN });
    expect(w.ties.find((x) => x.kind === "coworker")).toMatchObject({ visibility: "owner" });
    expect(w.masked).toEqual([]);
    // Eve isn't theirs: her node stays name-only.
    expect(w.nodes.find((n) => n.id === EVE)).toMatchObject({ private: true, hue: null });
    expect(w.people.map((x) => x.name).sort()).toEqual(["Mum", "Secret sister"]);
    expect(w.memberships.find((m) => m.place_id === p.school)).toMatchObject({ role: "studied", visibility: "owner" });
    // The proposal isn't a ring yet; the sister is in the inner circle with mum.
    expect(w.rings.inner.sort()).toEqual([p.mum, p.sis, EVE].sort());
    expect(w.rings.close).not.toContain(FIN);
    expect(w.personal).toBe(true);
    expect(JSON.stringify(w)).not.toContain(owner("ada"));
  });

  it("the owner of a character tied to it sees that tie, and their own character in full; nothing else of Ada's", async () => {
    await adasWorld();
    const w = (await egoNetwork(t.db, ADA, { viewer: owner("eve") }))!;
    expect(kinds(w)).toEqual(["feud", "friend", "parent", "rival", "sibling"]);
    expect(w.nodes.find((n) => n.id === EVE)).toEqual({ id: EVE, name: "Read Eve", private: true, portrait: null, hue: 200 });
    expect(w.people.map((x) => x.name)).toEqual(["Mum"]);
    expect(w.personal).toBe(true);
    // Dee's owner sees the owner-only coworker tie; Fin's the proposal.
    expect(kinds((await egoNetwork(t.db, ADA, { viewer: owner("dee") }))!)).toContain("coworker");
    expect(kinds((await egoNetwork(t.db, ADA, { viewer: owner("fin") }))!)).toContain("best_friend");
  });

  it("a private character's world is its name and its pairs' existence, except to its owner; unlisted ones are null", async () => {
    await adasWorld();
    const w = (await egoNetwork(t.db, EVE))!;
    const [a, b] = ordered(ADA, EVE);
    expect(w).toMatchObject({ centre: { id: EVE, private: true, hue: null }, ties: [], masked: [{ a, b, masked: true }], people: [], memberships: [], shared: [], personal: false });
    expect(w.rings).toEqual({ inner: [], close: [], friends: [], acquaintances: [], beyond: [] });
    const mine = (await egoNetwork(t.db, EVE, { viewer: owner("eve") }))!;
    expect(mine.centre).toMatchObject({ private: true, hue: 200 });
    expect(kinds(mine)).toEqual(["rival", "sibling"]);
    expect(mine.memberships.map((m) => m.role)).toEqual(["regular"]);
    expect(mine.personal).toBe(true);
    for (const id of [GUS, PAT, "sr-nobody"]) expect(await egoNetwork(t.db, id)).toBeNull();
    expect(await egoNetwork(t.db, ADA, { env: { SOCIAL_TIES: "0" } })).toBeNull();
  });

  it("names at most CO_MEMBERS_KEPT of a place's other members", async () => {
    await character("ada");
    const bar = await place("big-bar", "venue", "the big bar");
    await member(bar, "ada", "regular");
    for (let i = 0; i < 60; i++) {
      await character(`r${i}`, { owner: owner("bea") });
      await member(bar, `r${i}`, "regular");
    }
    const w = (await egoNetwork(t.db, ADA))!;
    expect(w.shared).toHaveLength(CO_MEMBERS_KEPT);
    expect(w.rings.acquaintances).toHaveLength(CO_MEMBERS_KEPT);
  });
});

describe("a pair", () => {
  it("has every tie between them, their history with a ref only while it's still evidence, and the places they share", async () => {
    const p = await adasWorld();
    // The feud's date was withdrawn and another made it: the first ref goes from the tie, and from its history.
    await tie({ from: ADA, to: CAL, kind: "feud", source: "derived", evidence: [{ ref: "episode:e2", at: "2026-11-05T20:00:00.000Z" }], wholeEvidence: true, valence: -2 });
    const pt = (await pairTies(t.db, CAL, ADA))!;
    const [a] = ordered(ADA, CAL);
    expect(pt.a.id).toBe(a);
    expect(kinds(pt)).toEqual(["feud"]);
    expect(pt.ties[0]).toMatchObject({ source_ref: "episode:e2", evidence: [{ ref: "episode:e2" }], valence: -2 });
    expect(pt.events.map((e) => [e.event, e.source_ref])).toEqual([
      ["created", null],
      ["changed", "episode:e2"],
    ]);
    expect(pt.events[1].changes).toMatchObject({ valence: [-1, -2] });
    expect(pt.events[0]).not.toHaveProperty("actor");
    expect(pt.shared).toEqual([{ ...{ a: ordered(ADA, CAL)[0], b: ordered(ADA, CAL)[1] }, place_id: p.leeds, role: "from", layer: "place", words: "Both from Leeds" }]);
    expect(ids(pt.places)).toEqual([p.leeds]);
    expect(pt.personal).toBe(false);
    // A declared tie's history never says which model wrote it.
    const ab = (await pairTies(t.db, ADA, BEA))!;
    expect(kinds(ab)).toEqual(["friend"]);
    expect(ab.events[0].changes).not.toHaveProperty("origin_model");
    expect(ab.shared.map((s) => s.words)).toEqual(["Regulars at the dive bar"]);
  });

  it("is null for a pair touching a private character unless the viewer owns one, an unlisted one, or nothing at all", async () => {
    await adasWorld();
    expect(await pairTies(t.db, ADA, EVE)).toBeNull();
    const mine = (await pairTies(t.db, ADA, EVE, { viewer: owner("ada") }))!;
    expect(kinds(mine)).toEqual(["rival", "sibling"]);
    expect(mine.personal).toBe(true);
    expect(mine.b.id === EVE ? mine.b : mine.a).toMatchObject({ private: true, hue: null });
    expect(kinds((await pairTies(t.db, ADA, DEE, { viewer: owner("dee") }))!)).toEqual(["coworker"]);
    expect(await pairTies(t.db, ADA, DEE)).toBeNull();
    for (const [x, y] of [
      [ADA, GUS],
      [ADA, PAT],
      [ADA, HAL],
      [BEA, CAL],
      [ADA, ADA],
    ])
      expect(await pairTies(t.db, x, y)).toBeNull();
    // Only a place in common is still something.
    const only = (await pairTies(t.db, CAL, IVY))!;
    expect(only).toMatchObject({ ties: [], events: [], shared: [{ role: "from", words: "Both from Leeds" }] });
  });
});

describe("the sky", () => {
  async function sky(): Promise<Record<string, SocialSky>> {
    await adasWorld();
    await tie({ from: BEA, to: CAL, kind: "sibling", source: "owner" });
    await tie({ from: BEA, to: CAL, kind: "told", source: "derived", evidence: { ref: "scene:s1#2" } });
    await tie({ from: CAL, to: IVY, kind: "rival", source: "house", status: "ended" });
    const out: Record<string, SocialSky> = {};
    for (const lens of ["friends", "rivals", "gossip", "all"] as const) out[lens] = (await publicSky(t.db, lens))!;
    return out;
  }
  const lines = (s: SocialSky) => s.ties.map((x) => `${x.kind}:${ordered(x.from, x.to).join("|")}`);

  it("each lens draws its layers' public ties between public characters, strongest first, and counts the whole lens", async () => {
    const s = await sky();
    expect(lines(s.friends)).toEqual([`sibling:${ordered(BEA, CAL).join("|")}`, `friend:${ordered(ADA, BEA).join("|")}`]);
    expect(s.friends.stats).toEqual({ ties: 2, shown: 2, byKind: { sibling: { active: 1, ended: 0 }, friend: { active: 1, ended: 0 } } });
    expect(lines(s.rivals).sort()).toEqual([`feud:${ordered(ADA, CAL).join("|")}`, `rival:${ordered(CAL, IVY).join("|")}`].sort());
    expect(s.rivals.stats.byKind.rival).toEqual({ active: 0, ended: 1 });
    expect(s.gossip.ties).toEqual([expect.objectContaining({ kind: "told", from: BEA, to: CAL, directed: true, layer: "communication" })]);
    expect(s.all.ties).toHaveLength(5);
    // A lens would tell a masked pair's layer: only `all` has them, and the private character only there, by name.
    for (const lens of ["friends", "rivals", "gossip"]) expect(s[lens].masked).toEqual([]);
    const [a, b] = ordered(ADA, EVE);
    expect(s.all.masked).toEqual([{ a, b, masked: true }]);
    expect(s.all.nodes.find((n) => n.id === EVE)).toEqual({ id: EVE, name: "Read Eve", private: true, portrait: null, hue: null });
    expect(s.friends.nodes.some((n) => n.id === EVE)).toBe(false);
    for (const lens of Object.values(s)) for (const id of [GUS, PAT, DEE, FIN, HAL]) expect(JSON.stringify(lens)).not.toContain(id);
    // Capped: the strongest one, the counts still the whole lens.
    const one = (await publicSky(t.db, "friends", { limit: 1 }))!;
    expect(lines(one)).toEqual([`sibling:${ordered(BEA, CAL).join("|")}`]);
    expect(one.stats).toMatchObject({ ties: 2, shown: 1 });
  });

  it("names the places two or more public characters share, as groups, on friends and all", async () => {
    const s = await sky();
    const groups = (x: SocialSky) => x.places.map((p) => `${p.words} (${p.count}): ${[...p.members].sort().join(",")}`);
    expect(groups(s.friends)).toEqual([`Both from Leeds (3): ${[ADA, CAL, IVY].sort().join(",")}`, `Regulars at the dive bar (2): ${[ADA, BEA].sort().join(",")}`]);
    expect(groups(s.all)).toEqual(groups(s.friends));
    expect(s.rivals.places).toEqual([]);
    expect(s.gossip.places).toEqual([]);
    expect(ids(s.friends.nodes)).toEqual([ADA, BEA, CAL, IVY].sort());
    expect(await publicSky(t.db, "all", { env: { SOCIAL_TIES: "0" } })).toBeNull();
  });
});

describe("the routes", () => {
  const get = (path: string, cookie?: string) => new Request(BASE_URL + path, { headers: cookie ? { cookie } : {} });
  const world = async (id: string, cookie?: string) => {
    const res = await getWorld(get(`/api/social/world/${id}`, cookie), { params: Promise.resolve({ id }) });
    return { status: res.status, body: (await res.json()) as EgoNetwork & { error?: string } };
  };
  const pair = async (a: string, b: string, cookie?: string) => {
    const res = await getPair(get(`/api/social/pair/${a}/${b}`, cookie), { params: Promise.resolve({ a, b }) });
    return { status: res.status, body: (await res.json()) as PairTies & { error?: string } };
  };

  it("a world: the public build cached until the Constellation's tag drops; an owner's own build, never cached", async () => {
    await adasWorld();
    const first = await world(ADA);
    expect(first.status).toBe(200);
    expect(kinds(first.body)).toEqual(["feud", "friend", "parent"]);
    await tie({ from: ADA, to: IVY, kind: "friend", source: "owner" });
    expect(kinds((await world(ADA)).body)).toEqual(["feud", "friend", "parent"]);
    invalidateGraph();
    expect(kinds((await world(ADA)).body)).toEqual(["feud", "friend", "friend", "parent"]);
    // Ada's owner: theirs, at once.
    await tie({ from: ADA, to: HAL, kind: "coworker", source: "owner", visibility: "owner" });
    const own = await world(ADA, cookies.ada);
    expect(own.body.personal).toBe(true);
    expect(kinds(own.body)).toContain("best_friend");
    expect(own.body.ties.filter((x) => x.kind === "coworker").map((x) => x.to).sort()).toEqual([DEE, HAL].sort());
    // Someone who owns nothing in it shares the public build.
    expect((await world(ADA, newUserCookie())).body.personal).toBe(false);
    // A centre that goes private is never served its public build.
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [ADA]);
    expect((await world(ADA)).body).toMatchObject({ centre: { private: true }, ties: [], people: [] });
    for (const id of [GUS, "sr-nobody", "not an id"]) expect((await world(id)).status).toBe(404);
    vi.stubEnv("SOCIAL_TIES", "0");
    expect((await world(BEA)).status).toBe(404);
  });

  it("a pair: 404 when it touches a private character the asker doesn't own; the sky's lens checked", async () => {
    await adasWorld();
    expect((await pair(ADA, CAL)).status).toBe(200);
    expect((await pair(ADA, EVE)).status).toBe(404);
    const own = await pair(EVE, ADA, cookies.eve);
    expect(own.status).toBe(200);
    expect(kinds(own.body)).toEqual(["rival", "sibling"]);
    expect((await pair(ADA, ADA)).status).toBe(404);
    expect((await pair(BEA, CAL)).status).toBe(404);

    const rivals = await getSky(get("/api/social/sky?lens=rivals"));
    expect(rivals.status).toBe(200);
    expect(rivals.headers.get("cache-control")).toBe("public, max-age=60");
    expect(((await rivals.json()) as SocialSky).ties.map((x) => x.kind)).toEqual(["feud"]);
    expect(((await (await getSky(get("/api/social/sky"))).json()) as SocialSky).lens).toBe("all");
    const bad = await getSky(get("/api/social/sky?lens=love"));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "unknown_lens", lenses: ["friends", "rivals", "gossip", "all"] });
    vi.stubEnv("SOCIAL_TIES", "0");
    expect((await getSky(get("/api/social/sky?lens=all"))).status).toBe(404);
    expect((await pair(ADA, CAL)).status).toBe(404);
  });
});
