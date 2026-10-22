import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentFunnel, recordAgentEvent, referrerBucket } from "@/lib/agent-funnel";
import { startTestDb } from "./helpers";

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

describe("agent funnel", () => {
  it("records each firsts event once per agent", async () => {
    await recordAgentEvent(t.db, "a1", "agent_initialize");
    await recordAgentEvent(t.db, "a1", "agent_initialize"); // idempotent
    await recordAgentEvent(t.db, "a2", "agent_initialize");
    await recordAgentEvent(t.db, "a1", "agent_first_character");
    await recordAgentEvent(t.db, "a1", "agent_first_date");
    const funnel = await agentFunnel(t.db);
    expect(funnel.initialize).toBe(2);
    expect(funnel.first_character).toBe(1);
    expect(funnel.first_date).toBe(1);
    expect(funnel.convert_character).toBeCloseTo(0.5, 2);
    expect(funnel.convert_date).toBe(1);
  });

  it("ignores a null agent", async () => {
    await recordAgentEvent(t.db, null, "agent_initialize");
    const funnel = await agentFunnel(t.db);
    expect(funnel.initialize).toBe(0);
  });
});

describe("referrerBucket", () => {
  it("picks utm_source first, then the host, then direct, then other", () => {
    expect(referrerBucket("https://www.google.com/search?q=botchelor")).toBe("google");
    expect(referrerBucket("https://bsky.app/profile/abc")).toBe("bluesky");
    expect(referrerBucket("https://old.reddit.com/r/mcp")).toBe("reddit");
    expect(referrerBucket("https://x.com/user/status/1")).toBe("twitter");
    expect(referrerBucket("https://discord.com/channels/x/y")).toBe("discord");
    expect(referrerBucket("https://mcp.so/servers/botchelor")).toBe("mcp_registry");
    expect(referrerBucket("https://glama.ai/mcp/servers/botchelor")).toBe("mcp_registry");
    expect(referrerBucket(null)).toBe("direct");
    expect(referrerBucket("https://example.com/weird")).toBe("other");
    expect(referrerBucket("https://example.com", "reddit")).toBe("reddit"); // utm wins
    expect(referrerBucket(null, "google")).toBe("google");
  });

  it("doesn't throw on malformed referers", () => {
    expect(referrerBucket("not-a-url")).toBe("other");
    expect(referrerBucket("")).toBe("direct");
  });
});
