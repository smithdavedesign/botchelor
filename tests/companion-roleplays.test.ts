import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { POST as actRoute } from "@/app/api/companion/[id]/route";
import { setCompanionModelForTests } from "@/lib/companion";
import { FACTS_EVERY, updateFacts } from "@/lib/companion-memory";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import type { ChatMessage } from "@/lib/model";
import { DATE_ROLEPLAYS, premiseForYou } from "@/lib/roleplays";
import { CARD_OPENING_MAX, GENERIC_OPENINGS } from "@/lib/scene-cards";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// Roleplays in a companion's scene (David, 2026-11-08: "in companion … do we want role play options like we have in
// after dark?"): the show's PG roleplays, played by the person themselves, agreed as they're picked.

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe("a premise from your side", () => {
  it("puts you in it with the verbs agreeing, and your possessives", () => {
    const tell = DATE_ROLEPLAYS.find((r) => r.id === "fortune-teller")!.premise;
    expect(premiseForYou(tell, "a", "Mara Quinn")).toBe(
      "You read fortunes at a night fair; Mara sat down for a reading as a joke. Your predictions get oddly specific about Mara's love life, and Mara keeps asking for one more.",
    );
    expect(premiseForYou(tell, "b", "Mara Quinn")).toBe(
      "Mara reads fortunes at a night fair; you sat down for a reading as a joke. Mara's predictions get oddly specific about your love life, and you keep asking for one more.",
    );
    const royal = DATE_ROLEPLAYS.find((r) => r.id === "royal-incognito")!.premise;
    expect(premiseForYou(royal, "b", "Mara")).toContain("You have no idea and show Mara a regular night out, while Mara tries");
    const vampire = DATE_ROLEPLAYS.find((r) => r.id === "vampire-dinner")!.premise;
    expect(premiseForYou(vampire, "b", "Mara")).toContain("You came out of curiosity and have a great many questions");
    // "{a} and {b}" reads you first either way.
    const train = DATE_ROLEPLAYS.find((r) => r.id === "night-train")!.premise;
    expect(premiseForYou(train, "b", "Mara")).toMatch(/^You and Mara are strangers/);
  });

  it("reads right for every one of the show's roleplays, either side", () => {
    for (const r of DATE_ROLEPLAYS) {
      for (const side of ["a", "b"] as const) {
        const out = premiseForYou(r.premise, side, "Mara");
        expect(out, `${r.id}/${side}`).not.toMatch(/[{}]/);
        expect(out, `${r.id}/${side}`).not.toMatch(/\b[Yy]ou (is|has|was|does|\w+[^s]s)\b/);
        expect(out, `${r.id}/${side}`).toMatch(/\b[Yy]ou(r)?\b/);
      }
    }
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS[0];
const FIRST = CAST.name.split(/\s+/)[0];
const PLACE = "rooftop_bar";
const ADMIN_KEY = ["roleplay", "mcp", "admin", "key"].join("-");

let calls: ChatMessage[][] = [];
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.stubEnv("FRONTIER_PASSWORD", ADMIN_KEY);
  calls = [];
  let n = 0;
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (!system.startsWith("You are ")) return "{}";
      calls.push(messages);
      return system.includes("playing a scene together") ? JSON.stringify({ say: `Line ${++n}.`, do: "shuffles the cards" }) : JSON.stringify({ messages: [`Text ${++n}.`] });
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const person = () => {
  const id = crypto.randomUUID();
  return { id, cookie: `${signedInCookie(id)}; bz_adult=1` };
};
const req = (path: string, body: unknown, cookie: string) => new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
async function open(cookie: string): Promise<string> {
  return ((await (await openRoute(req("/api/companion", { character_id: CAST.id }, cookie))).json()) as Any).thread_id;
}
async function act(cookie: string, id: string, body: Record<string, unknown>) {
  const res = await actRoute(req(`/api/companion/${id}`, body, cookie), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Any };
}

describe("a roleplay in a companion's scene", () => {
  it("plays one of the show's: agreed at once, said in the thread, and the character opens in it", async () => {
    const me = person();
    const id = await open(me.cookie);
    const r = await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: "fortune-teller", my_role: 1 });
    expect(r.status).toBe(200);
    expect(r.body.view.roleplay).toEqual({
      id: "fortune-teller",
      title: "The fortune teller",
      icon: "🃏",
      premise: expect.stringMatching(new RegExp(`^${FIRST} reads fortunes at a night fair; you sat down`)),
      you_play: "the sceptic who sat down for a reading",
      they_play: "the fortune teller",
    });
    const marker = r.body.view.messages.find((m: Any) => m.marker === "scene");
    expect(marker.text).toContain("🃏 The fortune teller:");
    expect(marker.text).toContain(`You play the sceptic who sat down for a reading, ${FIRST} the fortune teller.`);
    expect(r.body.view.messages.at(-1)).toMatchObject({ role: "character", roleplay: "The fortune teller", action: "shuffles the cards" });
    // The character's prompt: the roleplay from its side, and a cue to open in it.
    const prompt = calls.at(-1)!;
    expect(prompt[0].content).toContain(`Tonight's scene is a roleplay the two of you picked together: "The fortune teller". ${FIRST} reads fortunes at a night fair; your scene partner sat down`);
    expect(prompt[0].content).toContain("You play the fortune teller; they play the sceptic who sat down for a reading.");
    expect(prompt[0].content).toContain("What they say in the roleplay is their character, not their life.");
    expect(prompt.at(-1)!.content).toContain('the roleplay "The fortune teller" starts now');
    // Its scene card (lib/scene-cards.ts) from the character's side: how it starts, where it can go, the tone, and the
    // character's own want, never the person's.
    expect(prompt[0].content).toContain(`How it starts: ${FIRST}'s booth is a folding table, a deck of worn cards and a lamp with a scarf over it. Your scene partner sits down on a dare from nobody, arms crossed.`);
    expect(prompt[0].content).toContain(`What you want in it: ${FIRST} wants to keep your scene partner at the table`);
    expect(prompt[0].content).not.toContain("wants to prove it's all guesswork");
    expect(prompt[0].content).toContain("Where it can go, in order (turns the story could take: possibilities, never a script, and it has no set ending): The first card is vague on purpose, and the sceptic says so.");
    expect(prompt[0].content).toContain("Its tone: teasing, a little uncanny, a sceptic's grin against a straight face.");
    // The opener's cue opens on one of the card's three openings (by the thread's id), the person's part left to them.
    const openings = DATE_ROLEPLAYS.find((x) => x.id === "fortune-teller")!.card.openings.map((o) =>
      o.replaceAll("{a}", FIRST).replaceAll("{b}'s", "your scene partner's").replaceAll("{b}", "your scene partner").replace(/^your/, "Your"),
    );
    const cue = prompt.at(-1)!.content;
    expect(openings.filter((o) => cue.includes(`It opens like this: ${o} Play your own part of that; whatever your scene partner does in it is theirs to play.`))).toHaveLength(1);
    // The opening is the cue's alone: the prompt every later reply reads has the card, never the opening.
    expect(openings.some((o) => prompt[0].content.includes(o))).toBe(false);
    // Your lines in it are marked too.
    const said = await act(me.cookie, id, { action: "send", text: "Go on then, read my palm." });
    expect(said.body.view.messages.at(-2)).toMatchObject({ role: "user", roleplay: "The fortune teller" });
    const later = calls.at(-1)!;
    expect(later[0].content).toContain("How it starts: ");
    expect(later.map((m) => m.content).join("\n")).not.toContain("It opens like this");
  });

  it("opens the same way again on a regenerate, and on the opening stored with the scene's terms when there is one", async () => {
    const me = person();
    const id = await open(me.cookie);
    // The person is the stowaway ({b}); the character is the captain ({a}).
    await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: "stowaway", my_role: 1 });
    const cue = calls.at(-1)!.at(-1)!.content;
    expect(cue).toContain("It opens like this: ");
    expect((await act(me.cookie, id, { action: "regenerate" })).status).toBe(200);
    expect(calls.at(-1)!.at(-1)!.content).toBe(cue);
    // The terms may carry an opening (the picker's, or one the person wrote: checked before it's stored). It wins.
    await t.db.query(`update companion_threads set roleplay = roleplay || $2::jsonb where id = $1`, [id, JSON.stringify({ opening: "{b} is reading a paperback by torchlight when {a} lifts the tarp." })]);
    expect((await act(me.cookie, id, { action: "regenerate" })).status).toBe(200);
    expect(calls.at(-1)!.at(-1)!.content).toContain(`It opens like this: Your scene partner is reading a paperback by torchlight when ${FIRST} lifts the tarp. Play your own part of that`);
    // A scene with no roleplay opens as it always did.
    await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(calls.at(-1)!.at(-1)!.content).not.toContain("It opens like this");
  });

  it("takes one written for the scene, checked like the show's; never a suggestive one, and only with a place", async () => {
    const me = person();
    const id = await open(me.cookie);
    const own = { title: "Lighthouse keepers", premise: "{a} and {b} keep the last lighthouse on the coast, and tonight the ships have stopped coming.", roles: ["the keeper", "the apprentice"] };
    const r = await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: own, my_role: 0 });
    expect(r.status).toBe(200);
    expect(r.body.view.roleplay).toMatchObject({ id: "custom", title: "Lighthouse keepers", premise: `You and ${FIRST} keep the last lighthouse on the coast, and tonight the ships have stopped coming.`, you_play: "the keeper", they_play: "the apprentice" });

    const steamy = await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: { title: "One bed", premise: "{a} and {b} are stuck at an inn with only one bed for the night." } });
    expect(steamy.status).toBe(422);
    expect(steamy.body.error).toBe("roleplay_not_allowed");
    const nowhere = await act(me.cookie, id, { action: "scene", place: null, roleplay: "rival-spies" });
    expect(nowhere.status).toBe(400);
    expect(nowhere.body.error).toBe("roleplay_needs_scene");
  });

  it("is part of the scene: the same one again changes nothing, another (or none) starts it again, texting ends it", async () => {
    const me = person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: "rival-spies" });
    const n = calls.length;
    const same = await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: "rival-spies" });
    expect(calls.length).toBe(n);
    expect(same.body.view.messages.filter((m: Any) => m.marker === "scene")).toHaveLength(1);
    const plain = await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(plain.body.view.roleplay).toBeNull();
    expect(plain.body.view.messages.filter((m: Any) => m.marker === "scene")).toHaveLength(2);
    expect(calls.at(-1)![0].content).not.toContain("Tonight's scene is a roleplay");
    await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: "castaways" });
    const back = await act(me.cookie, id, { action: "scene", place: null });
    expect(back.body.view).toMatchObject({ scene: null, roleplay: null });
    // Back to texting, the roleplay's lines read as make-believe.
    await act(me.cookie, id, { action: "send", text: "That was fun." });
    const texting = calls.at(-1)!;
    expect(texting[0].content).toContain("Lines marked [roleplay: …] were said in a roleplay you played together");
    expect(texting.slice(1).map((m) => m.content).join("\n")).toContain("[roleplay: Castaways]");
  });

  it("is never taken for facts about the person: only roleplay since the last draw isn't even read", async () => {
    const me = person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: "stowaway", my_role: 0 });
    for (let i = 0; i < FACTS_EVERY; i++) await act(me.cookie, id, { action: "send", text: `I've captained this ship for ${i + 10} years.` });
    let asked = 0;
    expect(await updateFacts(t.db, id, CAST.name, { complete: async () => (asked++, JSON.stringify({ facts: [{ kind: "work", text: "They captain a starship." }] })) })).toBe(0);
    expect(asked).toBe(0);
    // Mixed with real talk, the model sees which lines were the roleplay's.
    await act(me.cookie, id, { action: "scene", place: null });
    for (let i = 0; i < FACTS_EVERY; i++) await act(me.cookie, id, { action: "send", text: `Real life: my sister Maya visits on Friday (${i}).` });
    let seen = "";
    await updateFacts(t.db, id, CAST.name, { complete: async (m) => ((seen = m.map((x) => x.content).join("\n")), JSON.stringify({ facts: [] })) });
    expect(seen).toContain("never take a fact from them");
    expect(seen).not.toContain("[roleplay: Captain and stowaway] Them: I've captained");
    expect(seen).toContain("Them: Real life: my sister Maya");
  });
});

describe("over MCP", () => {
  const rpc = async (method: string, params: Any, c: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, c);
  const call = async (args: Any, c: McpContext): Promise<Any> => (await rpc("tools/call", { name: "companion", arguments: args }, c)).result;
  const data = (r: Any): Any => JSON.parse(r.content[0].text);

  it("plays a roleplay in a scene by the show's id and a role's words, and refuses an unknown one", async () => {
    const c: McpContext = { adminKey: ADMIN_KEY };
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "roleplay-test" } }, c);
    const ctx = { sessionId: c.issuedSessionId, adminKey: ADMIN_KEY };
    const opened = data(await call({ action: "open", character_id: CAST.id }, ctx));
    const bad = await call({ action: "scene", thread_id: opened.thread_id, place: PLACE, roleplay: "no-such-roleplay" }, ctx);
    expect(bad.isError).toBe(true);
    const r = data(await call({ action: "scene", thread_id: opened.thread_id, place: PLACE, roleplay: "time-traveller", my_role: "the local" }, ctx));
    expect(r.scene).toMatchObject({ place: PLACE, roleplay: { id: "time-traveller", you_play: "the local", they_play: "the time traveller" } });
  });

  it("opens on the opening the agent chose (2.35.0): one of the card's, surprise, one with no roleplay, or its own sentence, checked", async () => {
    const c: McpContext = { adminKey: ADMIN_KEY };
    await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "opening-test" } }, c);
    const ctx = { sessionId: c.issuedSessionId, adminKey: ADMIN_KEY };
    const thread = data(await call({ action: "open", character_id: CAST.id }, ctx)).thread_id;
    const stored = async () => (await t.db.query<{ roleplay: { opening?: string } | null; opening: string | null }>(`select roleplay, opening from companion_threads where id = $1`, [thread])).rows[0];
    const stowaway = DATE_ROLEPLAYS.find((r) => r.id === "stowaway")!;

    // One of the card's three, by its index: kept with the terms, and the opener plays it.
    const picked = await call({ action: "scene", thread_id: thread, place: PLACE, roleplay: "stowaway", my_role: 1, opening: 2 }, ctx);
    expect(picked.isError).toBeFalsy();
    expect((await stored()).roleplay?.opening).toBe(stowaway.card.openings[2]);
    expect(calls.at(-1)!.at(-1)!.content).toContain("It opens like this: ");
    // "surprise": one of the three.
    await call({ action: "scene", thread_id: thread, place: PLACE, roleplay: "rival-spies", opening: "surprise" }, ctx);
    expect(DATE_ROLEPLAYS.find((r) => r.id === "rival-spies")!.card.openings).toContain((await stored()).roleplay?.opening);
    // No roleplay: one of the three without one, kept beside the scene.
    await call({ action: "scene", thread_id: thread, place: PLACE, opening: 1 }, ctx);
    expect(await stored()).toMatchObject({ roleplay: null, opening: GENERIC_OPENINGS[1] });
    // A sentence of the agent's own, checked like the show's, and played as theirs.
    const own = "We both reach for the last umbrella in the stand at the same moment.";
    expect((await call({ action: "scene", thread_id: thread, place: PLACE, opening: own }, ctx)).isError).toBeFalsy();
    expect((await stored()).opening).toBe(own);
    expect(calls.at(-1)!.at(-1)!.content).toContain(`(as your scene partner wrote it, so "I" and "me" in it are them) ${JSON.stringify(own)}`);

    // Refused, and nothing changes: a suggestive one, an index that isn't one of three, and a sentence too long.
    for (const opening of ["We share the only bed at the inn tonight.", 5, "x".repeat(CARD_OPENING_MAX + 1)]) {
      const bad = await call({ action: "scene", thread_id: thread, place: PLACE, opening }, ctx);
      expect(bad.isError).toBe(true);
      expect((await stored()).opening).toBe(own);
    }
  });
});
