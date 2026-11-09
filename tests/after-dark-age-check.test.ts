import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as verifyRoute } from "@/app/api/after-dark/verify/route";
import { GET as returnRoute } from "@/app/api/after-dark/verify/return/route";
import { POST as webhookRoute } from "@/app/api/after-dark/verify/webhook/route";
import { POST as tasteRoute } from "@/app/api/after-dark/taste/route";
import { deleteAfterDarkData } from "@/lib/account";
import { ageCheckOffer, ageCheckState, canonicalJson, DIDIT_API, diditOn, diditSignatureOk, hasAgePass, recordAgeResult } from "@/lib/adult/age-check";
import { accessForUser, forgetRememberedPlacesForTests, mediaAllowedFor, viewerAccess } from "@/lib/adult/place";
import { afterDarkAccess, VERIFY_OPENS, withAgePass, type Place } from "@/lib/jurisdiction";
import { setPlaceForTests } from "@/lib/place";
import { BASE_URL, jsonRequest, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

// The Didit age check (David, 2026-11-09): a pass opens After Dark in GB (media), AU and BR (all of it), for a year.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

/** Built from parts so no literal secret sits in the repo. */
const SECRET = ["didit", "webhook", "test", "0123456789"].join("-");
const realFetch = globalThis.fetch;
let diditCalls: { url: string; init?: RequestInit }[] = [];
let decision: Record<string, unknown> = {};

function turnOn() {
  vi.stubEnv("DIDIT_API_KEY", ["test", "key"].join("-"));
  vi.stubEnv("DIDIT_WORKFLOW_ID", "00000000-0000-0000-0000-000000000001");
  vi.stubEnv("DIDIT_WEBHOOK_SECRET", SECRET);
}

beforeEach(async () => {
  await t.reset();
  forgetRememberedPlacesForTests();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("DIDIT_API_KEY", "");
  vi.stubEnv("DIDIT_WORKFLOW_ID", "");
  vi.stubEnv("DIDIT_WEBHOOK_SECRET", "");
  await t.db.query(`insert into adult_settings (id) values (1) on conflict (id) do nothing`);
  setPlaceForTests({ country: "GB", region: null });
  diditCalls = [];
  decision = {};
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith(DIDIT_API)) return realFetch(input, init);
    diditCalls.push({ url, init });
    if (url.endsWith("/v3/session/")) {
      return Response.json({ session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", url: "https://verify.didit.me/session/abc", status: "Not Started" }, { status: 201 });
    }
    if (url.includes("/decision/")) return Response.json(decision);
    return new Response("not found", { status: 404 });
  });
});
afterEach(() => {
  setPlaceForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function person() {
  const id = userIdOf(newUserCookie());
  return { id, cookie: signedInCookie(id) };
}
const verify = (cookie?: string) => verifyRoute(jsonRequest("/api/after-dark/verify", {}, { cookie }));
const at = (where: Place) => setPlaceForTests(where);
const GB = { country: "GB", region: null };
const AU = { country: "AU", region: null };
const BR = { country: "BR", region: null };

function webhook(body: Record<string, unknown>, opts: { secret?: string; v2?: boolean; ts?: number } = {}) {
  const raw = JSON.stringify(body);
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { "content-type": "application/json", "x-timestamp": String(ts) };
  const key = opts.secret ?? SECRET;
  if (opts.v2) headers["x-signature-v2"] = createHmac("sha256", key).update(canonicalJson(body)).digest("hex");
  else headers["x-signature"] = createHmac("sha256", key).update(raw).digest("hex");
  return webhookRoute(new Request(`${BASE_URL}/api/after-dark/verify/webhook`, { method: "POST", headers, body: raw }));
}
const event = (userId: string, status: string, country = "GB") => ({
  event_id: "9c0c8b8a-1111-4222-9333-444444444444",
  webhook_type: "status.updated",
  session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  status,
  vendor_data: userId,
  metadata: { country },
  decision: { liveness_checks: [{ status, age_estimation: 31.2 }] },
});

describe("off by default", () => {
  it("changes nothing while Didit isn't set up", async () => {
    expect(diditOn()).toBe(false);
    const p = person();
    const res = await verify(p.cookie);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_available");
    expect((await webhook(event(p.id, "Approved"))).status).toBe(404);
    expect((await returnRoute(new Request(`${BASE_URL}/api/after-dark/verify/return?verificationSessionId=abc12345`, { headers: { cookie: p.cookie } }))).status).toBe(404);
    // Even a pass already on record counts for nothing while it's off.
    await recordAgeResult(t.db, p.id, true, "GB");
    expect(await hasAgePass(t.db, p.id)).toBe(false);
    expect((await accessForUser(t.db, p.id, GB, false)).mode).toBe("text_only");
    expect((await accessForUser(t.db, p.id, AU, false)).mode).toBe("blocked");
    expect(await ageCheckOffer(t.db, { ...afterDarkAccess(GB), userId: p.id, entitled: { ok: true } })).toBeNull();
    expect(diditCalls).toHaveLength(0);
  });
});

describe("the places a pass opens", () => {
  it("opens only GB, AU and BR", () => {
    expect([...VERIFY_OPENS]).toEqual(["GB", "AU", "BR"]);
    expect(withAgePass(afterDarkAccess(GB), true).mode).toBe("open");
    expect(withAgePass(afterDarkAccess(AU), true).mode).toBe("open");
    expect(withAgePass(afterDarkAccess(BR), true).mode).toBe("open");
    for (const where of [{ country: "FR", region: null }, { country: "DE", region: null }, { country: "IT", region: null }, { country: "US", region: "TX" }, { country: "JP", region: null }]) {
      expect(withAgePass(afterDarkAccess(where), true).mode).toBe(afterDarkAccess(where).mode);
    }
    expect(withAgePass(afterDarkAccess(GB), false).mode).toBe("text_only");
  });
});

describe("starting a check", () => {
  it("creates a Didit session for the signed-in person and answers its url", async () => {
    turnOn();
    const p = person();
    const res = await verify(p.cookie);
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://verify.didit.me/session/abc");
    expect(diditCalls).toHaveLength(1);
    const init = diditCalls[0]!.init!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    const sent = JSON.parse(String(init.body));
    expect(sent).toEqual({
      workflow_id: "00000000-0000-0000-0000-000000000001",
      vendor_data: p.id,
      callback: expect.stringMatching(/\/api\/after-dark\/verify\/return$/),
      metadata: { country: "GB" },
    });
  });

  it("is refused signed out, where a pass opens nothing, once passed, and past the rate limit", async () => {
    turnOn();
    expect((await verify(undefined)).status).toBe(401);
    const p = person();
    at({ country: "CA", region: "ON" });
    expect((await verify(p.cookie)).status).toBe(409);
    at({ country: "US", region: "TX" });
    expect((await verify(p.cookie)).status).toBe(409);
    at({ country: "FR", region: null });
    expect((await verify(p.cookie)).status).toBe(409);
    at(AU);
    for (let i = 0; i < 3; i++) expect((await verify(p.cookie)).status).toBe(200);
    expect((await verify(p.cookie)).status).toBe(429);
    const q = person();
    await recordAgeResult(t.db, q.id, true, "AU");
    expect((await verify(q.cookie)).status).toBe(409);
  });
});

describe("the webhook", () => {
  it("records a pass from a well-signed Approved, once", async () => {
    turnOn();
    const p = person();
    const res = await webhook(event(p.id, "Approved"));
    expect(res.status).toBe(200);
    expect(await ageCheckState(t.db, p.id)).toBe("passed");
    const row = (await t.db.query(`select * from adult_age_checks where user_id = $1`, [p.id])).rows[0] as Record<string, unknown>;
    // Only these: never the selfie, an ID, a birth date, an age or the payload.
    expect(Object.keys(row).sort()).toEqual(["checked_at", "country", "method", "passed", "user_id"]);
    expect(row).toMatchObject({ passed: true, method: "didit", country: "GB" });
    const first = new Date(row.checked_at as string).getTime();
    // A replay changes nothing.
    expect((await webhook(event(p.id, "Approved"))).status).toBe(200);
    const again = (await t.db.query<{ checked_at: Date }>(`select checked_at from adult_age_checks where user_id = $1`, [p.id])).rows[0]!;
    expect(new Date(again.checked_at).getTime()).toBe(first);
  });

  it("accepts the X-Signature-V2 canonical form too", async () => {
    turnOn();
    const p = person();
    expect((await webhook(event(p.id, "Approved"), { v2: true })).status).toBe(200);
    expect(await hasAgePass(t.db, p.id)).toBe(true);
  });

  it("refuses a bad signature or a stale timestamp, and records nothing", async () => {
    turnOn();
    const p = person();
    expect((await webhook(event(p.id, "Approved"), { secret: "wrong" })).status).toBe(401);
    expect((await webhook(event(p.id, "Approved"), { ts: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    const unsigned = await webhookRoute(new Request(`${BASE_URL}/api/after-dark/verify/webhook`, { method: "POST", body: JSON.stringify(event(p.id, "Approved")) }));
    expect(unsigned.status).toBe(401);
    expect(await ageCheckState(t.db, p.id)).toBe("none");
    expect(diditSignatureOk("{}", new Headers({ "x-timestamp": String(Math.floor(Date.now() / 1000)), "x-signature": "zz" }), SECRET)).toBe(false);
  });

  it("a decline keeps it closed, and never undoes a current pass", async () => {
    turnOn();
    const p = person();
    await webhook(event(p.id, "Declined"));
    expect(await ageCheckState(t.db, p.id)).toBe("failed");
    expect((await accessForUser(t.db, p.id, GB, false)).mode).toBe("text_only");
    expect((await accessForUser(t.db, p.id, AU, false)).mode).toBe("blocked");
    expect(await ageCheckOffer(t.db, { ...afterDarkAccess(AU), userId: p.id, entitled: { ok: false } })).toBe("failed");
    // In Review and the like are still on their way.
    await webhook(event(p.id, "In Review"));
    expect(await ageCheckState(t.db, p.id)).toBe("failed");
    // Trying again and passing opens it; a late decline doesn't close it.
    await webhook(event(p.id, "Approved"));
    expect(await ageCheckState(t.db, p.id)).toBe("passed");
    await webhook(event(p.id, "Declined"));
    expect(await ageCheckState(t.db, p.id)).toBe("passed");
  });
});

describe("coming back from Didit", () => {
  const back = (cookie: string, id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") =>
    returnRoute(new Request(`${BASE_URL}/api/after-dark/verify/return?verificationSessionId=${id}&status=Approved`, { headers: { cookie } }));

  it("reads the decision from Didit, not the query string, and only for this person", async () => {
    turnOn();
    const p = person();
    decision = { status: "In Review", vendor_data: p.id, metadata: { country: "AU" } };
    let res = await back(p.cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/after-dark\/subscribe\?age=pending$/);
    expect(await ageCheckState(t.db, p.id)).toBe("none");
    expect(diditCalls[0]!.url).toBe(`${DIDIT_API}/v3/session/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/decision/`);

    decision = { status: "Approved", vendor_data: "someone-else", metadata: { country: "AU" } };
    res = await back(p.cookie);
    expect(res.headers.get("location")).toMatch(/age=pending$/);
    expect(await ageCheckState(t.db, p.id)).toBe("none");

    decision = { status: "Approved", vendor_data: p.id, metadata: { country: "AU" } };
    res = await back(p.cookie);
    expect(res.headers.get("location")).toMatch(/age=passed$/);
    expect(await ageCheckState(t.db, p.id)).toBe("passed");
  });
});

describe("what a pass opens", () => {
  it("opens GB's pictures, video and voice", async () => {
    turnOn();
    const p = person();
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, provider, age_verified_at) values ($1, 'active', 'beta', now())`, [p.id]);
    expect((await viewerAccess(t.db, p.id, false, new Headers())).mode).toBe("text_only");
    expect(await mediaAllowedFor(t.db, p.id)).toBe(false);
    await webhook(event(p.id, "Approved"));
    forgetRememberedPlacesForTests();
    expect((await viewerAccess(t.db, p.id, false, new Headers())).mode).toBe("open");
    expect(await mediaAllowedFor(t.db, p.id)).toBe(true);
  });

  it("opens AU and BR, so the free taste can start there", async () => {
    turnOn();
    for (const where of [AU, BR]) {
      at(where);
      const p = person();
      const taste = () => tasteRoute(jsonRequest("/api/after-dark/taste", { adult: true }, { cookie: p.cookie }));
      expect((await accessForUser(t.db, p.id, where, false)).mode).toBe("blocked");
      expect((await taste()).status).toBe(451);
      expect(await ageCheckOffer(t.db, { ...afterDarkAccess(where), userId: p.id, entitled: { ok: false } })).toBe("offer");
      await webhook(event(p.id, "Approved", where.country));
      expect((await accessForUser(t.db, p.id, where, false)).mode).toBe("open");
      expect((await taste()).status).toBe(200);
    }
  });

  it("lasts a year, then closes again", async () => {
    turnOn();
    const p = person();
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, provider, age_verified_at) values ($1, 'active', 'beta', now())`, [p.id]);
    await webhook(event(p.id, "Approved"));
    await viewerAccess(t.db, p.id, false, new Headers());
    expect(await mediaAllowedFor(t.db, p.id)).toBe(true);
    await t.db.query(`update adult_age_checks set checked_at = now() - interval '366 days' where user_id = $1`, [p.id]);
    // The remembered "open" no longer counts once the pass has run out, even before they come back.
    expect(await mediaAllowedFor(t.db, p.id)).toBe(false);
    expect(await ageCheckState(t.db, p.id)).toBe("none");
    expect((await accessForUser(t.db, p.id, GB, false)).mode).toBe("text_only");
    // And they can verify again, which starts a new year.
    expect((await verify(p.cookie)).status).toBe(200);
    await webhook(event(p.id, "Approved"));
    expect(await hasAgePass(t.db, p.id)).toBe(true);
  });
});

describe("deleting After Dark data", () => {
  it("removes the age check", async () => {
    turnOn();
    const p = person();
    await webhook(event(p.id, "Approved"));
    await deleteAfterDarkData(t.db, p.id);
    expect((await t.db.query(`select 1 from adult_age_checks where user_id = $1`, [p.id])).rows).toHaveLength(0);
  });
});
