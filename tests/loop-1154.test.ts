import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { lookAlikeGateOn, setLookAlikeGateForTests } from "@/lib/originality";
import { startTestDb, validCharacter } from "./helpers";

// #1154 (three visitors on 2026-10-31: the 1808, 1838 and 1905 runs): create_character saved a sheet the check calls
// "reads a lot like" an existing character when the agent skipped check_only, and said so only after it was saved.
// The call (option 2, made per David's standing "make the judgement calls"): a first save of a look-alike of someone
// else's character is refused unless the call passes keep_look_alike: true, as keep_name works for a taken name.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  // The shared harness turns the gate off (suites reuse one sheet); these tests are about it.
  setLookAlikeGateForTests(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
const agent = async (): Promise<McpContext> => {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-loop-1154-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
};

// The 1808 run's pair, as near as the report gives them: two night-tram announcers who record the city's quiet sounds.
const ingeborg = validCharacter({
  name: "Ingeborg Salvesen",
  bio: "Announces the stops on the night trams and records the city's quietest sounds on a reel-to-reel recorder after every shift.",
  traits: ["precise", "dreamy", "dry"],
  want: "Someone who will stand still long enough to hear a tram bell fade",
  dealbreaker: "Talking over the announcements",
  extras: { occupation: "Night tram announcer" },
});
const tramTwin = validCharacter({
  name: "Vesna Horvat",
  bio: "Announces the stops on the night trams of Zagreb and records the city's quietest sounds on a cassette recorder after every shift.",
  traits: ["exact", "wistful", "wry"],
  want: "Someone who hears the city the way she does",
  dealbreaker: "People who play music on the tram",
  extras: { occupation: "Tram announcer" },
});
const count = async (name: string) => Number((await t.db.query(`select count(*)::int as n from characters where name = $1`, [name])).rows[0].n);

describe("#1154: create_character refuses a look-alike unless keep_look_alike: true", () => {
  it("LOOK_ALIKE_GATE=0 turns it off, and the harness's switch wins over the environment", async () => {
    setLookAlikeGateForTests(null);
    expect(lookAlikeGateOn({})).toBe(true);
    expect(lookAlikeGateOn({ LOOK_ALIKE_GATE: "0" })).toBe(false);
    setLookAlikeGateForTests(false);
    expect(lookAlikeGateOn({})).toBe(false);
    await call("create_character", ingeborg, await agent());
    expect((await call("create_character", tramTwin, await agent())).isError).toBeFalsy();
  });

  it("refuses the first save, says nothing was saved, names the look-alike and what matched, and gives names and jobs to try", async () => {
    const first = (await call("create_character", ingeborg, await agent())).structuredContent.character;
    const r = await call("create_character", tramTwin, await agent());
    expect(r.isError).toBe(true);
    const out = r.structuredContent;
    expect(out).toMatchObject({ code: "look_alike", saved: false, look_alikes: [expect.objectContaining({ id: first.id, name: "Ingeborg Salvesen", why: expect.stringMatching(/Ingeborg Salvesen/) })] });
    expect(out.error).toMatch(/^Nothing was saved because it reads a lot like Ingeborg Salvesen \(/);
    expect(out.error).toMatch(/call again with keep_look_alike: true\.$/);
    expect(out.try_names.length).toBeGreaterThan(0);
    expect(out.try_instead.length).toBeGreaterThan(0);
    expect(out.originality.verdict).toBe("consider changing");
    expect(out.keep_look_alike_note).toMatch(/keep_look_alike: true/);
    expect(await count("Vesna Horvat")).toBe(0);
  });

  it("keep_look_alike: true saves it, with the look-alike warning at the front as before", async () => {
    await call("create_character", ingeborg, await agent());
    const made = (await call("create_character", { ...tramTwin, keep_look_alike: true }, await agent())).structuredContent;
    expect(made.saved).toBe(true);
    expect(made.warning).toMatch(/^Saved, but it reads a lot like Ingeborg Salvesen/);
    expect(await count("Vesna Horvat")).toBe(1);
  });

  it("check_only's 'consider changing' says the save will refuse it, and how to save it anyway", async () => {
    await call("create_character", ingeborg, await agent());
    const checked = (await call("create_character", { ...tramTwin, check_only: true }, await agent())).structuredContent;
    expect(checked.saved).toBe(false);
    expect(checked.originality.verdict).toBe("consider changing");
    expect(checked.keep_look_alike_needed).toBe(true);
    expect(checked.originality.verdict_note).toMatch(/keep_look_alike: true/);
    expect(checked.originality.verdict_note).not.toMatch(/You can still create it/);
    expect(checked.warning).toMatch(/pass keep_look_alike: true\.$/);
    expect(checked.next).toMatch(/keep_look_alike: true/);
    // A sheet that stands apart hears nothing of it.
    const apart = (await call("create_character", { ...validCharacter({ name: "Odo Pellow" }), check_only: true }, await agent())).structuredContent;
    expect(apart.keep_look_alike_needed).toBeUndefined();
    expect(apart.next).toBe("Nothing was saved. Call create_character again without check_only to create it.");
  });

  it("your own characters, a shared first name, and a name you chose to keep don't stop a save", async () => {
    const mine = await agent();
    await call("create_character", ingeborg, mine);
    // Your own look-alike: the warning names it, the save goes through.
    const own = (await call("create_character", tramTwin, mine)).structuredContent;
    expect(own.saved).toBe(true);
    expect(own.warning).toMatch(/Ingeborg Salvesen/);
    // Someone else's character with the same first name only.
    const named = await call("create_character", validCharacter({ name: "Ingeborg Lund", bio: "Restores fairground organs in a barn outside Bergen and tunes them by ear.", traits: ["loud", "warm", "stubborn"], want: "A slow waltz", dealbreaker: "Earplugs" }), await agent());
    expect(named.structuredContent.error).toBeUndefined(); // the refusal, if any, says why
    // keep_name: the same name, another story: the name was the agent's call, and nothing else is alike.
    const kept = await call("create_character", validCharacter({ name: "Ingeborg Salvesen", keep_name: true, bio: "Keeps bees on the roof of a bank and names every queen after a central banker.", traits: ["bold", "funny", "nosy"], want: "Honey on toast at dawn", dealbreaker: "Wasps" }), await agent());
    expect(kept.structuredContent.error).toBeUndefined(); // the refusal, if any, says why
  });

  it("editing a character isn't gated: update_character saves an edit that reads like someone else's", async () => {
    await call("create_character", ingeborg, await agent());
    const b = await agent();
    const id = (await call("create_character", validCharacter({ name: "Vesna Horvat" }), b)).structuredContent.character.id;
    const r = await call("update_character", { character_id: id, bio: tramTwin.bio, extras: { occupation: "Tram announcer" } }, b);
    expect(r.isError).toBeFalsy();
    expect((await t.db.query(`select bio from characters where id = $1`, [id])).rows[0].bio).toBe(tramTwin.bio);
  });
});
