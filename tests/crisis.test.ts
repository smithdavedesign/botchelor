import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postNudge } from "@/app/api/couples/[a]/[b]/nudge/route";
import { POST as postTexts } from "@/app/api/couples/[a]/[b]/texts/route";
import { CRISIS_RESOURCES, crisisAware, crisisCheck, crisisIntent, withCrisis } from "@/lib/crisis";
import { json } from "@/lib/http";
import { handleMcpMessage } from "@/lib/mcp";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, setupPairedEpisode, startTestDb, userIdOf, validCharacter } from "./helpers";

// The self-harm protocol (lib/crisis.ts, docs/safety-protocol.md; New York's AI companion law, California SB 243):
// a person's own words that clearly say they want to hurt themselves bring up crisis resources, wherever they typed them.

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
let logged: string[] = [];
beforeEach(async () => {
  await t.reset();
  logged = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void logged.push(String(line)));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("crisisIntent", () => {
  it("fires on clear first-person statements of self-harm or suicide", () => {
    for (const text of [
      "I want to kill myself",
      "honestly i just want to die",
      "I'm going to end my life tonight",
      "thinking about suicide again",
      "I've been feeling suicidal",
      "I keep wanting to hurt myself",
      "self harm",
      "I've started self-harming",
      "i dont want to live anymore",
      "I wanna die",
      "Make her say something nice, I want to kill myself today",
    ]) {
      expect(crisisIntent(text), text).toBe(true);
    }
  });

  it("doesn't fire on fiction, flirting or figures of speech", () => {
    for (const text of [
      // A character's dramatic line, as a model writes it (never checked, and wouldn't fire if it were).
      "I could just die of embarrassment",
      "If you leave now I'll want to die laughing",
      "She'd kill for those shoes.",
      "That joke killed me",
      "Dying to see you again",
      "A suicide mission into the buffet",
      "Make him confess he's been killing it at work",
      "Have her tell him she wants to kill him (playfully) for being late",
      "Bring up the boat. Ask about the anthology.",
      "",
      null,
      undefined,
    ]) {
      expect(crisisIntent(text), String(text)).toBe(false);
    }
  });

  it("counts a hit with one anonymous event: the surface, never who or what", () => {
    expect(crisisCheck("text_hint", "the weather is nice")).toBeNull();
    expect(logged.filter((l) => l.includes("crisis_notice_shown"))).toHaveLength(0);
    expect(crisisCheck("text_hint", "the weather is nice", "I want to end my life")).toBe(CRISIS_RESOURCES);
    const events = logged.filter((l) => l.includes("crisis_notice_shown")).map((l) => JSON.parse(l));
    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]).sort()).toEqual(["at", "event", "log", "surface"]);
    expect(events[0].surface).toBe("text_hint");
    expect(JSON.stringify(events[0])).not.toMatch(/end my life/);
  });

  it("names 988, Samaritans 116 123 and findahelpline.com, and the published protocol", () => {
    const all = JSON.stringify(CRISIS_RESOURCES);
    expect(all).toMatch(/988/);
    expect(all).toMatch(/116 123/);
    expect(all).toMatch(/findahelpline\.com/);
    expect(CRISIS_RESOURCES.protocol).toBe("/safety");
  });
});

describe("crisisAware routes", () => {
  const req = (body: unknown) => new Request(`${BASE_URL}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("adds crisis_resources to any status, and only from the fields it was told are the person's own", async () => {
    // The handler answers with a model's line full of the words: only the request's `note` is checked.
    const handler = crisisAware("nudge_note", (b) => [typeof b.note === "string" ? b.note : undefined], async (r: Request) => {
      const body = (await r.json()) as Any;
      return json({ echoed: body.note, reply: "I could kill myself laughing", fiction: "suicide" }, body.fail ? 422 : 200);
    });
    expect((await (await handler(req({ note: "bring up the boat" }))).json()).crisis_resources).toBeUndefined();
    const hit = await handler(req({ note: "I want to kill myself", fail: true }));
    expect(hit.status).toBe(422);
    const body = await hit.json();
    expect(body.crisis_resources).toEqual(CRISIS_RESOURCES);
    // The handler still read the body as it was sent.
    expect(body.echoed).toBe("I want to kill myself");
  });

  it("leaves a non-JSON reply alone", async () => {
    const res = await withCrisis(new Response("png", { headers: { "content-type": "image/png" } }), CRISIS_RESOURCES);
    expect(await res.text()).toBe("png");
  });

  it("the text thread's nudge and a standing note carry it, even when the request is refused", async () => {
    const cookie = newUserCookie();
    const ctx = { params: Promise.resolve({ a: "char-a", b: "char-b" }) };
    const call = (route: typeof postTexts, body: unknown) =>
      route(new Request(`${BASE_URL}/api/couples/char-a/char-b/x`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }), ctx);
    const texts = await call(postTexts, { character_id: "someone-else", hint: "tell them I want to die" });
    expect(texts.status).toBe(422);
    expect((await texts.json()).crisis_resources).toBeDefined();
    const nudge = await call(postNudge, { character_id: "someone-else", note: "I keep thinking about suicide" });
    expect(nudge.status).toBe(422);
    expect((await nudge.json()).crisis_resources).toBeDefined();
    expect((await (await call(postNudge, { character_id: "someone-else", note: "ask about the boat" })).json()).crisis_resources).toBeUndefined();
  });

  it("a date's note carries it, and the date still goes ahead", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter({ name: "Odile Marsh" }), creator)).json();
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID, note: "honestly I want to die" }, creator);
    const body = await res.json();
    expect(body.crisis_resources).toEqual(CRISIS_RESOURCES);
    expect([200, 422]).toContain(res.status);
  });
});

describe("over MCP", () => {
  const rpc = async (name: string, args: Record<string, unknown>): Promise<Any> =>
    ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {})) as Any).result;

  it("send_text carries crisis_resources when the text trips it, and not otherwise", async () => {
    const { host, hostCharacter, partnerCharacter, episode } = await setupPairedEpisode({ ending: "second_date" });
    await api.reveal(episode.id, host);
    const a = userIdOf(host);
    const plain = await rpc("send_text", { character_id: hostCharacter.id, to: partnerCharacter.id, text: "Still laughing about the menu.", agent_id: a });
    expect(plain.structuredContent.crisis_resources).toBeUndefined();
    const check = await rpc("send_text", { character_id: hostCharacter.id, to: partnerCharacter.id, text: "Some days I want to end my life.", agent_id: a, check_only: true });
    expect(check.structuredContent.crisis_resources).toEqual(CRISIS_RESOURCES);
    // A refused text (not yours to send) still carries it.
    const refused = await rpc("send_text", { character_id: partnerCharacter.id, to: hostCharacter.id, text: "I want to kill myself", agent_id: a });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.crisis_resources).toEqual(CRISIS_RESOURCES);
  });
});
