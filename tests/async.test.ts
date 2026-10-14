import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as runJobsCron } from "@/app/api/jobs/run/route";
import { runGenerationJob, setInlineGenerationForTests } from "@/lib/jobs";
import {
  api,
  BASE_URL,
  episodeJson,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  scriptOutcome,
  startTestDb,
  userIdOf,
  validCharacter,
} from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  // These tests exercise the real async path, so turn OFF the inline generation the harness defaults to.
  setInlineGenerationForTests(false);
});
afterEach(() => {
  setInlineGenerationForTests(true);
  vi.unstubAllEnvs();
});

async function newDate(ending: "second_date" | "friends" | "disaster" = "friends", outputs = [episodeJson()]) {
  const creator = newUserCookie();
  const char = await (await api.createCharacter(validCharacter(), creator)).json();
  scriptOutcome({ ending });
  scriptedModel(outputs);
  const res = await api.createEpisode({ character_id: char.id, partner_id: HOUSE_PARTNER_ID }, creator);
  return { creator, char, res, ep: await res.json() };
}

const feedIds = async (cookie?: string) =>
  ((await (await api.feed(cookie)).json()).episodes as { id: string }[]).map((e) => e.id);

describe("M10 part 2: async episode generation", () => {
  it("creates a 'generating' episode, hides it from the feed, then the worker makes it ready", async () => {
    const { creator, ep } = await newDate("friends");
    expect(ep.status).toBe("generating");
    expect(ep.scenes ?? []).toHaveLength(0); // no narration yet
    expect(await feedIds()).not.toContain(ep.id); // hidden while generating

    await runGenerationJob(t.db, ep.id);

    const ready = await (await api.getEpisode(ep.id, creator)).json();
    expect(ready.status).toBe("ready");
    expect(ready.scenes).toHaveLength(3);
    expect(await feedIds(creator)).toContain(ep.id); // shown once ready
  });

  it("deletes the episode and refunds the date when generation fails terminally", async () => {
    const { creator, ep } = await newDate("friends", ["bad json", "still bad"]); // narration fails both attempts
    expect(ep.status).toBe("generating");
    expect(await t.count("episodes")).toBe(1);
    expect(await t.count("free_episode_usage", `user_id = '${userIdOf(creator)}' and used = 1`)).toBe(1);

    await runGenerationJob(t.db, ep.id);

    expect(await t.count("episodes")).toBe(0); // nothing stored
    expect(await t.count("generation_jobs")).toBe(0); // cascaded
    expect(await t.count("free_episode_usage", `user_id = '${userIdOf(creator)}' and used = 1`)).toBe(0); // refunded
  });

  it("the jobs cron route is gated (404) and, when authorized, runs the queued job to ready", async () => {
    const { creator, ep } = await newDate("second_date");
    expect(ep.status).toBe("generating");

    // No token → 404 (not a public surface).
    expect((await runJobsCron(new Request(`${BASE_URL}/api/jobs/run`))).status).toBe(404);

    vi.stubEnv("WATCH_ADMIN_TOKEN", "test-jobs-token");
    const ok = await runJobsCron(new Request(`${BASE_URL}/api/jobs/run`, { headers: { "x-jobs-token": "test-jobs-token" } }));
    expect(ok.status).toBe(200);

    const ready = await (await api.getEpisode(ep.id, creator)).json();
    expect(ready.status).toBe("ready");
  });
});
