import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EPISODE_TITLE_MAX, episodeCode, templateEpisodeTitle, titleEpisodeOnAir, writeEpisodeTitle } from "@/lib/episode-title";
import { previouslyOn } from "@/lib/previously-on";
import { getEpisodeView } from "@/lib/game";
import type { Model } from "@/lib/model";
import { api, episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, setupEpisode, startTestDb } from "./helpers";

const model = (outputs: Array<string | Error>): Model => {
  const queue = [...outputs];
  return {
    async complete() {
      const next = queue.shift();
      if (next === undefined) throw new Error("out of outputs");
      if (next instanceof Error) throw next;
      return next;
    },
  };
};

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

describe("the template title ($0, stands in wherever no title was written)", () => {
  it("names the night at its venue", () => {
    expect(templateEpisodeTitle({ venue: "dive_bar", dateNumber: null })).toBe("First date at a sticky dive bar on trivia night");
    expect(templateEpisodeTitle({ venue: "rooftop_bar", dateNumber: 3 })).toBe("Third date at a rooftop bar at golden hour");
  });
  it("still reads without a venue, and never runs long", () => {
    expect(templateEpisodeTitle({ venue: null, dateNumber: null })).toBe("The first date");
    expect(templateEpisodeTitle({ venue: "hot_air_balloon", dateNumber: 11 }).length).toBeLessThanOrEqual(EPISODE_TITLE_MAX);
  });
});

describe("the episode code (S1 · Night 18)", () => {
  it("comes from the night it aired", () => {
    expect(episodeCode("2026-10-20T21:30:00Z")).toBe("S1 · Night 20");
    expect(episodeCode("2026-11-02T03:00:00Z")).toBe("S2 · Night 2");
  });
  it("is null before it airs, and before the monthly seasons began", () => {
    expect(episodeCode(null)).toBeNull();
    expect(episodeCode(undefined)).toBeNull();
    expect(episodeCode("2026-09-01T00:00:00Z")).toBeNull();
    expect(episodeCode("not a date")).toBeNull();
  });
});

describe("the title writer", () => {
  const facts = { names: ["Mira", "Rafe"] as [string, string], setting: "A rooftop bar at golden hour.", venue: "rooftop_bar", dateNumber: null };
  it("takes a clean 3–6 word title, unquoted and trimmed", async () => {
    expect(await writeEpisodeTitle(model(['{"title":"  “The Fountain  Incident” "}']), facts)).toBe("The Fountain Incident");
  });
  it("rejects a verdict, a runaway length, junk and a dead call", async () => {
    expect(await writeEpisodeTitle(model(['{"title":"The Long Goodbye"}']), facts)).toBeNull(); // reads as an outcome
    expect(await writeEpisodeTitle(model([`{"title":"${"Very ".repeat(12)}Long"}`]), facts)).toBeNull();
    expect(await writeEpisodeTitle(model(['{"title":""}']), facts)).toBeNull();
    expect(await writeEpisodeTitle(model(["not json"]), facts)).toBeNull();
    expect(await writeEpisodeTitle(model([new Error("down")]), facts)).toBeNull();
  });
});

describe("titling at air time", () => {
  it("stores the model's title once, and never retitles", async () => {
    const { creator, episode } = await setupEpisode("friends");
    await api.reveal(episode.id, creator);
    expect(await titleEpisodeOnAir(t.db, episode.id, { model: model(['{"title":"The Quiz Pro Quo Affair"}']) })).toBe("The Quiz Pro Quo Affair");
    const view = await getEpisodeView(t.db, episode.id, null);
    expect(view?.title).toBe("The Quiz Pro Quo Affair");
    expect(view?.aired_at).toBeTruthy();
    // A second air (a replayed job, a race) finds the title already there and leaves it alone.
    expect(await titleEpisodeOnAir(t.db, episode.id, { model: model(['{"title":"Another Title"}']) })).toBeNull();
    expect((await getEpisodeView(t.db, episode.id, null))?.title).toBe("The Quiz Pro Quo Affair");
  });

  it("falls back to the template when the model fails, and stays inert without a model under the harness", async () => {
    const { creator, episode } = await setupEpisode("friends");
    await api.reveal(episode.id, creator);
    // The harness turns the voice off, so the air hook's own call wrote nothing.
    expect((await getEpisodeView(t.db, episode.id, null))?.title).toBeUndefined();
    expect(await titleEpisodeOnAir(t.db, episode.id)).toBeNull();
    const stored = await titleEpisodeOnAir(t.db, episode.id, { model: model([new Error("down")]) });
    // The template from the episode's own venue: "First date at …", or the venue alone when that's too long for a title
    // card (the dealt venue varies run to run, so asserting "First date" alone failed about one run in three).
    const venue = (await t.db.query<{ venue: string | null }>(`select setup->>'venue' as venue from episodes where id = $1`, [episode.id])).rows[0].venue;
    expect(stored).toBe(templateEpisodeTitle({ venue, dateNumber: null }));
    expect(stored!.length).toBeLessThanOrEqual(EPISODE_TITLE_MAX);
  });

  it("an unaired episode never shows a title or an aired_at", async () => {
    const { creator, episode } = await setupEpisode("friends");
    const view = await getEpisodeView(t.db, episode.id, creator.split("=")[1]);
    expect(view?.title).toBeUndefined();
    expect(view?.aired_at).toBeUndefined();
  });
});

describe("the cold open (previously on)", () => {
  it("tells the pair's last aired date in one line, and is null for a first date", async () => {
    const { creator, character, episode } = await setupEpisode("friends");
    expect(await previouslyOn(t.db, episode.id)).toBeNull();
    await api.reveal(episode.id, creator);
    // The same pair dates again: the first date is now its history.
    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator);
    expect(res.status).toBe(200);
    const second = await res.json();
    const prev = await previouslyOn(t.db, second.id);
    expect(prev?.episode_id).toBe(episode.id);
    expect(prev?.line).toMatch(/^Their first date .*ended in just friends\.$/);
  });
});
