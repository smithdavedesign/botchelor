import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postOriginality } from "@/app/api/characters/originality/route";
import { POST as postReflection } from "@/app/api/episodes/[id]/reflection/route";
import { deleteCharacter, exportAccount } from "@/lib/account";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { backfillEmbeddings, clearEmbedCacheForTests, conceptTwinsOf, EMBED_DIMS, refreshConceptEmbedding } from "@/lib/originality-concept";
import { loadRelationship, viewRelationship } from "@/lib/relationships";
import { createTemplateParty } from "@/lib/watch";
import { api, episodeJson, HOUSE_PARTNER_ID, jsonRequest, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

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
});

/** A vector that depends on the text, so different characters read differently (unless `same` pins one for all). */
function vectorFor(text: string): number[] {
  const v = Array.from({ length: EMBED_DIMS }, () => 0);
  for (let i = 0; i < text.length; i++) v[(text.charCodeAt(i) * 31 + i) % EMBED_DIMS] += 1;
  return v;
}
/** Turns concept checks on with a stubbed embedding API; returns the calls it saw. */
function embeddingsOn(opts: { status?: number; same?: number[] } = {}) {
  vi.stubEnv("ORIGINALITY_CONCEPT", "1");
  vi.stubEnv("EMBED_API_KEY", "test-embed-key");
  const calls: { url: string; headers: Record<string, string>; body: Any }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (!String(url).includes(":embedContent")) throw new Error(`unexpected fetch ${url}`);
      const body = JSON.parse(String(init.body));
      calls.push({ url: String(url), headers: init.headers as Record<string, string>, body });
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
    expect(await backfillEmbeddings(t.db, 1)).toEqual({ made: 1, failed: 0 });
    expect(await backfillEmbeddings(t.db, 10)).toEqual({ made: 1, failed: 0 });
    expect(await embeddingRow(a.id)).toBeDefined();
    expect(await embeddingRow(b.id)).toBeDefined();
    expect(await embeddingRow(gone.id)).toBeUndefined();
    expect((await t.db.query(`select 1 from character_embeddings e join characters c on c.id = e.character_id where c.is_house`)).rows).toHaveLength(0);
    expect(await backfillEmbeddings(t.db, 10)).toEqual({ made: 0, failed: 0 });
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
