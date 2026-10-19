import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { characterSchema } from "@/lib/agents";
import { assembleCharacter, characterBlindView, characterSelfView } from "@/lib/character";
import { surpriseFill } from "@/app/create/DetailsStep";
import { ExtrasInput, normaliseExtras, SUGGESTIONS } from "@/lib/extras";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { checkFields } from "@/lib/safety";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, startTestDb, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const DETAILS = {
  occupation: "Crossword constructor",
  hometown: "A canal town full of bicycles",
  style: "Sharp blazer, sneakers, zero regrets",
  signature_item: "a fountain pen",
  star_sign: "Virgo",
  love_language: "Quality time",
  hobbies: ["Chess", "Stargazing"],
  quirk: "Ranks the city's benches",
  prompts: [{ id: "win_me_over", answer: "Finish my crossword in pen." }],
};

describe("the details' shape", () => {
  it("drops blanks, repeats and unanswered prompts", () => {
    expect(
      normaliseExtras({
        occupation: "  Lighthouse keeper ",
        hometown: "   ",
        hobbies: ["Chess", "Chess", " ", "Pottery"],
        prompts: [
          { id: "win_me_over", answer: "Snacks." },
          { id: "win_me_over", answer: "Again." },
          { id: "geek_out", answer: "   " },
        ],
      } as Any),
    ).toEqual({ occupation: "Lighthouse keeper", hobbies: ["Chess", "Pottery"], prompts: [{ id: "win_me_over", answer: "Snacks." }] });
  });

  it("refuses unknown keys, too many hobbies or prompts, and over-long answers", () => {
    expect(ExtrasInput.safeParse({ favourite_celebrity: "x" }).success).toBe(false);
    expect(ExtrasInput.safeParse({ hobbies: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
    expect(ExtrasInput.safeParse({ prompts: Array.from({ length: 4 }, (_, i) => ({ id: "geek_out", answer: `x${i}` })) }).success).toBe(false);
    expect(ExtrasInput.safeParse({ occupation: "x".repeat(61) }).success).toBe(false);
    expect(ExtrasInput.safeParse({ star_sign: "Ophiuchus" }).success).toBe(false);
    expect(ExtrasInput.safeParse(DETAILS).success).toBe(true);
  });

  it("every built-in suggestion passes the show's content rules", () => {
    for (const [key, list] of Object.entries(SUGGESTIONS)) {
      for (const idea of list ?? []) expect(checkFields({ [key]: idea }).ok, `${key}: ${idea}`).toBe(true);
    }
  });

  it("“Surprise me” fills only the blanks, and the result is valid", () => {
    const filled = surpriseFill({ occupation: "Mine, thanks" });
    expect(filled.occupation).toBe("Mine, thanks");
    expect(filled.quirk).toBeTruthy();
    expect(filled.hobbies).toHaveLength(3);
    expect(ExtrasInput.safeParse(filled).success).toBe(true);
  });

  it("is published in the character JSON Schema for agents", () => {
    const schema = characterSchema("https://b.test") as Any;
    expect(Object.keys(schema.properties.extras.properties)).toEqual(expect.arrayContaining(["occupation", "hobbies", "prompts", "star_sign"]));
    expect(schema.required).not.toContain("extras");
  });
});

describe("creating with details", () => {
  it("stores and returns them, and they show on the public profile", async () => {
    const res = await api.createCharacter(validCharacter({ extras: DETAILS }), newUserCookie());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.extras).toMatchObject({ occupation: "Crossword constructor", hobbies: ["Chess", "Stargazing"] });
    const stored = (await t.db.query<Any>(`select extras from characters where id = $1`, [body.id])).rows[0].extras;
    expect(stored.prompts).toEqual([{ id: "win_me_over", answer: "Finish my crossword in pen." }]);
  });

  it("runs the content filter over every detail", async () => {
    const res = await api.createCharacter(validCharacter({ extras: { quirk: "Watches porn at work" } }), newUserCookie());
    expect(res.status).toBe(422);
    expect((await res.json()).field).toBe("quirk");
    expect(await t.count("characters", "not is_house")).toBe(0);
  });
});

describe("editing every key field", () => {
  it("changes the sheet, voice, look, details, soul and availability, and leaves learned memory alone", async () => {
    const owner = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter({ soul: { values: "Loyal to a fault." } }), owner)).json()).id;
    // What the character has learned from its dates (lib/memory.ts), as it would be after a few aired dates.
    await t.db.query(
      `insert into character_memory (character_id, dates, second_dates, likes, turnoffs, signal_delta, memorable_lines, arc)
       values ($1, 3, 1, '["maps"]', '["rudeness"]', '{"warmth": 0.04}', '["I drew this for you."]', 'Warmer than she was.')`,
      [id],
    );
    const before = (await t.db.query<Any>(`select * from character_memory where character_id = $1`, [id])).rows[0];

    const res = await api.editCharacter(
      id,
      {
        name: "Mira Quell-Ash",
        age: 34,
        bio: "A cartographer who now maps cities that only exist on Wednesdays.",
        traits: ["curious", "patient", "dry"],
        want: "Someone who reads maps upside down, on purpose",
        dealbreaker: "People who fold maps wrong",
        appearance: "silver hair, ink on every finger",
        pronouns: "she/her",
        voice: "Dry, exact, a surprise laugh",
        avatar_hue: 200,
        open_to_dates: true,
        extras: DETAILS,
        soul: { values: "Kind, then honest." },
      },
      owner,
    );
    expect(res.status).toBe(200);

    const row = (await t.db.query<Any>(`select name, age, bio, traits, want, dealbreaker, appearance, pronouns, voice, avatar_hue, open_to_dates, extras from characters where id = $1`, [id])).rows[0];
    expect(row).toMatchObject({
      name: "Mira Quell-Ash",
      age: 34,
      traits: ["curious", "patient", "dry"],
      dealbreaker: "People who fold maps wrong",
      appearance: "silver hair, ink on every finger",
      pronouns: "she/her",
      voice: "Dry, exact, a surprise laugh",
      avatar_hue: 200,
      open_to_dates: true,
    });
    expect(row.extras.occupation).toBe("Crossword constructor");
    expect((await t.db.query<Any>(`select values from souls where character_id = $1`, [id])).rows[0].values).toBe("Kind, then honest.");

    const after = (await t.db.query<Any>(`select * from character_memory where character_id = $1`, [id])).rows[0];
    expect(after).toEqual(before);
  });

  it("clears details with an empty object, and refuses unsafe ones", async () => {
    const owner = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter({ extras: DETAILS }), owner)).json()).id;
    expect((await api.editCharacter(id, { extras: { hidden_talent: "Can recite porn scripts" } }, owner)).status).toBe(422);
    expect((await api.editCharacter(id, { extras: {} }, owner)).status).toBe(200);
    expect((await t.db.query<Any>(`select extras from characters where id = $1`, [id])).rows[0].extras).toEqual({});
  });

  it("clearing the soul's words keeps the instincts trained from an image", async () => {
    const owner = newUserCookie();
    const signals = { warmth: 0.9, openness: 0.8, guardedness: 0.1, humor: 0.7 };
    const id = (await (await api.createCharacter(validCharacter({ image_signals: signals, soul: { values: "Brave." } }), owner)).json()).id;
    expect((await api.editCharacter(id, { soul: {} }, owner)).status).toBe(200);
    const soul = (await t.db.query<Any>(`select values, signals from souls where character_id = $1`, [id])).rows[0];
    expect(soul.values).toBe("");
    expect(soul.signals).toEqual(signals);
  });

  it("re-training the look from an image replaces the signals and keeps the soul's words", async () => {
    const owner = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter({ soul: { humor: "Puns, always." } }), owner)).json()).id;
    const signals = { warmth: 0.2, openness: 0.3, guardedness: 0.8, humor: 0.4 };
    expect((await api.editCharacter(id, { image_signals: signals }, owner)).status).toBe(200);
    const soul = (await t.db.query<Any>(`select humor, signals from souls where character_id = $1`, [id])).rows[0];
    expect(soul).toEqual({ humor: "Puns, always.", signals });
  });

  it("nobody else can edit it", async () => {
    const id = (await (await api.createCharacter(validCharacter(), newUserCookie())).json()).id;
    expect((await api.editCharacter(id, { extras: DETAILS }, newUserCookie())).status).toBe(404);
  });
});

describe("details on the date", () => {
  it("a character knows its own details; its date only sees its look, style and signature item", () => {
    const c = assembleCharacter({
      id: "c1",
      sheet: { name: "Mira", age: 30, bio: "Maps.", traits: ["a", "b", "c"], want: "w", dealbreaker: "d", house: false, appearance: "ink on every finger" },
      soul: null,
      memory: null,
      extras: normaliseExtras(DETAILS as Any),
    });
    const self = JSON.stringify(characterSelfView(c));
    expect(self).toContain("Crossword constructor");
    expect(self).toContain("Finish my crossword in pen.");
    const blind = JSON.stringify(characterBlindView(c));
    expect(blind).toContain("Sharp blazer");
    expect(blind).toContain("a fountain pen");
    expect(blind).not.toContain("Crossword constructor");
    expect(blind).not.toContain("Chess");
  });

  it("reach the model that writes the date (and a character without details reads exactly as before)", async () => {
    const creator = newUserCookie();
    const id = (await (await api.createCharacter(validCharacter({ extras: DETAILS }), creator)).json()).id;
    const { calls } = scriptedModel([episodeJson()]);
    expect((await api.createEpisode({ character_id: id, partner_id: HOUSE_PARTNER_ID }, creator)).status).toBe(200);
    const prompt = JSON.stringify(calls[0]);
    expect(prompt).toContain("Crossword constructor");
    expect(prompt).toContain("A canal town full of bicycles");

    const plain = assembleCharacter({
      id: "c2",
      sheet: { name: "P", age: 30, bio: "b", traits: ["a", "b", "c"], want: "w", dealbreaker: "d", house: false },
      soul: null,
      memory: null,
    });
    expect(characterSelfView(plain)).not.toHaveProperty("details");
  });
});

describe("details for agents", () => {
  const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
    (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;

  it("create and update over MCP; search by occupation; shared hobbies explain a match", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx: McpContext = {};
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx);
    const session: McpContext = { sessionId: ctx.issuedSessionId };
    const mine = (await call("create_character", validCharacter({ name: "Agent Ada", extras: { hobbies: ["Chess", "Pottery"] } }), session)).structuredContent.character.id;

    const human = newUserCookie();
    await api.createCharacter(validCharacter({ name: "Hal Board", open_to_dates: true, extras: { occupation: "Zamboni driver", hobbies: ["Chess"] } }), human);

    const found = (await call("search_characters", { query: "zamboni", include_house: false }, session)).structuredContent.characters;
    expect(found.map((c: Any) => c.name)).toEqual(["Hal Board"]);
    expect(found[0].extras.occupation).toBe("Zamboni driver");

    const top = (await call("find_matches", { character_id: mine }, session)).structuredContent.matches[0];
    expect(top.name).toBe("Hal Board");
    expect(top.why.join(" ")).toMatch(/you both love chess/);

    const updated = await call("update_character", { character_id: mine, extras: { occupation: "Escape-room designer" } }, session);
    expect(updated.isError).toBeUndefined();
    expect((await call("get_character", { character_id: mine }, session)).structuredContent.character.extras).toEqual({ occupation: "Escape-room designer", hobbies: ["Chess", "Pottery"] });
    // #372: extras merge; replace_extras: true still replaces them whole.
    await call("update_character", { character_id: mine, extras: { occupation: "Escape-room designer" }, replace_extras: true }, session);
    expect((await call("get_character", { character_id: mine }, session)).structuredContent.character.extras).toEqual({ occupation: "Escape-room designer" });
  });
});
