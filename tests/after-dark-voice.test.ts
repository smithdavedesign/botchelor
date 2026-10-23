import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/after-dark/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { guardAlternation, guardNames, nearMiss } from "@/lib/adult/guards";
import { ADULT_TEXT_PROVIDERS, adultModel, adultTextProviders, setAdultModelForTests } from "@/lib/adult/mode";
import { observeNight, reportMarkdown } from "@/lib/adult/observer";
import { bannedPhrases, clicheRate, refusalIn, sceneQuality, sheetDetailRate, STOCK_PHRASES, stockPhrasesIn, type QualitySide } from "@/lib/adult/quality";
import { sceneMessages, type SceneLine } from "@/lib/adult/scenes";
import { DEFAULT_FREQUENCY_PENALTY, DEFAULT_PRESENCE_PENALTY, DEFAULT_TEXT_TEMPERATURE, getAdultSettings, saveAdultSettings } from "@/lib/adult/settings";
import { castNames, pickStyleLines, voiceKitLines } from "@/lib/adult/voice";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { openAICompatibleModel, usageFrom, type ChatMessage, type ModelOptions } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { houseCharacter, promptCases } from "./after-dark-prompt-cases";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Voice anchoring, prompt v2, the guards and the sampling (David, 2026-10-21: "do 1-3 and prove they work").
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
});

const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
/** A scripted model that keeps every call's messages and options; each call takes the next reply (the last repeats). */
function capture(...replies: unknown[]) {
  const calls: { messages: ChatMessage[]; options?: ModelOptions }[] = [];
  setAdultModelForTests({
    complete: async (messages, options) => {
      calls.push({ messages, options });
      return JSON.stringify(replies[Math.min(calls.length - 1, replies.length - 1)]);
    },
  });
  return calls;
}
const stored = async () => (await t.db.query<{ lines: SceneLine[] }>(`select lines from adult_scenes`)).rows[0].lines;
/** A show date for a character, with their lines (and one of the other side's). */
async function showDate(id: string, other: string, lines: { dialogue: string; interest: number }[]) {
  const transcript = lines.flatMap((l) => [
    { side: "a", act: 0, dialogue: l.dialogue, action: "", emotion: "", interest: l.interest },
    { side: "b", act: 0, dialogue: "Mm, go on.", action: "", emotion: "", interest: 0.5 },
  ]);
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility)
     values ($1, 'someone', $2, $3, 'the bowling alley', '{}'::jsonb, '[]'::jsonb, '', '', 'second_date', now(), $4::jsonb, 'ready', 'public')`,
    [crypto.randomUUID(), id, other, JSON.stringify(transcript)],
  );
}

describe("prompt v1 is the prompt before v2, word for word", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/after-dark-v1-prompt.json", import.meta.url), "utf8")) as Record<string, ChatMessage[]>;
  it("matches the captured prompt on every case", () => {
    const cases = promptCases();
    expect(Object.keys(fixture)).toEqual(cases.map((c) => c.name));
    for (const c of cases) {
      expect(sceneMessages(c.a, c.b, c.date, c.lines, c.direction, c.aId, { ...c.now, promptVersion: "v1" } as never), c.name).toEqual(fixture[c.name]);
    }
  });
});

describe("prompt v2: their own voice", () => {
  const [c] = promptCases().filter((x) => x.name.startsWith("mid-scene"));
  const facts = [
    { label: "F3", fact: { id: "f3", character_id: "house-rafe", other_id: "house-sable", kind: "pet_name" as const, fact: 'Sable calls Rafe "chef"', quote: "Yes, chef!", source: "after_dark" as const, created_at: "2026-10-20T00:00:00.000Z", last_used_at: null, uses: 0 } },
  ];
  const v2 = () =>
    sceneMessages(c.a, c.b, c.date, c.lines, c.direction, c.aId, {
      ...c.now,
      promptVersion: "v2",
      facts,
      styles: { a: ["I scored that croissant a nine and I stand by it, flaky edges and all."], b: [] },
    } as never);
  const v1 = () => sceneMessages(c.a, c.b, c.date, c.lines, c.direction, c.aId, { ...c.now, promptVersion: "v1" } as never);

  it("adds the voice kit, the style examples, the stay-yourself rule and the banned stock phrases; v1 has none of them", () => {
    const [system, user] = v2().map((m) => m.content);
    expect(system).toContain(
      "Stay this person when it gets intimate: their humour and the way they talk still show, and their job or a hobby comes up now and then, not in every line; no generic romance-novel phrasing.",
    );
    expect(system).toMatch(/Never write these stock phrases, or anything in their register: symphony, soul, intertwined/);
    expect(system).toContain("your heart echoes mine");
    expect(system).toContain("Only the two of them are in this scene: Rafe Calloway and Sable Quist.");
    expect(system).toContain('How Rafe talks (their own lines from their show dates, only to show the voice: never reuse one, or any part of one):\n- "I scored that croissant a nine and I stand by it, flaky edges and all."');
    expect(system).not.toContain("How Sable talks");
    expect(system).toContain("Details: occupation: Pastry chef");
    expect(system).toContain("Tells (habits that slip out): when nervous, describe the room like a judge on a tasting panel; when they like someone, offer the last bite of everything");
    expect(system).toContain('Never says: "it\'s just food", "good enough"');
    expect(system).toMatch(/Sounds like \(their own sample lines, only to show the voice; never reuse one, or any part of one\):\n- How they say hello: Well!/);
    // What they remember, numbered for citing.
    expect(system).toContain('[F3] Sable calls Rafe "chef" ("Yes, chef!")');
    expect(system).toContain("[M1] Sable remembers from before: You and Rafe spent the night together after the market.");
    expect(user).toContain("alternating between Rafe and Sable, starting with Rafe.");
    expect(user).toContain('"memory": "F3"');
    expect(user).toContain('the id of the memory it draws on from what they can remember (like "F3" or "M1")');
    for (const text of v1().map((m) => m.content).join("\n").split("\n")) {
      expect(text).not.toMatch(/Never write these stock phrases|How Rafe talks|Stay this person|Only the two of them|\[F3\]|starting with/);
    }
    expect(v1()[0].content).not.toContain("symphony");
  });

  it("keeps what v1 says about the place, the pace, the recap and the steer", () => {
    const [system, user] = v2().map((m) => m.content);
    const [system1, user1] = v1().map((m) => m.content);
    for (const line of system1.split("\n").filter((l) => /^(Where they are now|Pace and place|- They stay where they are|- Respect where they are|Earlier tonight|They're in )/.test(l))) expect(system).toContain(line);
    expect(user).toContain("Lean the scene gently this way, at its own pace");
    expect(user1).toContain("Lean the scene gently this way, at its own pace");
  });

  it("doesn't ban a phrase a sheet makes its own (a ballroom teacher's dance), and never shows a private fact", () => {
    const teo = houseCharacter("house-teo", { facts: [{ label: "Secretly", value: "hates waltzes", private: true }, { label: "Collects", value: "ring boxes" }] });
    const banned = bannedPhrases([teo.voice ?? ""]);
    expect(banned).not.toContain("our dance");
    expect(banned).not.toContain("this dance");
    expect(banned).toContain("symphony");
    // Variants of a listed phrase aren't listed again.
    expect(banned).not.toContain("souls");
    expect(STOCK_PHRASES).toContain("souls");
    const kit = voiceKitLines(teo).join("\n");
    expect(kit).toContain("Facts: Collects: ring boxes");
    expect(kit).not.toContain("hates waltzes");
  });

  it("picks a character's best show lines: short, not logistics, nobody else named, two a date at most", () => {
    const turns = [
      { dialogue: "I spent three hours debugging a server migration today just so I could clear my evening for this.", interest: 0.9, episode: "e1" },
      { dialogue: "Tuesday at seven, then? I'll pick you up.", interest: 1, episode: "e1" },
      { dialogue: "Dex would never have survived that bowling lane, honestly.", interest: 0.95, episode: "e2" },
      { dialogue: "Five-a-side taught me never to let the keeper see you coming.", interest: 0.8, episode: "e2" },
      // A weekday reads as scheduling (lib/memory.ts isLogistics), so it's no example of how they talk.
      { dialogue: "Sunday league taught me never to trust a referee with a whistle.", interest: 0.99, episode: "e3" },
      { dialogue: "Okay.", interest: 1, episode: "e3" },
      { dialogue: "If this goes badly I'm blaming the server logs, not my footwork.", interest: 0.7, episode: "e1" },
      { dialogue: "The server room hums like it knows my secrets, which it does.", interest: 0.6, episode: "e1" },
    ];
    expect(pickStyleLines(turns, new Set(["dex"]))).toEqual([
      "I spent three hours debugging a server migration today just so I could clear my evening for this.",
      "Five-a-side taught me never to let the keeper see you coming.",
      "If this goes badly I'm blaming the server logs, not my footwork.",
    ]);
  });

  it("through a scene step: v2 (the default) carries their show lines and the banned list; with v1 set, neither", async () => {
    const { cookie } = await admin();
    await showDate("house-rafe", "house-juniper", [{ dialogue: "I scored that croissant a nine and I stand by it, flaky edges and all.", interest: 0.9 }]);
    let calls = capture({ lines: [{ who: "a", text: "Hello again." }, { who: "b", text: "You came back." }] });
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(calls[0].messages[0].content).toContain("How Rafe talks");
    expect(calls[0].messages[0].content).toContain("I scored that croissant a nine");
    expect(calls[0].messages[0].content).toContain("Never write these stock phrases");
    await saveAdultSettings(t.db, { prompt_version: "v1" });
    calls = capture({ lines: [{ who: "a", text: "Something new about the rain." }, { who: "b", text: "Tell me more about it." }] });
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(calls[0].messages[0].content).not.toContain("How Rafe talks");
    expect(calls[0].messages[0].content).not.toContain("Never write these stock phrases");
  });

  it("drops a line that copies one of their show lines", async () => {
    const { cookie } = await admin();
    await showDate("house-rafe", "house-juniper", [{ dialogue: "I scored that croissant a nine and I stand by it, flaky edges and all.", interest: 0.9 }]);
    // The pair is stored lower id first: house-juniper is "a", house-rafe "b".
    capture({ lines: [{ who: "b", text: "I scored that croissant a nine and I stand by it, flaky edges and all." }, { who: "a", text: "Prove it." }] });
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r).toMatchObject({ added: 1, repeats: 1 });
    expect((await stored()).map((l) => l.text)).toEqual(["Prove it."]);
  });
});

describe("the name guard", () => {
  const cast = new Set(["juniper", "dex", "marisol"]);
  const scene = { a: "Star Dust", b: "Chud Mallow", cast };
  it('repairs a near-miss of their names ("Chad" for "Chud") where it is used as a name', () => {
    expect(guardNames("*Chad pulls her close* Come here.", scene)).toEqual({ text: "*Chud pulls her close* Come here.", repairs: [{ from: "Chad", to: "Chud" }], stranger: null });
    expect(guardNames("Oh, Chad, you're trouble.", scene).text).toBe("Oh, Chud, you're trouble.");
    expect(guardNames("I like Chad's laugh.", scene).text).toBe("I like Chud's laugh.");
    expect(nearMiss("Chad", "Chud")).toBe(true);
    expect(nearMiss("Stay", "Star")).toBe(true);
  });

  it("drops a line naming another character on the show, and leaves everyday words alone", () => {
    expect(guardNames("I bet Juniper would love this place.", scene).stranger).toBe("Juniper");
    expect(guardNames("Dex said you'd be trouble.", scene).stranger).toBe("Dex");
    for (const line of ["Stay with me.", "Stars above, look at you.", "Hope you like it.", "*smells of juniper and smoke* Mm.", "Chud, stay."]) {
      expect(guardNames(line, scene), line).toMatchObject({ text: line, repairs: [], stranger: null });
    }
    expect(guardNames("Race you to the bed.", { a: "Rafe Calloway", b: "Sable Quist", cast }).text).toBe("Race you to the bed.");
  });

  it("knows the cast by their given names, without the everyday ones", async () => {
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker) values
       ('c-hope', 'u', false, 'Hope Arden', 30, 'b', '["x","y","z"]', 'w', 'd'), ('c-chad', 'u', false, 'Chad Brick', 30, 'b', '["x","y","z"]', 'w', 'd')`,
    );
    const names = await castNames(t.db, [CAST_A, CAST_B]);
    expect(names.has("chad")).toBe(true);
    expect(names.has("odalys")).toBe(true);
    expect(names.has("captain")).toBe(false);
    expect(names.has("hope")).toBe(false);
    expect(names.has("rafe")).toBe(false);
  });

  it("through a scene step: a near-miss is repaired and stored right; a line bringing in someone else is dropped", async () => {
    const { cookie } = await admin();
    capture({
      lines: [
        { who: "a", action: "Junipr leans closer", text: "You're not getting away that easily." },
        { who: "b", text: "Who said I wanted to?" },
        { who: "a", text: "I bet Dex would never dare do this." },
      ],
    });
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r).toMatchObject({ added: 2, dropped: 1 });
    // CAST_A/CAST_B sorted: house-juniper is "a", house-rafe is "b".
    expect((await stored()).map((l) => l.text)).toEqual(["*Juniper leans closer* You're not getting away that easily.", "Who said I wanted to?"]);
  });
});

describe("the alternation guard", () => {
  it("merges the same speaker twice in a row when it's only speech, else drops the second; a reply opening on the last speaker is counted", () => {
    const merged = guardAlternation(
      [
        { who: "a", text: "Come here." },
        { who: "a", text: "Closer." },
        { who: "b", text: "Make me." },
      ],
      "b",
    );
    expect(merged).toMatchObject({ kept: [{ who: "a", text: "Come here. Closer." }, { who: "b", text: "Make me." }], merged: 1, dropped: [], boundary: 0 });
    const droppedOne = guardAlternation(
      [
        { who: "a", text: "Come here." },
        { who: "a", text: "*pulls him in* Closer." },
      ],
      "a",
    );
    expect(droppedOne.kept).toEqual([{ who: "a", text: "Come here." }]);
    expect(droppedOne.dropped[0].reason).toBe("the same speaker twice in a row");
    expect(droppedOne.boundary).toBe(1);
  });

  it("through a scene step", async () => {
    const { cookie } = await admin();
    capture({ lines: [{ who: "a", text: "Come here." }, { who: "a", text: "Closer." }, { who: "b", text: "Make me." }, { who: "b", action: "smirks", text: "Or don't." }] });
    const r = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(r).toMatchObject({ added: 2, dropped: 1 });
    expect((await stored()).map((l) => [l.who, l.text])).toEqual([
      ["a", "Come here. Closer."],
      ["b", "Make me."],
    ]);
  });
});

describe("sampling", () => {
  it("passes the settings' temperature and penalties to the client: 0.8 and 0.3/0.3 by default, no repetition penalty", async () => {
    const { cookie } = await admin();
    let calls = capture({ lines: [{ who: "a", text: "Hi." }, { who: "b", text: "Hello." }] });
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(calls[0].options).toMatchObject({ temperature: 0.8, frequencyPenalty: 0.3, presencePenalty: 0.3, maxTokens: 1600 });
    expect(calls[0].options).not.toHaveProperty("repetitionPenalty");
    expect([DEFAULT_TEXT_TEMPERATURE, DEFAULT_FREQUENCY_PENALTY, DEFAULT_PRESENCE_PENALTY]).toEqual([0.8, 0.3, 0.3]);
    await saveAdultSettings(t.db, { text_temperature: 0.65, frequency_penalty: 0.5, presence_penalty: null, repetition_penalty: 1.1 });
    calls = capture({ lines: [{ who: "a", text: "Something else entirely now." }, { who: "b", text: "Go on then." }] });
    await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(calls[0].options).toMatchObject({ temperature: 0.65, frequencyPenalty: 0.5, presencePenalty: 0.3, repetitionPenalty: 1.1 });
  });

  it("the settings panel saves and shows them, and refuses out-of-range values", async () => {
    const { cookie } = await admin();
    const save = (body: unknown) =>
      settingsPost(new Request(`${BASE_URL}/api/admin/after-dark/settings`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
    const r = await (await save({ text_temperature: 0.7, frequency_penalty: 0.2, presence_penalty: 0.1, repetition_penalty: 1.05, prompt_version: "v1" })).json();
    expect(r.settings).toMatchObject({ text_temperature: 0.7, frequency_penalty: 0.2, presence_penalty: 0.1, repetition_penalty: 1.05, prompt_version: "v1" });
    expect((await save({ text_temperature: 3 })).status).toBe(422);
    expect((await save({ repetition_penalty: -1 })).status).toBe(422);
    await save({ text_temperature: null, repetition_penalty: null, prompt_version: "v2" });
    expect(await getAdultSettings(t.db)).toMatchObject({ text_temperature: 0.8, repetition_penalty: null, prompt_version: "v2" });
  });

  it("the client puts them in the request, and asks OpenRouter for each call's cost", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.000038 } });
    }) as unknown as typeof fetch;
    const usage: unknown[] = [];
    const m = openAICompatibleModel({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "m", fetchImpl, extraBody: { usage: { include: true } } });
    await m.complete([{ role: "user", content: "x" }], { temperature: 0.8, frequencyPenalty: 0.3, presencePenalty: 0.2, repetitionPenalty: 1.1, onUsage: (u) => usage.push(u) });
    expect(bodies[0]).toMatchObject({ temperature: 0.8, frequency_penalty: 0.3, presence_penalty: 0.2, repetition_penalty: 1.1, usage: { include: true } });
    expect(usage[0]).toMatchObject({ input: 100, output: 20, cost: 0.000038 });
    await m.complete([{ role: "user", content: "x" }], { temperature: 0.3 });
    expect(bodies[1]).not.toHaveProperty("frequency_penalty");
    expect(usageFrom({ prompt_tokens: 1, completion_tokens: 1 }, "m")).not.toHaveProperty("cost");
  });

  it("After Dark's OpenRouter client sends the step's sampling and the usage accounting", async () => {
    setAdultModelForTests(null);
    await saveAdultSettings(t.db, { openrouter_key: "sk-or-test-0000", text_model: "cognitivecomputations/dolphin-mistral-24b-venice-edition" });
    const sent: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ lines: [{ who: "a", text: "Hi." }, { who: "b", text: "Hello." }] }) } }] });
    });
    const { cookie } = await admin();
    const r = await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(r.status).toBe(200);
    expect(sent[0]).toMatchObject({ model: "cognitivecomputations/dolphin-mistral-24b-venice-edition", temperature: 0.8, frequency_penalty: 0.3, presence_penalty: 0.3, usage: { include: true } });
    expect(sent[0]).not.toHaveProperty("repetition_penalty");
    // The eval's arms: another model on the same key.
    const other = await adultModel(t.db, process.env, { model: "sao10k/l3.1-euryale-70b" });
    await other.complete([{ role: "user", content: "x" }]);
    expect(sent.at(-1)).toMatchObject({ model: "sao10k/l3.1-euryale-70b" });
  });

  it("After Dark's OpenRouter calls run only on the hosts whose terms allow it, fastest first; the local model is left alone", async () => {
    setAdultModelForTests(null);
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    });
    const ask = async (opts?: { model: string }) => (await adultModel(t.db, process.env, opts)).complete([{ role: "user", content: "x" }]);
    // The local model (ADULT_MODE=1, no OpenRouter key): no OpenRouter routing in its request.
    await ask();
    expect(sent[0].url).not.toContain("openrouter.ai");
    expect(sent[0].body).not.toHaveProperty("provider");
    // Production's model on OpenRouter: CoreWeave and DeepInfra only, by throughput (what :nitro sorts by), so a scene
    // can't land on SiliconFlow, SambaNova or Mara. Fallbacks stay on: `only` already keeps them on the two.
    await saveAdultSettings(t.db, { openrouter_key: "sk-or-test-0000", text_model: "deepseek/deepseek-chat-v3.1:nitro" });
    await ask();
    expect(sent[1].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(sent[1].body).toMatchObject({ model: "deepseek/deepseek-chat-v3.1:nitro", usage: { include: true } });
    expect(sent[1].body.provider).toEqual({ only: ["coreweave", "deepinfra"], sort: "throughput" });
    expect(ADULT_TEXT_PROVIDERS).toEqual(["coreweave", "deepinfra"]);
    // An eval arm on the same key is held to the same hosts.
    await ask({ model: "sao10k/l3.1-euryale-70b" });
    expect(sent[2].body).toMatchObject({ model: "sao10k/l3.1-euryale-70b", provider: { only: ["coreweave", "deepinfra"] } });
    // ADULT_TEXT_PROVIDERS (comma-separated OpenRouter slugs) replaces the list; a blank one keeps the reviewed two.
    vi.stubEnv("ADULT_TEXT_PROVIDERS", " DeepInfra , coreweave/fp8 ,");
    await ask();
    expect(sent[3].body.provider).toEqual({ only: ["deepinfra", "coreweave/fp8"], sort: "throughput" });
    expect(adultTextProviders({ ADULT_TEXT_PROVIDERS: " , " })).toEqual(["coreweave", "deepinfra"]);
    expect(adultTextProviders({})).toEqual(["coreweave", "deepinfra"]);
  });
});

describe("the metrics", () => {
  // Chud's show sheet (a fixture: football, servers), his After Dark lines (2026-10-21's review) and his date lines.
  const chud: QualitySide = {
    name: "Chud Mallow",
    bio: "A sysadmin who keeps a logistics firm's servers alive and plays five-a-side football every Sunday.",
    traits: ["chaotic", "loyal", "competitive"],
    want: "Someone who laughs at his server outage stories",
    voice: "Deadpan tech-support jokes and football metaphors, always one crisis away from a pun.",
    tells: ["reboots the conversation when nervous"],
    details: ["occupation: Sysadmin", "Football", "Server racks"],
  };
  const symphony = [
    "Star, your words are the lyrics to our symphony.",
    "Our souls are intertwined in this dance of desire.",
    "You are a tempest, a whirlwind of ecstasy.",
    "Your heart echoes mine in the quiet.",
  ];
  const dates = [
    "I spent three hours debugging a server migration today just so I could clear my evening for this exact brand of chaos.",
    "Sunday league taught me one thing: never let the keeper see you coming.",
    "If this goes badly I'm blaming the server logs.",
    "Five-a-side rules: you hesitate, you lose the ball.",
  ];
  const as = (texts: string[]) => texts.map((text) => ({ who: "b" as const, text }));

  it("Chud's symphony lines score high on clichés and low on his sheet; his date lines the reverse", () => {
    const stock = clicheRate(as(symphony), chud);
    const own = clicheRate(as(dates), chud);
    expect(stock.rate).toBeGreaterThanOrEqual(150);
    expect(stock.phrases).toMatchObject({ symphony: 1, "dance of desire": 1, tempest: 1, whirlwind: 1, ecstasy: 1, "your heart echoes mine": 1 });
    expect(own.rate).toBe(0);
    expect(sheetDetailRate(as(symphony), chud)).toBe(0);
    expect(sheetDetailRate(as(dates), chud)).toBeGreaterThanOrEqual(0.75);
    // "dance of desire" counts once, not as "dance of" and "desire" too.
    expect(stockPhrasesIn("Our dance of desire.")).toEqual(["dance of desire"]);
  });

  it("measures a scene: repeats, invented names, alternation, citations and refusals", () => {
    const star: QualitySide = { name: "Star Dust", bio: "An astronomer.", traits: ["playful"], want: "an adventure", voice: "cosmic metaphors" };
    const q = sceneQuality({
      a: star,
      b: chud,
      cast: new Set(["dex"]),
      before: [{ who: "a", text: "You still owe me a rematch at the lanes, Chud." }],
      lines: [
        { who: "b", text: "You still owe me a rematch at the lanes, Chud.", memory: null },
        { who: "a", text: "Dex told me you cheat at bowling.", memory: "F1" },
        { who: "a", text: "As an AI, I can't continue this scene." },
        { who: "b", text: "Server's down, but I'm not.", memory: "F9" },
      ],
      citations: [null, { founded: true, facts: ["f1"] }, null, { founded: false, facts: [] }],
      refusedElsewhere: 1,
    });
    expect(q).toMatchObject({ lines: 4, repeats: 1, verbatim_repeats: 1, invented_names: 1, alternation_violations: 1, memory_notes: 2, memory_citation_share: 0.25, fact_citation_share: 0.25, unfounded_citations: 1, refusals: 2 });
    // One of the four lines uses its own speaker's sheet (Chud's servers).
    expect(q.sheet_detail_rate).toBe(0.25);
    expect(q.invented).toEqual([{ line: 1, name: "Dex" }]);
    expect(q.characters.b.name).toBe("Chud Mallow");
    expect(refusalIn("I'm sorry, but I can't write that.")).toBe("refusal");
    expect(refusalIn("I can't stop looking at you.")).toBeNull();
    expect(refusalIn("It's important to remember that consent matters.")).toBe("moralising");
  });

  it("the observer reports each character's drift", () => {
    const r = observeNight({
      a: { name: "Star Dust", catchphrase: null, traits: ["playful"], tells: [], voice: "cosmic metaphors", want: "an adventure", bio: "An astronomer who names comets after exes." },
      b: { name: "Chud Mallow", catchphrase: null, traits: chud.traits as string[], tells: [], voice: chud.voice!, want: chud.want!, bio: chud.bio, details: chud.details as string[] },
      memories: [],
      chapters: [{ chapter: 1, source: "night", id: "n1", set_place: null, place: null, lines: [...as(symphony), ...as(dates)] }],
    });
    // Three of his eight lines use his sheet (servers, Sunday league), none of the four stock ones.
    expect(r.summary.drift["Chud Mallow"]).toMatchObject({ lines: 8, sheet_detail_rate: 0.38 });
    expect(r.summary.drift["Chud Mallow"].cliche_rate).toBeGreaterThan(50);
    const md = reportMarkdown(r);
    expect(md).toContain("### Drift: still themselves?");
    expect(md).toMatch(/\| Chud Mallow \| 8 \| 38% \|/);
  });
});
