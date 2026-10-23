import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postOriginality } from "@/app/api/characters/originality/route";
import { POST as postReflection } from "@/app/api/episodes/[id]/reflection/route";
import { GET as dailyJob } from "@/app/api/jobs/daily/route";
import { deleteCharacter, exportAccount } from "@/lib/account";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setInlineGenerationForTests } from "@/lib/jobs";
import { ORIGINALITY_CHECK_LIMITS, visitorKey } from "@/lib/limits";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import {
  BACKFILL_MIN_CALL_MS,
  backfillEmbeddings,
  checkTimeoutMs,
  clearEmbedCacheForTests,
  conceptText,
  conceptTwinsOf,
  DEFAULT_EMBED_DAILY_CAP,
  DEFAULT_EMBED_MODEL,
  EMBED_CHECK_TIMEOUT_MS,
  EMBED_DIMS,
  EMBED_SLOW_TIMEOUT_MS,
  embedCallsToday,
  embedDailyCap,
  embedKey,
  refreshConceptEmbedding,
  textHash,
} from "@/lib/originality-concept";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { loadRelationship, viewRelationship } from "@/lib/relationships";
import { createTemplateParty } from "@/lib/watch";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, jsonRequest, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  clearEmbedCacheForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetRateLimitsForTests();
});

/** A vector that depends on the text, so different characters read differently (unless `same` pins one for all). */
function vectorFor(text: string): number[] {
  const v = Array.from({ length: EMBED_DIMS }, () => 0);
  for (let i = 0; i < text.length; i++) v[(text.charCodeAt(i) * 31 + i) % EMBED_DIMS] += 1;
  return v;
}
/**
 * Turns concept checks on with a stubbed embedding API; returns the calls it saw. `respond` answers a call itself
 * (`n` counts from 1).
 */
function embeddingsOn(opts: { status?: number; same?: number[]; respond?: (init: RequestInit, n: number) => Response | Promise<Response> } = {}) {
  vi.stubEnv("ORIGINALITY_CONCEPT", "1");
  vi.stubEnv("EMBED_API_KEY", "test-embed-key");
  const calls: { url: string; headers: Record<string, string>; body: Any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (!String(url).includes(":embedContent")) throw new Error(`unexpected fetch ${url}`);
      const body = JSON.parse(String(init.body));
      calls.push({ url: String(url), headers: init.headers as Record<string, string>, body });
      if (opts.respond) return opts.respond(init, calls.length);
      if (opts.status && opts.status !== 200) return new Response("nope", { status: opts.status });
      return new Response(JSON.stringify({ embedding: { values: opts.same ?? vectorFor(body.content.parts[0].text) } }), { status: 200 });
    }),
  );
  return calls;
}
const embeddingRow = async (id: string) =>
  (await t.db.query<Any>(`select model, text_hash, jsonb_array_length(embedding) as dims from character_embeddings where character_id = $1`, [id])).rows[0];
const make = async (overrides: Record<string, unknown> = {}, cookie = newUserCookie()) =>
  ({ ...(await (await api.createCharacter(validCharacter(overrides), cookie)).json()), cookie }) as Any;

describe("concept embeddings (lib/originality-concept.ts)", () => {
  it("does nothing while off: no call, no row", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const c = await make();
    expect(await refreshConceptEmbedding(t.db, c.id)).toBe("skipped");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await embeddingRow(c.id)).toBeUndefined();
  });

  it("embeds a new character once, re-embeds only when what it's like changes, and never logs the key", async () => {
    const calls = embeddingsOn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const c = await make({ name: "Ira Fenn" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("gemini-embedding-001:embedContent");
    expect(calls[0].headers["x-goog-api-key"]).toBe("test-embed-key");
    expect(calls[0].body).toMatchObject({ taskType: "SEMANTIC_SIMILARITY", outputDimensionality: EMBED_DIMS });
    const first = await embeddingRow(c.id);
    expect(first).toMatchObject({ model: "gemini-embedding-001", dims: EMBED_DIMS });
    expect(first.text_hash).toMatch(/^[0-9a-f]{32}$/);

    // The same text again, even with the in-process cache cleared: the stored hash says there's nothing to do.
    clearEmbedCacheForTests();
    expect((await api.editCharacter(c.id, { name: "Ira Fenn-Ott" }, c.cookie)).status).toBe(200); // not part of the concept
    expect((await api.editCharacter(c.id, { bio: validCharacter().bio }, c.cookie)).status).toBe(200); // unchanged bio
    expect(calls).toHaveLength(1);
    expect((await api.editCharacter(c.id, { bio: "Restores carousel horses and names every one after a lost aunt." }, c.cookie)).status).toBe(200);
    expect(calls).toHaveLength(2);
    expect((await embeddingRow(c.id)).text_hash).not.toBe(first.text_hash);
    // A kind is part of the concept (lib/kinds.ts).
    expect((await api.editCharacter(c.id, { extras: { kind: "vampire" } }, c.cookie)).status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(calls[2].body.content.parts[0].text).toMatch(/Is: Vampire\./);

    const logged = log.mock.calls.flat().join("\n");
    expect(logged).toMatch(/\[embed\] 200 gemini-embedding-001/);
    expect(logged).not.toContain("test-embed-key");
  });

  it("a failed call stores nothing and never breaks the save", async () => {
    const calls = embeddingsOn({ status: 500 });
    const c = await make();
    expect(c.id).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(await embeddingRow(c.id)).toBeUndefined();
    expect(await refreshConceptEmbedding(t.db, c.id)).toBe("failed");
  });

  it("the daily backfill catches up within its cap, never the house cast or a deleted account's", async () => {
    const a = await make({ name: "Ada One", bio: "Tunes pipe organs in empty churches at night." });
    const b = await make({ name: "Bo Two", bio: "Paints lighthouses from memory, never from life." });
    const gone = await make({ name: "Cy Three", bio: "Collects broken metronomes and fixes none of them." });
    await t.db.query(`update characters set owner_id = 'deleted' where id = $1`, [gone.id]);
    embeddingsOn();
    const ran = { failed: 0, skipped: 0, stopped: null, key_from: "EMBED_API_KEY" };
    expect(await backfillEmbeddings(t.db, { limit: 1 })).toEqual({ ...ran, made: 1 });
    expect(await backfillEmbeddings(t.db, { limit: 10 })).toEqual({ ...ran, made: 1 });
    expect(await embeddingRow(a.id)).toBeDefined();
    expect(await embeddingRow(b.id)).toBeDefined();
    expect(await embeddingRow(gone.id)).toBeUndefined();
    expect((await t.db.query(`select 1 from character_embeddings e join characters c on c.id = e.character_id where c.is_house`)).rows).toHaveLength(0);
    expect(await backfillEmbeddings(t.db, { limit: 10 })).toEqual({ ...ran, made: 0 });
  });

  it("a twin is only ever a public character of a live account, from the same model", async () => {
    const vec = vectorFor("organ tuner");
    const pub = await make({ name: "Pia Public" });
    const priv = await make({ name: "Pri Vate" });
    const gone = await make({ name: "Del Eted" });
    const old = await make({ name: "Old Model" });
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [priv.id]);
    await t.db.query(`update characters set owner_id = 'deleted' where id = $1`, [gone.id]);
    for (const c of [pub, priv, gone]) {
      await t.db.query(`insert into character_embeddings (character_id, embedding, model) values ($1, $2::jsonb, 'gemini-embedding-001')`, [c.id, JSON.stringify(vec)]);
    }
    await t.db.query(`insert into character_embeddings (character_id, embedding, model) values ($1, $2::jsonb, 'text-embedding-004')`, [old.id, JSON.stringify(vec)]);
    const twins = await conceptTwinsOf(t.db, vec, null, 0.88, "gemini-embedding-001");
    expect(twins.map((x) => x.name)).toEqual(["Pia Public"]);
    expect(twins[0].why).toMatch(/same idea in other words/);
  });

  it("the originality check names a concept twin only while it's on, and never a private character", async () => {
    const same = vectorFor("one idea");
    const twin = await make({ name: "Orla Pipe", bio: "Keeps the last four pipe organs in the county breathing." });
    await t.db.query(`insert into character_embeddings (character_id, embedding, model) values ($1, $2::jsonb, 'gemini-embedding-001')`, [twin.id, JSON.stringify(same)]);
    const draft = { name: "Wren Hale", bio: "A church organ tuner with perfect pitch and no patience.", traits: ["exacting", "dry", "kind"], want: "someone who hums in tune" };
    const check = async () => (await (await postOriginality(jsonRequest("/api/characters/originality", draft, { cookie: newUserCookie() }))).json()) as Any;

    expect(JSON.stringify((await check()).similar)).not.toContain("Orla Pipe");
    embeddingsOn({ same });
    const on = await check();
    expect(on.similar).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Orla Pipe", why: expect.stringMatching(/same idea in other words/) })]));
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [twin.id]);
    expect(JSON.stringify((await check()).similar)).not.toContain("Orla Pipe");
  });

  it("the word-based look-alikes leave out private characters and deleted accounts' too", async () => {
    const hidden = await make({ name: "Ira Fenn" });
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [hidden.id]);
    const gone = await make({ name: "Quill Marrow" });
    await t.db.query(`update characters set owner_id = 'deleted' where id = $1`, [gone.id]);
    for (const name of ["Ira Fenn", "Quill Marrow"]) {
      const r = (await (await postOriginality(jsonRequest("/api/characters/originality", { ...validCharacter(), name }, { cookie: newUserCookie() }))).json()) as Any;
      expect(JSON.stringify(r.similar)).not.toContain(name);
    }
    await t.db.query(`update characters set visibility = 'public' where id = $1`, [hidden.id]);
    const r = (await (await postOriginality(jsonRequest("/api/characters/originality", { ...validCharacter(), name: "Ira Fenn" }, { cookie: newUserCookie() }))).json()) as Any;
    expect(JSON.stringify(r.similar)).toContain("Ira Fenn");
  });

  it("forgetting a character takes its embedding", async () => {
    embeddingsOn();
    const c = await make();
    expect(await embeddingRow(c.id)).toBeDefined();
    // A tombstone (it aired) keeps the character row, so the cascade alone wouldn't.
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides, transcript, revealed_at)
       values ('ep-gone', 'x', $1, $2, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'friends', 'ready', '[]'::jsonb, '[]'::jsonb, now())`,
      [c.id, HOUSE_PARTNER_ID],
    );
    await deleteCharacter(t.db, userIdOf(c.cookie), c.id);
    expect(await embeddingRow(c.id)).toBeUndefined();
  });
});

describe("embedding limits, latency and the daily job (the 2026-10-22 review on #678)", () => {
  const secret = ["cron", "tier2", "secret", "0123456789"].join("-");
  const runDailyJob = async () => {
    vi.stubEnv("CRON_SECRET", secret);
    scriptedModel([]); // the job's other steps get no model: they fail fast and are caught
    return dailyJob(new Request(`${BASE_URL}/api/jobs/daily?backfill=0`, { headers: { authorization: `Bearer ${secret}` } }));
  };
  /** A call that never answers: it ends only when its timeout aborts it. */
  const hang = (init: RequestInit) =>
    new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject((init.signal as AbortSignal).reason)));
  const logged = () => vi.mocked(console.log).mock.calls.flat().join("\n");
  const rpc = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> =>
    ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx)) as Any).result;
  /** Characters made while concept checks are off, so none has an embedding yet. */
  const unembedded = async (n: number) => {
    const made = [];
    for (let i = 0; i < n; i++) made.push(await make({ name: `Backfill Nr${i}`, bio: `Character number ${i} keeps ${i + 2} lighthouses lit by hand.` }));
    return made;
  };

  it("the key: EMBED_API_KEY first, then the show's own Google key; the logs name the variable once, never its value", async () => {
    expect(embedKey({ EMBED_API_KEY: "e", GOOGLE_API_KEY: "g", LLM_API_KEY: "l" })).toEqual({ key: "e", from: "EMBED_API_KEY" });
    expect(embedKey({ GOOGLE_API_KEY: "g", LLM_API_KEY: "l" })).toEqual({ key: "g", from: "GOOGLE_API_KEY" });
    expect(embedKey({ LLM_API_KEY: "l" })).toEqual({ key: "l", from: "LLM_API_KEY" });
    expect(embedKey({ LLM_API_KEY: "l", LLM_BASE_URL: "https://api.example.com/v1" })).toEqual({ key: "", from: null });

    // Prod today: no EMBED_API_KEY, so the calls use GOOGLE_API_KEY, and the logs say which (once per process).
    const calls = embeddingsOn();
    vi.stubEnv("EMBED_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "show-google-key");
    await make({ name: "Ada One", bio: "Tunes pipe organs in empty churches at night." });
    await make({ name: "Bo Two", bio: "Paints lighthouses from memory, never from life." });
    expect(calls.map((c) => c.headers["x-goog-api-key"])).toEqual(["show-google-key", "show-google-key"]);
    expect(logged().match(/\[embed\] key from GOOGLE_API_KEY/g)).toHaveLength(1);
    expect(logged()).not.toContain("show-google-key");
  });

  it("the backfill stops at its deadline: no call it can't finish in time, the rest left for the next run", async () => {
    await unembedded(5);
    let clock = 0;
    // Each call takes 5 s on this clock; the deadline is 12 s in. Calls start at 0, 5 and 10 s; the fourth would start at
    // 15 s, past it.
    const calls = embeddingsOn({
      respond: (init) => {
        clock += 5000;
        return new Response(JSON.stringify({ embedding: { values: vectorFor(JSON.parse(String(init.body)).content.parts[0].text) } }), { status: 200 });
      },
    });
    const run = await backfillEmbeddings(t.db, { deadline: 12_000, now: () => clock });
    expect(run).toEqual({ made: 3, failed: 0, skipped: 2, stopped: "deadline", key_from: "EMBED_API_KEY" });
    expect(calls).toHaveLength(3);
    // Under a second left: no call at all.
    clock = 0;
    expect(await backfillEmbeddings(t.db, { deadline: BACKFILL_MIN_CALL_MS - 1, now: () => clock })).toMatchObject({ made: 0, skipped: 2, stopped: "deadline" });
    expect(calls).toHaveLength(3);
    // The next run picks up the rest.
    expect(await backfillEmbeddings(t.db)).toMatchObject({ made: 2, skipped: 0, stopped: null });
  });

  it("the first 429 ends the batch (pushing on would only hit the same quota)", async () => {
    await unembedded(4);
    const calls = embeddingsOn({ status: 429 });
    expect(await backfillEmbeddings(t.db)).toEqual({ made: 0, failed: 1, skipped: 3, stopped: "rate_limited", key_from: "EMBED_API_KEY" });
    expect(calls).toHaveLength(1);
  });

  it("so does the first timeout, and no call outlives the deadline", async () => {
    await unembedded(3);
    const calls = embeddingsOn({ respond: hang });
    const started = Date.now();
    // 1.2 s to the deadline: the one call it makes is cut off there, not at the usual 8 s.
    const run = await backfillEmbeddings(t.db, { deadline: started + 1200 });
    expect(Date.now() - started).toBeLessThan(EMBED_SLOW_TIMEOUT_MS / 2);
    expect(run).toMatchObject({ made: 0, failed: 1, skipped: 2, stopped: "timeout" });
    expect(calls).toHaveLength(1);
  });

  it("the daily job gives the backfill a deadline from its own start, and reports made, failed and skipped", async () => {
    await unembedded(2);
    const calls = embeddingsOn();
    // A run that has already used 280 s by the time it reaches the backfill (its 270 s deadline has passed): no call.
    const real = Date.now.bind(Date);
    let t0: number | null = null;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (t0 === null ? (t0 = real()) : real() + 280_000));
    const late = await (await runDailyJob()).json();
    clock.mockRestore();
    expect(late.embeddings).toEqual({ made: 0, failed: 0, skipped: 2, stopped: "deadline", key_from: "EMBED_API_KEY" });
    expect(calls).toHaveLength(0);
    const report = logged()
      .split("\n")
      .find((l) => l.includes('"event":"daily_job"'));
    expect(JSON.parse(report!)).toMatchObject({ embeddings_made: 0, embeddings_skipped: 2, embeddings_stopped: "deadline", embeddings_key: "EMBED_API_KEY" });
    // On time, it catches up.
    expect((await (await runDailyJob()).json()).embeddings).toEqual({ made: 2, failed: 0, skipped: 0, stopped: null, key_from: "EMBED_API_KEY" });
    expect(calls).toHaveLength(2);
  });

  it("the draft check is limited per connection and per session, like the other free paths (429)", async () => {
    const post = (headers: Record<string, string>) =>
      postOriginality(new Request(`${BASE_URL}/api/characters/originality`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(validCharacter()) }));
    const fill = (bucket: string, key: string) =>
      t.db.query(`insert into rate_hits (bucket, key, at) select $1, $2, now() from generate_series(1, $3)`, [bucket, key, ORIGINALITY_CHECK_LIMITS.perHour]);
    const ip = { "x-forwarded-for": "203.0.113.7" };
    expect((await post({ ...ip, cookie: newUserCookie() })).status).toBe(200);
    await fill("originality", visitorKey(new Headers(ip))!);
    const limited = await post({ ...ip, cookie: newUserCookie() });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "too_many_checks" });
    expect((await post({ "x-forwarded-for": "203.0.113.8", cookie: newUserCookie() })).status).toBe(200);
    // One session from many addresses (or in-process, with none: MCP check_originality).
    const cookie = newUserCookie();
    await fill("originality_user", userIdOf(cookie));
    expect((await post({ cookie })).status).toBe(429);
  });

  it("a daily cap on embedding calls, every caller together: past it the concept pass is skipped and the word check still runs", async () => {
    vi.stubEnv("EMBED_DAILY_CAP", "2");
    expect(embedDailyCap({})).toBe(DEFAULT_EMBED_DAILY_CAP);
    const calls = embeddingsOn();
    await make({ name: "Ira Fenn" }); // call 1: its save
    const check = (bio: string) => postOriginality(jsonRequest("/api/characters/originality", { ...validCharacter({ name: "Ira Fenn" }), bio }, { cookie: newUserCookie() }));
    expect((await check("Builds kites out of old maps and flies them over the harbour.")).status).toBe(200); // call 2
    expect(calls).toHaveLength(2);
    const over = await check("Repairs church bells and rings each one once a year.");
    expect(over.status).toBe(200);
    // The word-based check still ran: the same name is still called out.
    expect((await over.json()).similar).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Ira Fenn" })]));
    // MCP check_originality and create_character run the same code, under the same cap.
    const checked = await rpc("check_originality", { ...validCharacter({ name: "Cy Marr" }), bio: "Times solar eclipses for a living, to the second." });
    expect(checked.isError).toBeUndefined();
    const created = await rpc("create_character", validCharacter({ name: "Juno Reyes", bio: "Keeps bees on the roof of a bank nobody works at." }));
    expect(created.isError).toBeUndefined();
    expect(calls).toHaveLength(2);
    expect(logged().match(/\[embed\] daily cap reached \(2\)/g)).toHaveLength(1);
    // Two made, one refused; after that the process doesn't ask the database again today.
    expect(await embedCallsToday(t.db)).toBe(3);
  });

  it("an interactive check waits briefly, then falls back to the word-based twins and says so in the logs", async () => {
    expect(checkTimeoutMs({})).toBe(EMBED_CHECK_TIMEOUT_MS);
    expect([EMBED_CHECK_TIMEOUT_MS, EMBED_SLOW_TIMEOUT_MS]).toEqual([2500, 8000]);
    await make({ name: "Ira Fenn" }); // made while off: no embedding
    vi.stubEnv("EMBED_CHECK_TIMEOUT_MS", "50");
    const calls = embeddingsOn({ respond: hang });
    const started = Date.now();
    const res = await postOriginality(jsonRequest("/api/characters/originality", validCharacter({ name: "Ira Fenn" }), { cookie: newUserCookie() }));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(res.status).toBe(200);
    expect((await res.json()).similar).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Ira Fenn" })]));
    expect(calls).toHaveLength(1);
    expect(logged()).toMatch(/\[embed\] check slower than 50ms: word-based twins only/);
  });

  it("end to end: a new character embeds after the response, the daily job backfills the rest, an unchanged edit costs nothing", async () => {
    const queued: (() => unknown)[] = [];
    vi.doMock("next/server", async (importOriginal) => ({ ...(await importOriginal<object>()), after: (fn: () => unknown) => void queued.push(fn) }));
    setInlineGenerationForTests(false);
    try {
      const calls = embeddingsOn();
      const a = await make({ name: "Ada Lantern", bio: "Restores lighthouse lenses by hand on an island nobody visits." });
      const b = await make({ name: "Bo Quill", bio: "Writes the crossword for a newspaper that stopped printing in 1998." });
      // The saves didn't wait on the embedding API: one job each, queued for after the response.
      expect(calls).toHaveLength(0);
      expect(queued).toHaveLength(2);
      await queued[0](); // a's runs; b's is lost (say its instance was cut off), so the daily job has one to catch up
      queued.length = 0;
      expect(calls).toHaveLength(1);
      expect(await embeddingRow(b.id)).toBeUndefined();

      expect((await (await runDailyJob()).json()).embeddings).toEqual({ made: 1, failed: 0, skipped: 0, stopped: null, key_from: "EMBED_API_KEY" });
      expect(calls).toHaveLength(2);
      for (const c of [a, b]) {
        const sheet = (await t.db.query<Any>(`select bio, traits, want, extras from characters where id = $1`, [c.id])).rows[0];
        expect(await embeddingRow(c.id)).toEqual({ model: DEFAULT_EMBED_MODEL, text_hash: textHash(DEFAULT_EMBED_MODEL, conceptText(sheet)), dims: EMBED_DIMS });
      }

      // Edits that don't change what it's like cost nothing, even with the in-process cache cleared: the stored hash says so.
      clearEmbedCacheForTests();
      expect((await api.editCharacter(a.id, { name: "Ada Lantern-Ross" }, a.cookie)).status).toBe(200);
      expect((await api.editCharacter(a.id, { bio: "Restores lighthouse lenses by hand on an island nobody visits." }, a.cookie)).status).toBe(200);
      for (const run of queued.splice(0)) await run();
      expect(calls).toHaveLength(2);
      // The next daily run has nothing to do.
      expect((await (await runDailyJob()).json()).embeddings).toMatchObject({ made: 0, failed: 0, skipped: 0 });
      // A real change re-embeds, after the response again.
      expect((await api.editCharacter(a.id, { bio: "Restores carousel horses and names each one after a lost aunt." }, a.cookie)).status).toBe(200);
      expect(calls).toHaveLength(2);
      for (const run of queued.splice(0)) await run();
      expect(calls).toHaveLength(3);
    } finally {
      setInlineGenerationForTests(true);
      vi.doUnmock("next/server");
    }
  });
});

describe("structured reflection labels (lib/reflection-labels.ts)", () => {
  const reflect = (episodeId: string, body: unknown, cookie: string) =>
    postReflection(jsonRequest(`/api/episodes/${episodeId}/reflection`, body, { cookie }), { params: Promise.resolve({ id: episodeId }) });

  async function bookedDate() {
    const owner = newUserCookie();
    const mine = await make({ name: "Ira Fenn" }, owner);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await (await api.createEpisode({ character_id: mine.id, partner_id: HOUSE_PARTNER_ID }, owner)).json()) as Any;
    return { owner, mine, episodeId: ep.id as string };
  }

  it("saves a side's labels alone or with words, merging later calls, and refuses what doesn't fit (422)", async () => {
    const { owner, mine, episodeId } = await bookedDate();
    expect((await reflect(episodeId, { rating: 4 }, newUserCookie())).status).toBe(404);
    expect((await reflect(episodeId, {}, owner)).status).toBe(422);
    expect((await reflect(episodeId, { rating: 6 }, owner)).status).toBe(422);
    expect((await reflect(episodeId, { worked: ["vibes"] }, owner)).status).toBe(422);
    expect((await reflect(episodeId, { worked: ["humour", "pacing", "energy", "values"] }, owner)).status).toBe(422);
    expect((await reflect(episodeId, { worked: ["humour"], didnt: ["humour"] }, owner)).status).toBe(422);

    const first = await reflect(episodeId, { rating: 4, would_date_again: true, worked: ["humour", "listening"] }, owner);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ character_id: mine.id, labels: { rating: 4, would_date_again: true, worked: ["humour", "listening"] } });
    const second = await (await reflect(episodeId, { rating: 3, didnt: ["pacing"], reflection: "I rushed the ending. Next time, slower." }, owner)).json();
    expect(second).toMatchObject({ reflection: "I rushed the ending. Next time, slower.", labels: { rating: 3, would_date_again: true, worked: ["humour", "listening"], didnt: ["pacing"] } });
    const stored = (await t.db.query<Any>(`select reflection_labels, reflections from episodes where id = $1`, [episodeId])).rows[0];
    expect(stored.reflection_labels).toEqual({ a: { rating: 3, would_date_again: true, worked: ["humour", "listening"], didnt: ["pacing"] }, b: null });
    expect(stored.reflections.a).toBe("I rushed the ending. Next time, slower.");

    // An unsafe reflection saves nothing, labels included.
    expect((await reflect(episodeId, { rating: 1, reflection: "Watched porn after." }, owner)).status).toBe(422);
    expect((await t.db.query<Any>(`select reflection_labels->'a'->>'rating' as r from episodes where id = $1`, [episodeId])).rows[0].r).toBe("3");
  });

  it("never reaches the public episode or the other side; it's in the owner's export and goes when forgotten", async () => {
    const { owner, mine, episodeId } = await bookedDate();
    await reflect(episodeId, { rating: 5, would_date_again: false, worked: ["the_venue"] }, owner);
    await api.reveal(episodeId, owner);
    for (const cookie of [undefined, newUserCookie(), owner]) {
      const body = JSON.stringify(await (await api.getEpisode(episodeId, cookie)).json());
      expect(body).not.toMatch(/reflection_labels|would_date_again|the_venue/);
    }
    const exported = await exportAccount(t.db, userIdOf(owner));
    expect(exported.reflection_labels).toEqual([{ episode_id: episodeId, character_id: mine.id, labels: { rating: 5, would_date_again: false, worked: ["the_venue"] } }]);
    await deleteCharacter(t.db, userIdOf(owner), mine.id);
    expect((await t.db.query<Any>(`select reflection_labels from episodes where id = $1`, [episodeId])).rows[0].reflection_labels).toEqual({ a: null, b: null });
  });

  it("over MCP, reflect_on_date takes the labels with or without the words", async () => {
    const ctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx);
    const session: McpContext = { sessionId: ctx.issuedSessionId };
    const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
      (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, session))!.result;
    const id = (await call("create_character", validCharacter({ name: "Agent Lark" }))).structuredContent.character.id;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID })).structuredContent.episode.id;
    const r = await call("reflect_on_date", { episode_id: ep, rating: 2, would_date_again: false, didnt: ["energy"] });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ labels: { rating: 2, would_date_again: false, didnt: ["energy"] } });
    expect((await call("reflect_on_date", { episode_id: ep, worked: ["vibes"] })).isError).toBe(true);
  });
});

describe("how they met (DateSetup.met_via)", () => {
  const metVia = async (episodeId: string) => (await t.db.query<Any>(`select setup->>'met_via' as m from episodes where id = $1`, [episodeId])).rows[0].m;
  const book = async (body: Record<string, unknown>, cookie: string) => {
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode(body, cookie);
    expect(res.status).toBe(200);
    return ((await res.json()) as Any).id as string;
  };

  it("records a pick, a blind date, a match, a show room and an agents' own date, and keeps it off the public relationship", async () => {
    const owner = newUserCookie();
    const mine = await make({ name: "Ira Fenn" }, owner);
    const picked = await book({ character_id: mine.id, partner_id: HOUSE_PARTNER_ID }, owner);
    expect(await metVia(picked)).toBe("chosen");
    expect(await metVia(await book({ character_id: mine.id, blind: true }, owner))).toBe("blind");

    const other = await make({ name: "Quill Marrow", open_to_dates: true });
    const [lo, hi] = [mine.id, other.id].sort();
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi, agreed_at) values ($1, $2, true, true, now())`, [lo, hi]);
    expect(await metVia(await book({ character_id: mine.id, partner_id: other.id }, owner))).toBe("match");

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const room = await createTemplateParty(t.db, HOUSE_CHARACTERS[1].id, HOUSE_CHARACTERS[2].id);
    if (!room?.ok) throw new Error("no room");
    const roomEp = (await t.db.query<Any>(`select id from episodes where character_a = $1 and character_b = $2`, [HOUSE_CHARACTERS[1].id, HOUSE_CHARACTERS[2].id])).rows[0].id;
    expect(await metVia(roomEp)).toBe("show");

    // The relationship keeps it server-side; the owner's and the public view never show it.
    await api.reveal(picked, owner);
    const rel = await loadRelationship(t.db, mine.id, HOUSE_PARTNER_ID);
    expect(rel!.history.map((h) => h.met_via)).toContain("chosen");
    expect(JSON.stringify(viewRelationship(rel!, { userId: userIdOf(owner), owner: true }))).not.toContain("met_via");
    expect(JSON.stringify(viewRelationship(rel!, { userId: null, owner: false }))).not.toContain("met_via");
  });

  it("a failed match lookup never fails the booking: the date goes ahead without a met_via", async () => {
    const owner = newUserCookie();
    const mine = await make({ name: "Ira Fenn" }, owner);
    const query = t.db.query.bind(t.db);
    let failed = 0;
    vi.spyOn(t.db, "query").mockImplementation(((sql: string, params?: unknown[]) =>
      /^select 1 from characters c where c\.id = \$1 and /.test(sql) && ++failed ? Promise.reject(new Error("db blip")) : query(sql, params)) as typeof t.db.query);
    const id = await book({ character_id: mine.id, partner_id: HOUSE_PARTNER_ID }, owner);
    vi.mocked(t.db.query).mockRestore();
    expect(failed).toBe(1);
    expect(await metVia(id)).toBeNull();
  });

  it("an agents' own date is own_date", async () => {
    const ctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx);
    const session: McpContext = { sessionId: ctx.issuedSessionId };
    const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
      (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, session))!.result;
    const a = (await call("create_character", validCharacter({ name: "Agent Ash" }))).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Agent Birch" }))).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: a, partner_id: b })).structuredContent;
    const episodeId = step.episode_id ?? step.step?.episode_id;
    expect(await metVia(episodeId)).toBe("own_date");
  });
});
