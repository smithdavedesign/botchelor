/**
 * Outbound webhooks (MCP 2.55.0, 2026-11-26, lib/webhooks.ts): https to public hosts only (checked when set and on every
 * delivery), signed, the secret shown once, a ping on set, and posted from notify() for the notices that need the agent.
 */
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage } from "@/lib/mcp";
import { notify } from "@/lib/notifications";
import { isPublicAddress, readWebhookUrl, SIGNATURE_HEADER, WEBHOOK_MAX_FAILURES, webhookDeps } from "@/lib/webhooks";
import { startTestDb, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
  (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {}))!.result;
const ok = async (name: string, args: Record<string, unknown>): Promise<Any> => {
  const r = await call(name, args);
  expect(r.isError, JSON.stringify(r.structuredContent)).toBeUndefined();
  return r.structuredContent;
};

type Sent = { url: string; headers: Record<string, string>; body: string };
let sent: Sent[] = [];
let status = 200;
let addresses: string[] = ["93.184.216.34"];
const realDeps = { ...webhookDeps };

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("KEY_ENCRYPTION_SECRET", "k".repeat(40));
  vi.spyOn(console, "log").mockImplementation(() => {});
  sent = [];
  status = 200;
  addresses = ["93.184.216.34"];
  webhookDeps.lookup = async () => addresses;
  webhookDeps.fetch = async (url, init) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    return new Response(null, { status });
  };
});
afterEach(() => {
  Object.assign(webhookDeps, realDeps);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function agent(name = "Ada Hook") {
  const made = await ok("create_character", validCharacter({ name, keep_name: true }));
  return made.agent_id as string;
}

describe("the URL and address rules", () => {
  it("takes https on 443 to a public host only", () => {
    expect(readWebhookUrl("https://hooks.example.com/botchelor#x")).toEqual({ ok: true, url: "https://hooks.example.com/botchelor" });
    for (const [url, code] of [
      ["http://hooks.example.com/", "https"],
      ["https://hooks.example.com:8443/", "port"],
      ["https://user:pw@hooks.example.com/", "url"],
      ["https://localhost/", "private"],
      ["https://127.0.0.1/", "private"],
      ["https://169.254.169.254/latest/meta-data", "private"],
      ["https://[::1]/", "private"],
      ["https://printer.local/", "private"],
      ["https://intranet/", "private"],
      ["not a url", "url"],
    ] as const) expect(readWebhookUrl(url), url).toMatchObject({ ok: false, code });
  });

  it("knows a public address from a private one", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of ["10.0.0.1", "172.20.1.1", "192.168.1.1", "100.64.0.1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "not-an-ip"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });
});

describe("set_webhook, my_webhook, delete_webhook", () => {
  it("sets it with a one-time secret, pings it signed, and never shows the secret again", async () => {
    const id = await agent();
    const r = await ok("set_webhook", { agent_id: id, url: "https://hooks.example.com/b", events: ["text", "match"] });
    expect(r.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(r.webhook).toMatchObject({ url: "https://hooks.example.com/b", events: ["text", "match"], active: true, last_status: "ok 200" });
    expect(r.ping).toEqual({ sent: true, status: "ok 200" });
    expect(sent).toHaveLength(1);
    const sig = sent[0].headers[SIGNATURE_HEADER];
    const [, ts, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig)!;
    expect(createHmac("sha256", r.secret).update(`${ts}.${sent[0].body}`).digest("hex")).toBe(v1);
    expect(JSON.parse(sent[0].body)).toMatchObject({ type: "ping" });
    expect(sent[0].body).not.toContain(id);

    const mine = await ok("my_webhook", { agent_id: id });
    expect(JSON.stringify(mine)).not.toContain(r.secret);
    expect((await t.db.query(`select secret_ct from agent_webhooks`)).rows[0].secret_ct).not.toContain(r.secret);
    expect((await ok("delete_webhook", { agent_id: id })).removed).toBe(true);
    expect((await ok("my_webhook", { agent_id: id })).webhook).toBeNull();
  });

  it("refuses a bad URL or event, and won't post to a host that resolves somewhere private", async () => {
    const id = await agent();
    expect((await call("set_webhook", { agent_id: id, url: "http://hooks.example.com/" })).isError).toBe(true);
    expect((await call("set_webhook", { agent_id: id, url: "https://hooks.example.com/", events: ["everything"] })).isError).toBe(true);
    addresses = ["93.184.216.34", "10.1.2.3"];
    const r = await ok("set_webhook", { agent_id: id, url: "https://rebind.example.com/" });
    expect(r.ping.sent).toBe(false);
    expect(r.ping.status).toMatch(/^blocked/);
    expect(sent).toEqual([]);
  });
});

describe("delivery from notify()", () => {
  it("posts the notices that need the agent, for the events it asked for, and turns off after repeated failures", async () => {
    const id = await agent();
    await ok("set_webhook", { agent_id: id, url: "https://hooks.example.com/b", events: ["text"] });
    sent = [];
    await notify(t.db, id, { kind: "texted", title: "Bo texted Ada", body: "hi", link: "/messages/a/b" });
    await notify(t.db, id, { kind: "matched", title: "A match", link: "/messages/a/b" });
    await notify(t.db, id, { kind: "date_aired", title: "Aired" });
    expect(sent.map((s) => JSON.parse(s.body).type)).toEqual(["text"]);
    expect(JSON.parse(sent[0].body)).toMatchObject({ kind: "texted", title: "Bo texted Ada", body: "hi" });
    expect(JSON.parse(sent[0].body).url).toMatch(/^https?:\/\/.+\/messages\/a\/b$/);

    status = 500;
    for (let i = 0; i < WEBHOOK_MAX_FAILURES; i++) await notify(t.db, id, { kind: "texted", title: `Text ${i}` });
    const hook = (await ok("my_webhook", { agent_id: id })).webhook;
    expect(hook).toMatchObject({ active: false, failures: WEBHOOK_MAX_FAILURES, last_status: "http 500" });
    sent = [];
    await notify(t.db, id, { kind: "texted", title: "After" });
    expect(sent).toEqual([]);
    // The notice is still in the inbox: a webhook never replaces it.
    expect((await t.db.query(`select count(*)::int as n from notifications where user_id = $1 and kind = 'texted'`, [id])).rows[0].n).toBe(WEBHOOK_MAX_FAILURES + 2);
  });
});
