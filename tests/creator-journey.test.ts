// The creator journey in Real use (lib/creator-journey.ts): of the people who made a character, who went on to the
// Studio, the Gallery, a follower, a watched ending and a chat. Counted from the tables, our own left out, a house
// character and a step-in seat never counted.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimAdmin } from "@/lib/admins";
import { creatorJourney, JOURNEY_STEPS, loadJourney, type JourneyMaker } from "@/lib/creator-journey";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { METRIC_DEFS, MIN_N, realUse, tooSmall } from "@/lib/real-metrics";
import { PERSONA_OWNER_PREFIX } from "@/lib/step-in-shared";
import { startTestDb } from "./helpers";

const NOW = new Date("2026-11-20T12:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const everyone = () => true;
const maker = (user: string, daysAgo: number, steps: Partial<Record<(typeof JOURNEY_STEPS)[number], boolean>> = {}): JourneyMaker => ({
  user,
  made_at: ago(daysAgo),
  studio: false,
  shared: false,
  followed: false,
  watched: false,
  chatted: false,
  ...steps,
});

describe("the count (pure)", () => {
  it("the first step is who made a character in the window; every other step is how many of THOSE did the thing", () => {
    const makers = [
      maker("a", 2, { studio: true, shared: true, followed: true, watched: true, chatted: true }),
      maker("b", 5, { studio: true, chatted: true }),
      maker("c", 6),
      maker("old", 20, { studio: true, watched: true }),
    ];
    expect(creatorJourney(makers, { now: NOW, days: 7, real: everyone })).toEqual({ made: 3, studio: 2, shared: 1, followed: 1, watched: 1, chatted: 2 });
    expect(creatorJourney(makers, { now: NOW, days: 30, real: everyone })).toEqual({ made: 4, studio: 3, shared: 1, followed: 1, watched: 2, chatted: 2 });
  });

  it("the steps are independent, not a chain: a later one can be larger than an earlier one", () => {
    const makers = [maker("a", 1, { chatted: true }), maker("b", 1, { chatted: true, watched: true })];
    expect(creatorJourney(makers, { now: NOW, days: 7, real: everyone })).toMatchObject({ made: 2, studio: 0, watched: 1, chatted: 2 });
  });

  it("leaves out whoever the caller says is not a person of ours to count, and anyone made after now", () => {
    const makers = [maker("real", 1, { studio: true }), maker("ours", 1, { studio: true }), maker("future", -1, { studio: true })];
    expect(creatorJourney(makers, { now: NOW, days: 7, real: (id) => id !== "ours" })).toMatchObject({ made: 1, studio: 1 });
    expect(creatorJourney([], { now: NOW, days: 7, real: everyone })).toEqual({ made: 0, studio: 0, shared: 0, followed: 0, watched: 0, chatted: 0 });
  });
});

describe("from the database", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await t.db.query("delete from admins");
    await t.db.query("delete from web_events");
    await t.db.query("delete from character_follows");
    await t.db.query("delete from showcase_posts");
    await t.db.query("delete from studio_pg_shoots");
  });

  // Names nobody's script uses: "Mira Quell", the harness's default, is one of our own test names (lib/our-traffic.ts).
  const NAMES: Record<string, string> = { made: "Odalys Brandt", studio: "Corin Ashby", shared: "Ines Calloway", followed: "Marek Dunmore", watched: "Sunniva Hale", chatted: "Teodor Lindh" };
  async function character(id: string, owner: string | null, daysAgo: number, o: { via?: "web" | "mcp"; house?: boolean; name?: string } = {}) {
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_via, created_at)
       values ($1, $2, $3, $4, 30, 'A bio.', '[]'::jsonb, 'Love.', 'Rudeness.', $5, $6)`,
      [id, owner, o.house === true, o.name ?? NAMES[id.replace(/^c-/, "")] ?? `Brannoch ${id}`, o.via ?? "web", ago(daysAgo).toISOString()],
    );
  }
  const shoot = (owner: string, characterId: string, daysAgo = 1) =>
    t.db.query(`insert into studio_pg_shoots (id, owner_id, character_id, status, created_at) values ($1, $2, $3, 'done', $4)`, [`shoot-${owner}-${characterId}`, owner, characterId, ago(daysAgo).toISOString()]);
  const post = (owner: string, characterId: string, status = "live") =>
    t.db.query(
      `insert into showcase_posts (id, owner_id, source, media_id, character_id, rating, medium, status, published_at) values ($1, $2, 'pg', $3, $4, 'pg', 'picture', $5, now())`,
      [`post-${owner}-${status}`, owner, `media-${owner}-${status}`, characterId, status],
    );
  const follow = (user: string, characterId: string) => t.db.query(`insert into character_follows (user_id, character_id) values ($1, $2)`, [user, characterId]);
  const watched = (user: string | null, event = "date_watched") =>
    t.db.query(`insert into web_events (at, visitor, session, user_id, event, path) values ($1, 'visitor-0001', 'session-0001', $2, $3, '/episodes/:id')`, [ago(1).toISOString(), user, event]);
  const thread = (user: string, characterId: string) => t.db.query(`insert into companion_threads (id, user_id, character_id) values ($1, $2, $3)`, [`th-${user}-${characterId}`, user, characterId]);

  it("a person at each step, from the tables that are the truth", async () => {
    // Six people made a character this week; each but the first went one step further.
    for (const who of ["made", "studio", "shared", "followed", "watched", "chatted"]) await character(`c-${who}`, `p-${who}`, 3);
    await shoot("p-studio", "c-studio");
    await post("p-shared", "c-shared");
    await follow("p-made", "c-followed"); // someone else follows their character
    await watched("p-watched");
    await thread("p-chatted", HOUSE_CHARACTERS[0].id);

    const makers = await loadJourney(t.db, ago(30).toISOString(), []);
    expect(makers.map((m) => m.user).sort()).toEqual(["p-chatted", "p-followed", "p-made", "p-shared", "p-studio", "p-watched"]);
    const by = Object.fromEntries(makers.map((m) => [m.user, JOURNEY_STEPS.filter((s) => m[s])]));
    expect(by).toEqual({ "p-made": [], "p-studio": ["studio"], "p-shared": ["shared"], "p-followed": ["followed"], "p-watched": ["watched"], "p-chatted": ["chatted"] });

    // On the admin's Real use section: both windows, each step a share of the first.
    const use = await realUse(t.db, NOW);
    for (const w of use.windows) {
      expect(w.journey.made).toEqual({ kind: "count", value: 6 });
      for (const step of JOURNEY_STEPS) expect(w.journey[step], step).toEqual({ kind: "share", num: 1, den: 6 });
    }
    const defs = METRIC_DEFS.filter((d) => d.section === "journey");
    expect(defs.map((d) => d.key)).toEqual(["made", ...JOURNEY_STEPS]);
    expect(defs.every((d) => d.definition.length > 20)).toBe(true);
    // Six people is enough to show a share; five is the bar (MIN_N).
    expect(MIN_N).toBe(5);
    expect(tooSmall(use.windows[0].journey.studio)).toBe(false);
  });

  it("what does not count at each step", async () => {
    await character("c-made", "p-made", 3);
    await character("c-other", "p-other", 3, { name: "Vesna Orlov" });
    // A shoot someone else ran, a post that is not live, their own follow, a follow by one of our own identities, a
    // different event, a watch with no identity, and someone else's thread: none of them is this person's step.
    await shoot("p-other", "c-other");
    await post("p-made", "c-made", "removed");
    await post("p-made", "c-made", "pending");
    await follow("p-made", "c-made");
    await claimAdmin(t.db, "admin-1");
    await follow("admin-1", "c-made");
    await watched("p-made", "date_started");
    await watched(null);
    await thread("p-other", "c-other");
    const ours = ["admin-1"];
    const made = (await loadJourney(t.db, ago(30).toISOString(), ours)).find((m) => m.user === "p-made")!;
    expect(JOURNEY_STEPS.filter((s) => made[s])).toEqual([]);
    // Without knowing who is ours, the admin's follow would have counted.
    expect((await loadJourney(t.db, ago(30).toISOString(), [])).find((m) => m.user === "p-made")!.followed).toBe(true);
  });

  it("ours are left out, and a house character, an agent's character and a step-in seat are never a character made", async () => {
    await character("c-made", "p-made", 3);
    // Ours: an admin, the owner of one of our own test names, the deleted owner.
    await claimAdmin(t.db, "admin-1");
    await character("c-admin", "admin-1", 3, { name: "Ansel Whitlock" });
    await shoot("admin-1", "c-admin");
    await character("c-test", "p-tester", 3, { name: "Mira Quell" });
    await character("c-deleted", "deleted", 3, { name: "Ludo Farrow" });
    // Not a character someone made on the web: a house character, one an agent made over MCP, a step-in "you".
    await character("house-extra", null, 3, { house: true, name: "Hesper Vane" });
    await character("c-agent", "agent-1", 3, { via: "mcp", name: "Calder Voss" });
    await character("c-you", `${PERSONA_OWNER_PREFIX}p-guest`, 3, { name: "You" });
    await shoot("agent-1", "c-agent");

    const loaded = (await loadJourney(t.db, ago(30).toISOString(), [])).map((m) => m.user).sort();
    expect(loaded).not.toContain("agent-1");
    expect(loaded.some((id) => id.startsWith(PERSONA_OWNER_PREFIX))).toBe(false);
    const use = await realUse(t.db, NOW);
    expect(use.windows.map((w) => w.journey.made)).toEqual([
      { kind: "count", value: 1 },
      { kind: "count", value: 1 },
    ]);
    expect(use.windows[1].journey.studio).toEqual({ kind: "share", num: 0, den: 1 });
  });

  it("a character made before the window is not in it, and a newer one brings its maker back in", async () => {
    await character("c-made", "p-made", 20);
    await shoot("p-made", "c-made", 19);
    let use = await realUse(t.db, NOW);
    expect(use.windows.map((w) => (w.journey.made as { value: number }).value)).toEqual([0, 1]);
    await character("c-second", "p-made", 2, { name: "Rosalind Thackeray" });
    use = await realUse(t.db, NOW);
    expect(use.windows.map((w) => (w.journey.made as { value: number }).value)).toEqual([1, 1]);
    expect(use.windows[0].journey.studio).toEqual({ kind: "share", num: 1, den: 1 });
  });
});
