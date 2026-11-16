import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * How many database round trips each heavy page waits on, one after another (the 2026-11-04 performance audit). The
 * apps run in New York and the database in Oregon, so each round trip costs ~70 ms on prod: a page that waits on 20 in
 * a row spends ~1.4 s before its first byte. Every query here is slowed by LATENCY_MS, so a page's time over LATENCY_MS
 * is its depth: the round trips it waits on in sequence. Budgets keep a page from sliding back.
 */
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined), has: (name: string) => jar.cookies.has(name), getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { setDbForTests, type Db } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

const LATENCY_MS = 30;

let t: Awaited<ReturnType<typeof startTestDb>>;
const counter = { n: 0 };
/** PERF_TRACE=<page name>: each of that page's queries, by the round trip it starts in, and where it came from. */
const trace: { at: number; sql: string; from: string }[] = [];
let traceStart = 0;
/** Prod's pool (lib/db.ts POOL_SIZE): more queries at once than this wait for a free connection. */
const POOL = 10;
let busy = 0;
const waiting: (() => void)[] = [];
const connection = async () => {
  if (busy >= POOL) await new Promise<void>((r) => waiting.push(r));
  busy++;
};
const release = () => {
  busy--;
  waiting.shift()?.();
};
const slow = (db: Db): Db => ({
  query: async <T,>(sql: string, params?: unknown[]) => {
    await connection();
    try {
      return (await timed(sql, params)) as { rows: T[] };
    } finally {
      release();
    }
  },
  exec: (sql) => db.exec(sql),
});
const timed = async (sql: string, params?: unknown[]) => {
  {
    counter.n++;
    if (traceStart) {
      const from = (new Error().stack ?? "").split("\n").slice(2).map((l) => /\/(app|lib)\/([^:]+):(\d+)/.exec(l)).filter(Boolean).slice(0, 2).map((m) => `${m![1]}/${m![2]}:${m![3]}`).join(" < ");
      trace.push({ at: Math.round((performance.now() - traceStart) / LATENCY_MS), sql: sql.replace(/\s+/g, " ").trim().slice(0, 70), from });
    }
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    return t.db.query(sql, params);
  }
};

let owner = "";
let character = "";
let partner = "";
let episode = "";
beforeAll(async () => {
  t = await startTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  owner = newUserCookie();
  character = (await (await api.createCharacter(validCharacter({ name: "Perf Tester", open_to_dates: true }), owner)).json()).id;
  // A character with a real history: eight dates (a bought pack past the free ones), each aired.
  const { userIdOf } = await import("./helpers");
  await t.db.query(
    `insert into orders (id, user_id, sku, kind, amount_cents, currency, status, episodes, paid_at) values ('perf', $1, 'episode_pack_20', 'episode_pack', 1000, 'usd', 'paid', 20, now())`,
    [userIdOf(owner)],
  );
  for (const house of HOUSE_CHARACTERS.slice(0, 8)) {
    scriptOutcome({ ending: "second_date", sides: [side(), side()] });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: character, partner_id: house.id }, owner);
    expect(res.status).toBe(200);
    const ep = await res.json();
    expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
    episode = ep.id;
    partner = house.id;
  }
  setDbForTests(slow(t.db));
}, 120_000);
afterAll(async () => {
  setDbForTests(t.db);
  await t.close();
});

function side() {
  return { wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null };
}

/**
 * Runs a page's server work once cold, then warm (as most requests are), and returns its depth and query count.
 * Depth is wall-clock time, and a busy machine only ever adds to it (other suites, local models): one warm run failed a
 * different page by 1–4 round trips on different runs (2026-11-08) while main and the branch measured the same alone.
 * So the best of WARM_RUNS is the page's own cost; a real extra round trip still adds LATENCY_MS to every run.
 */
const WARM_RUNS = 3;
let tracing = false;
async function measure(run: () => Promise<unknown>) {
  await run().catch(() => {});
  let best = { depth: Infinity, queries: 0, ms: Infinity };
  for (let i = 0; i < WARM_RUNS; i++) {
    counter.n = 0;
    const start = performance.now();
    if (tracing) (trace.length = 0), (traceStart = start);
    await run();
    const ms = performance.now() - start;
    traceStart = 0;
    if (ms < best.ms) best = { depth: Math.round(ms / LATENCY_MS), queries: counter.n, ms: Math.round(ms) };
  }
  return best;
}

const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
};

const report: Record<string, { depth: number; queries: number; ms: number }> = {};

/** A lead season's own page (lib/season-page.ts): its format, then everything else at once (3 on 2026-11-15, the premiere's two inside). */
const SEASON_PAGE_BUDGET = 4;
/**
 * Makes the coming season a lead season with the house lead picked (straight into the tables, unslowed), for the season
 * page's entry: it runs last, so no other page sees a lead season.
 */
async function comingLeadSeason(): Promise<string> {
  const { nextSeasonStart, seasonIdOf } = await import("@/lib/season-window");
  const { seasonRef } = await import("@/lib/season-ref");
  const id = seasonIdOf(nextSeasonStart(new Date()));
  await t.db.query(`insert into season_formats (season_id, slug) values ($1, 'botchelor') on conflict (season_id) do update set slug = excluded.slug`, [id]);
  await t.db.query(`insert into season_leads (season_id, character_id) values ($1, $2) on conflict (season_id) do update set character_id = excluded.character_id`, [id, HOUSE_CHARACTERS[0].id]);
  return seasonRef(id).path.split("/").pop()!;
}
let seasonSlug = "";

/**
 * The most round trips in a row each page may wait on (2026-11-04, after the audit; before it: layout 5, character
 * owner 29, visitor 14, date owner 25, visitor 10, couple owner 25, home 11). A little room over today's, so a page
 * that slides back fails here rather than on prod.
 */
const BUDGET: Record<string, number> = {
  layout: 3,
  "character (owner)": 10,
  "character (visitor)": 7,
  "house character": 7,
  "date (owner)": 9,
  "date (visitor)": 7,
  "couple (owner)": 11,
  relationships: 6,
  "home (owner)": 5,
  "home (visitor)": 3,
  characters: 8,
  watch: 8,
  "matches (owner)": 8,
  "chat (owner)": 7,
  "swipe (owner)": 5,
  "account (owner)": 4,
  "notifications (owner)": 6,
  // The scenes and this week's story map (lib/story-map.ts) side by side: the map's uncached build is the deeper one
  // (its reads at once, then the people; the lead's lookup beside them). On prod every view shares one cached build.
  house: 5,
  graph: 5,
  "season page": SEASON_PAGE_BUDGET,
};

/** Runs `run` with one environment variable set, and puts it back. */
async function withEnv<T>(key: string, value: string, run: () => Promise<T>): Promise<T> {
  const before = process.env[key];
  process.env[key] = value;
  try {
    return await run();
  } finally {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  }
}

describe("heavy pages' round trips (2026-11-04 audit)", () => {
  const pages: [string, string | "owner" | null, () => Promise<unknown>][] = [
    ["layout", "owner", async () => (await import("@/app/layout")).default({ children: null })],
    ["layout (visitor)", null, async () => (await import("@/app/layout")).default({ children: null })],
    ["character (owner)", "owner", async () => (await import("@/app/characters/[id]/page")).default({ params: Promise.resolve({ id: character }), searchParams: Promise.resolve({}) })],
    ["character (visitor)", null, async () => (await import("@/app/characters/[id]/page")).default({ params: Promise.resolve({ id: character }), searchParams: Promise.resolve({}) })],
    ["house character", null, async () => (await import("@/app/characters/[id]/page")).default({ params: Promise.resolve({ id: partner }), searchParams: Promise.resolve({}) })],
    ["date (owner)", "owner", async () => (await import("@/app/episodes/[id]/page")).default({ params: Promise.resolve({ id: episode }), searchParams: Promise.resolve({}) })],
    ["date (visitor)", null, async () => (await import("@/app/episodes/[id]/page")).default({ params: Promise.resolve({ id: episode }), searchParams: Promise.resolve({}) })],
    ["couple (owner)", "owner", async () => (await import("@/app/couples/[a]/[b]/page")).default({ params: Promise.resolve({ a: character, b: partner }), searchParams: Promise.resolve({}) })],
    ["relationships", null, async () => (await import("@/app/characters/[id]/relationships/page")).default({ params: Promise.resolve({ id: character }), searchParams: Promise.resolve({}) })],
    // With companions open, as on prod: the owner's home then loads their character's phone too (lib/character-phone.ts:
    // one read next to "Since you were here"), and the budget holds with it.
    ["home (owner)", "owner", async () => withEnv("COMPANION_OPEN", "1", async () => (await import("@/app/page")).default({ searchParams: Promise.resolve({}) as never }))],
    // A stranger's home: the day's clip (lib/home-clip.ts) rides in the same Promise.all as the boards, so it adds no depth.
    ["home (visitor)", null, async () => (await import("@/app/page")).default({ searchParams: Promise.resolve({}) as never })],
    ["characters", null, async () => (await import("@/app/characters/page")).default({ searchParams: Promise.resolve({}) as never })],
    ["watch", null, async () => (await import("@/app/watch/page")).default({ searchParams: Promise.resolve({}) as never })],
    ["matches (owner)", "owner", async () => (await import("@/app/matches/page")).default({ searchParams: Promise.resolve({}) })],
    // Chat (lib/chat-inbox.ts) with companions open, as on prod: the threads with them ride the round trip that reads
    // their characters, then each character's own threads at once.
    ["chat (owner)", "owner", async () => withEnv("COMPANION_OPEN", "1", async () => (await import("@/app/chat/page")).default({ searchParams: Promise.resolve({}) }))],
    ["swipe (owner)", "owner", async () => (await import("@/app/swipe/page")).default({ searchParams: Promise.resolve({}) as never })],
    ["account (owner)", "owner", async () => (await import("@/app/account/page")).default({ searchParams: Promise.resolve({}) as never })],
    ["notifications (owner)", "owner", async () => (await import("@/app/notifications/page")).default({ searchParams: Promise.resolve({}) })],
    ["house", null, async () => (await import("@/app/house/page")).default({ searchParams: Promise.resolve({}) })],
    ["graph", null, async () => (await import("@/app/graph/page")).default({ searchParams: Promise.resolve({}) })],
    // Last: it makes the coming season a lead season (The Botchelor), so its page is the live one.
    [
      "season page",
      null,
      async () => {
        seasonSlug ||= await comingLeadSeason();
        return (await import("@/app/seasons/[slug]/page")).default({ params: Promise.resolve({ slug: seasonSlug }), searchParams: Promise.resolve({}) });
      },
    ],
  ];
  for (const [name, who, run] of pages) {
    it(name, async () => {
      as(who === "owner" ? owner : null);
      tracing = process.env.PERF_TRACE === name;
      report[name] = await measure(run);
      if (tracing) console.info(`\n${name}:\n` + trace.map((q) => `  ${String(q.at).padStart(3)}  ${q.from.padEnd(70)} ${q.sql}`).join("\n"));
      if (BUDGET[name] !== undefined) expect(report[name].depth, `${name}: ${report[name].depth} round trips in a row`).toBeLessThanOrEqual(BUDGET[name]);
    }, 120_000);
  }
  afterAll(() => {
    console.info(`\nround trips in sequence (depth) and queries, at ${LATENCY_MS} ms each:\n` + Object.entries(report).map(([k, v]) => `  ${k.padEnd(24)} depth ${String(v.depth).padStart(3)}  queries ${String(v.queries).padStart(4)}  ${v.ms} ms`).join("\n"));
  });
});
