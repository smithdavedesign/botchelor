import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRating, ratingFromLabels, setModerationFetchForTests, VENICE_CHAT } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { checkPgPictureText } from "@/lib/safety";
import { startTestDb } from "./helpers";

// The PG Studio's strict checks (plan PR 2; David, 2026-10-25): one vision call for clothing and age, never Hive, and a
// stricter word check for an owner's words. Venice is stubbed: no live calls.

describe("the labels' mapping", () => {
  it("keeps clothed as pg, swimwear pg only at a beach or pool, revealing as suggestive; refuses nudity, sex and anyone not clearly adult", () => {
    expect(ratingFromLabels("CLOTHED", "ADULTS")).toMatchObject({ ok: true, rating: "pg" });
    expect(ratingFromLabels("SWIMWEAR", "ADULTS", { beach: true })).toMatchObject({ ok: true, rating: "pg" });
    expect(ratingFromLabels("SWIMWEAR", "ADULTS")).toMatchObject({ ok: true, rating: "suggestive" });
    expect(ratingFromLabels("REVEALING", "ADULTS", { beach: true })).toMatchObject({ ok: true, rating: "suggestive" });
    expect(ratingFromLabels("NUDITY", "ADULTS")).toMatchObject({ ok: false, checked: true });
    expect(ratingFromLabels("SEXUAL", "ADULTS")).toMatchObject({ ok: false, checked: true });
    expect(ratingFromLabels("CLOTHED", "MINOR")).toMatchObject({ ok: false, checked: true });
    expect(ratingFromLabels("CLOTHED", "UNSURE")).toMatchObject({ ok: false, checked: true });
    expect(ratingFromLabels("", "ADULTS")).toMatchObject({ ok: false, checked: false });
    expect(ratingFromLabels("clothed", "adults")).toMatchObject({ ok: true, rating: "pg" });
  });
});

describe("the owner's words", () => {
  it("pass everyday picture words and refuse sex, minors, real people, look-alikes and underwear", () => {
    for (const ok of ["reading in a café, golden hour", "hiking with a dog, rain jacket", "in a red bikini on the beach", "a spicy ramen bowl", "a butterfly tattoo"]) {
      expect(checkPgPictureText({ custom: ok }).ok, ok).toBe(true);
    }
    for (const [bad, reason] of [
      ["in black lace lingerie", "sexual"],
      ["topless on a yacht", "sexual"],
      ["a see-through dress", "sexual"],
      ["sultry pose on the sofa", "sexual"],
      ["looks like Taylor Swift at a concert", "real_person"],
      ["dressed as Keanu Reeves", "real_person"],
      ["looks like Rafe Calloway the pastry chef", "real_person"],
      ["a teenage look", "minor"],
      ["nude in the garden", "sexual"],
    ] as const) {
      expect(checkPgPictureText({ custom: bad }), bad).toMatchObject({ ok: false, reason });
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
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
});
afterEach(() => {
  vi.unstubAllEnvs();
  setModerationFetchForTests(null);
});

const PIC = { base64: Buffer.from([137, 80, 78, 71]).toString("base64"), mime: "image/png" };
const replying = (body: unknown, status = 200) => {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  setModerationFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return status === 200 ? Response.json(body) : new Response("no", { status });
  });
  return sent;
};
const says = (clothing: string, age = "ADULTS") => ({ choices: [{ message: { role: "assistant", content: JSON.stringify({ clothing, age }) } }] });

describe("checkRating", () => {
  it("asks Venice's vision model both questions, held to a schema, and maps the answer", async () => {
    await saveAdultSettings(t.db, { venice_key: "placeholder-venice" });
    const sent = replying(says("SWIMWEAR"));
    expect(await checkRating(t.db, PIC, { beach: true })).toMatchObject({ ok: true, rating: "pg", via: "venice_vlm" });
    expect(sent[0].url).toBe(VENICE_CHAT);
    expect(JSON.stringify(sent[0].body.response_format)).toContain("CLOTHED");
    replying(says("NUDITY"));
    expect(await checkRating(t.db, PIC)).toMatchObject({ ok: false, checked: true });
  });

  it("fails closed: no key, an error status, or an answer it can't read", async () => {
    expect(await checkRating(t.db, PIC)).toMatchObject({ ok: false, checked: false });
    await saveAdultSettings(t.db, { venice_key: "placeholder-venice" });
    replying({}, 500);
    expect(await checkRating(t.db, PIC)).toMatchObject({ ok: false, checked: false });
    replying({ choices: [{ message: { content: "sure, looks fine" } }] });
    expect(await checkRating(t.db, PIC)).toMatchObject({ ok: false, checked: false });
  });
});
