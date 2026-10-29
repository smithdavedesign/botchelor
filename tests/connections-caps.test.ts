import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT as putConnection } from "@/app/api/me/connections/route";
import { POST as postOwnText } from "@/app/api/couples/[a]/[b]/texts/route";
import * as portraitRoute from "@/app/api/characters/[id]/portrait/route";
import { registerAccount } from "@/lib/auth";
import {
  assignJob,
  callCost,
  currentUsage,
  jobUsability,
  listConnections,
  noteSpend,
  recordError,
  recordUsage,
  saveConnection,
} from "@/lib/connections";
import { capLevel, clampCap, jobCards, money, monthOf, nextMonthStart, PORTRAIT_ESTIMATE_USD, resetDay, WARN_AT } from "@/lib/connections-shared";
import { setEmailSenderForTests, type EmailMessage } from "@/lib/email";
import { buildKeyForSide, userTextModel } from "@/lib/keys";
import type { SideOutcome } from "@/lib/engine";
import { ModelError, setModelForTests, type Model } from "@/lib/model";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import { pairKey } from "@/lib/relationships";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Connections M3 (docs/PRDs/connections.md): every call on a person's key counted for the month (the provider's own cost,
// else tokens × list price), a cap per job with a meter, a heads-up at 80% (in the app, and by email when they opted in),
// and at the cap or when the key fails, Botchelor's free model stands in, or the dates they book wait. Providers stubbed.

const U = "ffff6666-0000-4000-8000-000000000006";
const fakeKey = (tag: string) => ["test", "key", "not", "real", tag, "2468"].join("-");
const env = { SESSION_SECRET: TEST_SESSION_SECRET };
const NOW = Date.parse("2026-10-23T12:00:00Z");

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
let sent: EmailMessage[] = [];
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from accounts");
  await t.db.query("delete from notifications");
  await t.db.query("delete from email_prefs");
  await t.db.query("delete from email_sends");
  resetRateLimitsForTests();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  sent = [];
  setEmailSenderForTests(async (msg) => void sent.push(msg));
  await registerAccount(t.db, U, "capped", ["a", "good", "password"].join("-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setEmailSenderForTests(null);
  setModelForTests(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const side = (): SideOutcome => ({ wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null });
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notices = async (userId = U) =>
  (await t.db.query<{ kind: string; title: string; body: string; link: string }>(`select kind, title, body, link from notifications where user_id = $1 order by created_at`, [userId])).rows;
/** The show's model, standing in: it says so, and counts its calls. */
const showModel = () => {
  const calls: unknown[] = [];
  const model: Model = { async complete(messages) { calls.push(messages); return '{"by":"show"}'; } };
  return { model, calls };
};
/** A person's OpenRouter key on Dates & texts, with a cap and what happens at it. */
async function openRouterKey(cap: number | null, onCap: "fallback" | "pause" = "fallback", userId = U) {
  await saveConnection(t.db, userId, "openrouter", fakeKey("or"), { env });
  await assignJob(t.db, userId, "text", "openrouter", "deepseek/deepseek-chat-v3.1", {}, { cap_usd: cap, on_cap: onCap });
}
/** OpenRouter answering each call with the cost it reports (or a refusal), recording the request bodies. */
function openRouter(answers: (Response | (() => Response))[]) {
  const bodies: Record<string, unknown>[] = [];
  let i = 0;
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const a = answers[Math.min(i++, answers.length - 1)];
    return typeof a === "function" ? a() : a.clone();
  });
  return bodies;
}
const costing = (usd: number) => jsonRes({ choices: [{ message: { content: '{"by":"key"}' } }], usage: { prompt_tokens: 1000, completion_tokens: 100, cost: usd } });

describe("months, money and the cap's levels", () => {
  it("counts in UTC months and resets on the 1st", () => {
    expect(monthOf(NOW)).toBe("2026-10");
    expect(monthOf(Date.parse("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(monthOf(Date.parse("2026-11-01T00:00:00Z"))).toBe("2026-11");
    expect(nextMonthStart(NOW).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextMonthStart(Date.parse("2026-12-15T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(resetDay(NOW)).toBe("Nov 1");
  });

  it("writes dollars plainly, and reads a cap as a positive number of dollars or none", () => {
    expect([money(10), money(1.2), money(0.04), money(0.004), money(0)]).toEqual(["$10", "$1.20", "$0.04", "<$0.01", "$0"]);
    expect([clampCap(10), clampCap("7.5"), clampCap(0), clampCap(-3), clampCap(5000), clampCap("lots"), clampCap(null)]).toEqual([10, 7.5, null, null, 1000, null, null]);
    expect(WARN_AT).toBe(0.8);
    expect([capLevel(1, null), capLevel(7.9, 10), capLevel(8, 10), capLevel(10, 10), capLevel(12, 10)]).toEqual(["none", "ok", "warn", "over", "over"]);
  });
});

describe("what a call cost (callCost)", () => {
  it("takes the provider's own figure, else tokens × list price (a router's prefix dropped), else leaves it unpriced", () => {
    expect(callCost("deepseek/deepseek-chat-v3.1", { model: "x", input: 1000, cachedInput: 0, output: 100, thinking: 0, cost: 0.0042 })).toEqual({ usd: 0.0042, how: "reported", input: 1000, output: 100 });
    const est = callCost("gpt-4.1-mini", { model: "gpt-4.1-mini", input: 10_000, cachedInput: 0, output: 1_000, thinking: 0 });
    expect(est.how).toBe("estimated");
    expect(est.usd).toBeCloseTo((10_000 * 0.4 + 1_000 * 1.6) / 1e6, 10);
    expect(callCost("openai/gpt-4.1-mini", { model: "x", input: 10_000, cachedInput: 0, output: 1_000, thinking: 0 }).how).toBe("estimated");
    expect(callCost("some/unknown-model", { model: "x", input: 10, cachedInput: 0, output: 1, thinking: 0 })).toEqual({ usd: 0, how: "unpriced", input: 10, output: 1 });
    expect(callCost("some/unknown-model", { model: "x", input: 1_000_000, cachedInput: 0, output: 0, thinking: 0 }, { input: 2, output: 8 })).toMatchObject({ usd: 2, how: "estimated" });
  });
});

describe("the month's ledger and its notices", () => {
  it("adds every call to the job's month, apart from other months, and notifies at 80% and at the cap once each", async () => {
    await openRouterKey(1);
    const cap = { cap_usd: 1, on_cap: "fallback" as const };
    expect((await recordUsage(t.db, U, "text", { usd: 0.5, how: "reported", input: 10, output: 1 }, NOW))?.cost_usd).toBe(0.5);
    await recordUsage(t.db, U, "text", { usd: 0, how: "unpriced", input: 5, output: 1 }, NOW);
    expect((await recordUsage(t.db, U, "text", { usd: 0.35, how: "estimated", input: 10, output: 1 }, NOW))?.cost_usd).toBeCloseTo(0.85, 10);
    await recordUsage(t.db, U, "text", { usd: 3, how: "reported", input: 0, output: 0 }, Date.parse("2026-09-30T12:00:00Z")); // last month
    expect((await currentUsage(t.db, U, NOW)).text).toEqual({ cost_usd: expect.closeTo(0.85, 10), calls: 3, estimated_calls: 1, unpriced_calls: 1 });

    await noteSpend(t.db, U, "text", "openrouter", 0.85, cap, NOW);
    await noteSpend(t.db, U, "text", "openrouter", 0.9, cap, NOW); // the heads-up went already
    await noteSpend(t.db, U, "text", "openrouter", 1.02, cap, NOW);
    await noteSpend(t.db, U, "text", "openrouter", 1.5, cap, NOW); // so did the cap notice
    expect(await notices()).toEqual([
      expect.objectContaining({ kind: "key_usage", title: "🔑 Dates & texts is at 80% of its $1 cap", link: "/account/keys#dates" }),
      expect.objectContaining({ kind: "key_capped", title: "🔑 Dates & texts reached its $1 cap for the month" }),
    ]);
    expect((await notices())[1].body).toContain("Botchelor's free model stands in for your dates, and for a few texts a day, until Nov 1.");
    // A new month starts the notices again.
    await noteSpend(t.db, U, "text", "openrouter", 0.9, cap, Date.parse("2026-11-02T12:00:00Z"));
    expect((await notices()).map((n) => n.kind)).toEqual(["key_usage", "key_capped", "key_usage"]);
  });

  it("emails the heads-up at once to someone who turned email on (the existing email code), and never otherwise", async () => {
    vi.stubEnv("RESEND_API_KEY", ["resend", "test", "only"].join("-"));
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "botchelor.com");
    await openRouterKey(1);
    await noteSpend(t.db, U, "text", "openrouter", 0.85, { cap_usd: 1, on_cap: "fallback" }, NOW);
    expect(sent).toHaveLength(0); // email isn't on for them
    const other = "abab7777-0000-4000-8000-000000000007";
    await registerAccount(t.db, other, "mailme", ["a", "good", "password"].join("-"));
    await t.db.query(`insert into email_prefs (user_id, email, status, confirmed_at) values ($1, 'mailme@example.test', 'on', now())`, [other]);
    await openRouterKey(1, "fallback", other);
    await noteSpend(t.db, other, "text", "openrouter", 0.85, { cap_usd: 1, on_cap: "fallback" }, NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "mailme@example.test", subject: "Dates & texts is at 80% of its $1 cap" });
    expect(sent[0].text).toContain("$0.85 of $1 this month");
    expect(sent[0].text).not.toContain(fakeKey("or"));
  });
});

describe("a person's key on dates: spend, cap and fallback", () => {
  it("counts each call's reported cost (asking OpenRouter for it), warns at 80%, and at the cap hands the rest of the date to the show", async () => {
    await openRouterKey(0.01);
    const bodies = openRouter([costing(0.0085)]);
    const show = showModel();
    const model = (await userTextModel(t.db, U, undefined, env, { fallback: show.model, now: () => NOW }))!;
    expect(await model.complete([{ role: "user", content: "line 1" }])).toBe('{"by":"key"}');
    expect(bodies[0]).toMatchObject({ usage: { include: true } });
    expect((await notices()).map((n) => n.kind)).toEqual(["key_usage"]); // 0.0085 of 0.01
    expect(await model.complete([{ role: "user", content: "line 2" }])).toBe('{"by":"key"}'); // now 0.017: over
    expect((await notices()).map((n) => n.kind)).toEqual(["key_usage", "key_capped"]);
    expect(await model.complete([{ role: "user", content: "line 3" }])).toBe('{"by":"show"}');
    expect(bodies).toHaveLength(2); // the key wasn't called again
    expect(show.calls).toHaveLength(1);
    expect((await currentUsage(t.db, U, NOW)).text?.cost_usd).toBeCloseTo(0.017, 10);
    // The next date starts over the cap: no key model at all, so the side is the show's from the start.
    expect(await userTextModel(t.db, U, undefined, env, { fallback: show.model, now: () => NOW })).toBeNull();
    const sides = await buildKeyForSide(t.db, [U, null], [true, false], undefined, env, { fallback: show.model });
    expect(sides("a")).toBeNull();
    expect((await notices()).filter((n) => n.kind === "key_capped")).toHaveLength(1); // told once
  });

  it("a key that runs dry mid-date: the show writes this line and the rest; the card says why; its owner hears once", async () => {
    await openRouterKey(null);
    const bodies = openRouter([costing(0.001), jsonRes({ error: { message: `Insufficient credits for ${fakeKey("or")}` } }, 402)]);
    const show = showModel();
    const model = (await userTextModel(t.db, U, undefined, env, { fallback: show.model, now: () => NOW }))!;
    expect(await model.complete([{ role: "user", content: "1" }])).toBe('{"by":"key"}');
    expect(await model.complete([{ role: "user", content: "2" }])).toBe('{"by":"show"}');
    expect(await model.complete([{ role: "user", content: "3" }])).toBe('{"by":"show"}');
    expect(bodies).toHaveLength(2); // off for the rest of the date after the 402
    const card = jobCards(await listConnections(t.db, U), NOW, await currentUsage(t.db, U, NOW))[0];
    expect(card).toMatchObject({ state: "fallback", pill: "On the free model", status: expect.stringMatching(/^Your OpenRouter key failed, so Botchelor's free model stands in/) });
    expect(card.error?.message).toBe("OpenRouter: out of credit.");
    const failed = (await notices()).filter((n) => n.kind === "key_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ title: "🔑 Your OpenRouter key stopped working", body: expect.stringContaining("Meanwhile Botchelor's free model stands in for your dates, and for a few texts a day.") });
    expect(failed[0].body).not.toContain(fakeKey("or"));
    // The same failure on the next date isn't told twice.
    const again = (await userTextModel(t.db, U, undefined, env, { fallback: show.model, now: () => NOW }))!;
    await again.complete([{ role: "user", content: "4" }]);
    expect((await notices()).filter((n) => n.kind === "key_failed")).toHaveLength(1);
  });

  it("a provider's bad minute (a 500) hands only that line to the show; the next line tries the key again", async () => {
    await openRouterKey(null);
    const bodies = openRouter([jsonRes({ error: "down" }, 500), costing(0.001)]);
    const show = showModel();
    const model = (await userTextModel(t.db, U, undefined, { ...env }, { fallback: show.model, now: () => NOW }))!;
    expect(await model.complete([{ role: "user", content: "1" }])).toBe('{"by":"show"}');
    expect(await model.complete([{ role: "user", content: "2" }])).toBe('{"by":"key"}');
    expect(bodies.length).toBeGreaterThanOrEqual(2);
  });

  it("with no fallback (texting on your own key), the error goes back up, with no key in it", async () => {
    await openRouterKey(null);
    openRouter([jsonRes({ error: { message: `No auth credentials found for ${fakeKey("or")}` } }, 401)]);
    const model = (await userTextModel(t.db, U, undefined, env, { now: () => NOW }))!;
    const err = await model.complete([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as Error).message).not.toContain(fakeKey("or"));
    // In plain words with the fix, for the phone to say (a bare 502 left nothing to go on, 2026-10-29).
    expect((err as Error).message).toBe("OpenRouter didn't accept this key. Check you copied all of it, or make a new key.");
  });

  it("a key out of credit, with no fallback: its words say so with the fix, and the notice says texting waits", async () => {
    await openRouterKey(null);
    openRouter([jsonRes({ error: { message: "Insufficient credits" } }, 402)]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = (await userTextModel(t.db, U, undefined, env, { now: () => NOW }))!;
    const err = await model.complete([{ role: "user", content: "hi" }]).catch((e: unknown) => e);
    expect((err as Error).message).toBe("OpenRouter: out of credit. Top up.");
    // The next call on it (a retry) says the same without asking the provider again.
    expect(await model.complete([{ role: "user", content: "again" }]).catch((e: unknown) => (e as Error).message)).toBe("OpenRouter: out of credit. Top up.");
    expect((await notices()).find((n) => n.kind === "key_failed")?.body).toBe(
      "OpenRouter: out of credit. Top up. Meanwhile Botchelor's free model stands in for your dates, and for a few texts a day.",
    );
  });

  it("estimates a call the provider prices nowhere, and counts one it reports no usage for as unpriced", async () => {
    await saveConnection(t.db, U, "openai", fakeKey("oa"), { env });
    await assignJob(t.db, U, "text", "openai", "gpt-4.1-mini");
    openRouter([jsonRes({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 30_000, completion_tokens: 1_500 } }), jsonRes({ choices: [{ message: { content: "{}" } }] })]);
    const model = (await userTextModel(t.db, U, undefined, env, { now: () => NOW }))!;
    await model.complete([{ role: "user", content: "1" }]);
    await model.complete([{ role: "user", content: "2" }]);
    expect((await currentUsage(t.db, U, NOW)).text).toEqual({ cost_usd: expect.closeTo((30_000 * 0.4 + 1_500 * 1.6) / 1e6, 10), calls: 2, estimated_calls: 1, unpriced_calls: 1 });
  });
});

describe("whether a job can run (jobUsability), and the waits", () => {
  it("none without a key; ok under the cap; over it at the cap; failing only for a key whose owner chose to pause", async () => {
    expect(await jobUsability(t.db, U, "text", NOW)).toEqual({ state: "none" });
    await openRouterKey(1, "fallback");
    expect(await jobUsability(t.db, U, "text", NOW)).toMatchObject({ state: "ok", spent: 0 });
    await recordError(t.db, U, "openrouter", "no_credit");
    expect((await jobUsability(t.db, U, "text", NOW)).state).toBe("ok"); // the free model stands in: dates go on
    await openRouterKey(1, "pause");
    await recordError(t.db, U, "openrouter", "no_credit");
    const failing = await jobUsability(t.db, U, "text", NOW);
    expect(failing).toMatchObject({ state: "failing", message: expect.stringMatching(/^OpenRouter: out of credit\. You chose to pause/) });
    await recordUsage(t.db, U, "text", { usd: 1.5, how: "reported", input: 0, output: 0 }, NOW);
    const over = await jobUsability(t.db, U, "text", NOW);
    expect(over).toMatchObject({ state: "over_cap", spent: 1.5 });
    if (over.state === "over_cap") expect(over.message).toContain("Dates & texts has reached its $1 cap for the month on your OpenRouter key. Your dates wait until Nov 1");
  });

  it("booking: someone who chose to pause books no date while their key is at its cap; with the fallback they still can", async () => {
    const cookie = newUserCookie();
    const owner = userIdOf(cookie);
    const character = await (await api.createCharacter(validCharacter(), cookie)).json();
    await registerAccount(t.db, owner, "booker", ["a", "good", "password"].join("-"));
    const session = signedInCookie(owner);
    await openRouterKey(1, "pause", owner);
    await recordUsage(t.db, owner, "text", { usd: 1.2, how: "reported", input: 0, output: 0 });
    const refused = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, session);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "key_paused", connect: "/account/keys#dates", message: expect.stringContaining("Your dates wait until") });
    // The same cap with the free model standing in: the date is booked (its side runs on the show's model).
    await assignJob(t.db, owner, "text", "openrouter", null, {}, { cap_usd: 1, on_cap: "fallback" });
    scriptedModel([
      JSON.stringify({
        setting: "A rooftop at dusk.",
        goals: ["One wants a spark.", "One wants a story."],
        scenes: ["They meet.", "Something happens.", "It ends well."],
        twist: "A pigeon.",
        finale: "They part as friends.",
        best_line: "Same time next week.",
        confessionals: ["Nice.", "Fine."],
      }),
    ]);
    expect((await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, session)).status).toBeLessThan(300);
  });

  it("texting on your own key waits at the cap, in plain words, for someone who chose to pause", async () => {
    const cookie = signedInCookie(U);
    await openRouterKey(1, "pause");
    await recordUsage(t.db, U, "text", { usd: 1, how: "reported", input: 0, output: 0 });
    const res = await postOwnText(
      new Request(`${BASE_URL}/api/couples/a/b/texts`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ character_id: "a" }) }),
      { params: Promise.resolve({ a: "a", b: "b" }) },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "over_cap", connect: "/account/keys#dates", message: expect.stringContaining("reached its $1 cap") });
  });

  it("texting at the cap with the fallback: the free model writes it, and says why", async () => {
    const cookie = newUserCookie();
    const owner = userIdOf(cookie);
    const character = await (await api.createCharacter(validCharacter(), cookie)).json();
    await registerAccount(t.db, owner, "capped_texter", ["a", "good", "password"].join("-"));
    const session = signedInCookie(owner);
    await openRouterKey(1, "fallback", owner);
    await recordUsage(t.db, owner, "text", { usd: 1.2, how: "reported", input: 0, output: 0 });
    // A date with the house partner, on the show's model (the key is at its cap).
    scriptOutcome({ ending: "second_date", sides: [side(), side()] });
    scriptedModel([episodeJson()]);
    const episode = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, session)).json();
    await api.reveal(episode.id, session);
    const show = scriptedModel([JSON.stringify({ text: "Saturday still on?" }), JSON.stringify({ text: "Wouldn't miss it." })]);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const [lo, hi] = pairKey(character.id, HOUSE_PARTNER_ID);
    const res = await postOwnText(
      new Request(`${BASE_URL}/api/couples/${lo}/${hi}/texts`, { method: "POST", headers: { "content-type": "application/json", cookie: session }, body: JSON.stringify({ character_id: character.id }) }),
      { params: Promise.resolve({ a: lo, b: hi }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      items: [{ text: "Saturday still on?" }, { text: "Wouldn't miss it." }],
      note: "Your OpenRouter key reached this month's cap. Botchelor's free model wrote this one (2 more today).",
    });
    expect(show.calls).toHaveLength(2);
  });

  it("portraits: one made is counted at its list price; at the cap they wait", async () => {
    const cookie = newUserCookie();
    const owner = userIdOf(cookie);
    const character = await (await api.createCharacter(validCharacter(), cookie)).json();
    await registerAccount(t.db, owner, "painter", ["a", "good", "password"].join("-"));
    await saveConnection(t.db, owner, "openai", fakeKey("img"), { env });
    await assignJob(t.db, owner, "image", "openai", null, {}, { cap_usd: 0.3 });
    vi.stubGlobal("fetch", async () => jsonRes({ data: [{ b64_json: Buffer.from("png").toString("base64") }] }));
    const make = () => portraitRoute.POST(new Request(`${BASE_URL}/api/characters/${character.id}/portrait`, { method: "POST", headers: { cookie } }), { params: Promise.resolve({ id: character.id }) });
    expect((await make()).status).toBe(201);
    expect((await currentUsage(t.db, owner)).image).toMatchObject({ cost_usd: PORTRAIT_ESTIMATE_USD, calls: 1, estimated_calls: 1 });
    expect((await listConnections(t.db, owner)).connections[0].last_used_at).not.toBeNull();
    expect((await make()).status).toBe(201); // 0.34: now over the $0.30 cap
    const waiting = await make();
    expect(waiting.status).toBe(409);
    expect(await waiting.json()).toMatchObject({ error: "over_cap", connect: "/account/keys#portraits", message: expect.stringContaining("Portraits wait until") });
    // $0.17 was under 80% of the $0.30 cap, so no heads-up; $0.34 went over it.
    expect((await notices(owner)).map((n) => n.kind)).toEqual(["key_capped"]);
  });
});

describe("setting a cap (PUT) and the card's meter", () => {
  const req = (body: unknown) =>
    new Request(BASE_URL + "/api/me/connections", { method: "PUT", headers: { "content-type": "application/json", cookie: signedInCookie(U) }, body: JSON.stringify(body) });

  it("stores the cap and what happens at it; a bad one is refused; 0 means no cap", async () => {
    vi.stubGlobal("fetch", async () => jsonRes({ data: { usage: 0, limit: null } }));
    expect((await putConnection(req({ job: "text", provider: "openrouter", key: fakeKey("cap"), cap_usd: 10, on_cap: "pause" }))).status).toBe(200);
    expect((await jobUsability(t.db, U, "text"))).toMatchObject({ state: "ok", cap: { cap_usd: 10, on_cap: "pause" } });
    expect((await putConnection(req({ job: "text", provider: "openrouter", cap_usd: 5000 }))).status).toBe(422);
    expect((await putConnection(req({ job: "text", provider: "openrouter", cap_usd: -1 }))).status).toBe(422);
    expect((await putConnection(req({ job: "text", provider: "openrouter", on_cap: "panic" }))).status).toBe(422);
    expect((await putConnection(req({ job: "text", provider: "openrouter", cap_usd: 0 }))).status).toBe(200);
    expect((await jobUsability(t.db, U, "text"))).toMatchObject({ state: "ok", cap: { cap_usd: null, on_cap: "fallback" } });
  });

  it("the card: spend against the cap, amber at 80%, and at the cap what happens until the 1st", async () => {
    await openRouterKey(10, "fallback");
    const card = async () => jobCards(await listConnections(t.db, U), NOW, await currentUsage(t.db, U, NOW))[0];
    await recordUsage(t.db, U, "text", { usd: 1.2, how: "reported", input: 0, output: 0 }, NOW);
    expect(await card()).toMatchObject({ state: "connected", pill: "✓ Connected", usage: { spent: 1.2, cap: 10, level: "ok", line: "$1.20 of $10 this month" } });
    expect((await card()).meta).toContain("$1.20 of $10 this month");
    await recordUsage(t.db, U, "text", { usd: 6.9, how: "estimated", input: 0, output: 0 }, NOW);
    expect(await card()).toMatchObject({ state: "connected", pill: "80% of cap", usage: { level: "warn", estimated: true } });
    expect((await card()).meta).toContain("$8.10 of $10 this month (estimated)");
    await recordUsage(t.db, U, "text", { usd: 2, how: "reported", input: 0, output: 0 }, NOW);
    expect(await card()).toMatchObject({ state: "over_cap", pill: "Cap reached", status: "Cap reached: Botchelor's free model stands in until Nov 1" });
    await assignJob(t.db, U, "text", "openrouter", null, {}, { cap_usd: 10, on_cap: "pause" });
    expect((await card()).status).toBe("Cap reached: your dates wait until Nov 1");
  });
});
