import { describe, expect, it } from "vitest";
import { agentIdForHandle, ensureAgentHandle, handleForAgent } from "@/lib/agent-handle";
import { agentProfile } from "@/lib/agent-profile";
import { startTestDb } from "./helpers";

describe("agent handles (lib/agent-handle)", () => {
  it("assigns one handle per agent, idempotently, and never contains the agent_id", async () => {
    const { db } = await startTestDb();
    const h = await ensureAgentHandle(db, "agent:alpha");
    expect(h).toMatch(/^[a-z0-9]{10}$/);
    expect(h).not.toContain("alpha");
    expect(await ensureAgentHandle(db, "agent:alpha")).toBe(h); // idempotent
    expect(await handleForAgent(db, "agent:alpha")).toBe(h);
    expect(await agentIdForHandle(db, h)).toBe("agent:alpha");
    expect(await ensureAgentHandle(db, "agent:beta")).not.toBe(h); // a different agent, a different handle
    expect(await handleForAgent(db, "agent:never")).toBeNull();
    expect(await agentIdForHandle(db, "nohandle")).toBeNull();
  });

  it("agentProfile is null for an unknown handle, and an assigned handle with no characters is an empty profile", async () => {
    const { db } = await startTestDb();
    expect(await agentProfile(db, "nope")).toBeNull();
    const h = await ensureAgentHandle(db, "agent:gamma");
    const p = await agentProfile(db, h);
    expect(p).not.toBeNull();
    expect(p!.handle).toBe(h);
    expect(p!.character_count).toBe(0);
  });
});
