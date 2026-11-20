import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { PRONOUNS_UNSET_NOTE } from "@/lib/mcp/dispatcher";
import { gendersPartner, replyMessages, CROWD } from "../scripts/loop/crowd.mjs";
import { startTestDb, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// #1844 (the 2026-11-19-1746 run): house bot Ines called a visitor's Pip "a man"; Pip's sheet gave no pronouns, and the
// agent only found the field afterwards.
describe("a character with no pronouns", () => {
  it("the crowd never genders a partner who hasn't said, and follows the pronouns of one who has", () => {
    expect(gendersPartner("You're a real gentleman, Pip.", null)).toBeTruthy();
    expect(gendersPartner("Thank you, sir.", null)).toBe("sir");
    expect(gendersPartner("You are such a lovely woman.", "they/them")).toBeTruthy();
    expect(gendersPartner("You're a real gentleman, Pip.", "he/him")).toBeNull();
    expect(gendersPartner("You're a real gentleman, Pip.", "she/her")).toBeTruthy();
    // About someone else, or no gender at all: fine.
    expect(gendersPartner("My brother, he fixes boats.", null)).toBeNull();
    expect(gendersPartner("You're a good listener, Pip.", null)).toBeNull();
    const me = CROWD[0].characters[0];
    const prompt = (pronouns: string | null) => replyMessages({ kind: "turn", me, partner: { name: "Pip Harlow", pronouns }, history: [{ name: "Pip Harlow", text: "Hello." }] })[0].content;
    expect(prompt(null)).toContain("Pip hasn't said their gender: never call them a man, woman");
    expect(prompt("she/her")).toContain("Pip's pronouns are she/her.");
  });

  describe("create_character", () => {
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
    });
    const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> =>
      (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
    async function connect(): Promise<McpContext> {
      const ctx: McpContext = {};
      await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-pronouns-test" } } }, ctx);
      return { sessionId: ctx.issuedSessionId };
    }

    it("says when none were given, and how to set them; not when they were", async () => {
      const ctx = await connect();
      const bare = validCharacter({ name: "Pip Harlow", keep_name: true });
      delete (bare as Record<string, unknown>).pronouns;
      const none = (await call("create_character", bare, ctx)).structuredContent;
      expect(none.pronouns_note).toBe(PRONOUNS_UNSET_NOTE);
      const set = (await call("create_character", validCharacter({ name: "Odessa Lark", keep_name: true, pronouns: "she/her" }), ctx)).structuredContent;
      expect(set.character?.id ?? set.id).toBeTruthy();
      expect(set.pronouns_note).toBeUndefined();
    });
  });
});
