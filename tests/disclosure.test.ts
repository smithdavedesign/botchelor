import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import EpisodeNotices, { CrisisResources } from "@/app/Notices";
import { getEpisodeView, listMyEpisodes } from "@/lib/game";
import { CRISIS_LINKS } from "@/lib/rules";
import {
  api,
  episodeJson,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  setupEpisode,
  setupPairedEpisode,
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
});

describe("ai_generated: true on every episode response (exit criterion)", () => {
  it("is on POST /api/episodes, GET /api/episodes/:id, every feed item, the air-finale result and the page data", async () => {
    const seen: unknown[] = [];

    // POST /api/episodes: a house date and a blind date.
    const { host, partner, episode: blind } = await setupPairedEpisode();
    seen.push(blind);
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter({ name: "Tamsin Rowe" }), creator)).json();
    scriptedModel([episodeJson()]);
    const house = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    seen.push(house);

    const viewers = [host, partner, creator, newUserCookie(), undefined];
    const collect = async () => {
      for (const id of [blind.id, house.id]) {
        for (const viewer of viewers) {
          const res = await api.getEpisode(id, viewer);
          expect(res.status).toBe(200);
          seen.push(await res.json());
          seen.push(await getEpisodeView(t.db, id, viewer ? userIdOf(viewer) : null));
        }
      }
      for (const viewer of viewers) {
        const items = (await (await api.feed(viewer)).json()).episodes as unknown[];
        expect(items).toHaveLength(2);
        seen.push(...items);
      }
      seen.push(...(await listMyEpisodes(t.db, userIdOf(host))));
    };

    await collect(); // before the finale airs
    for (const [id, cookie] of [
      [blind.id, host],
      [house.id, creator],
    ] as const) {
      const aired = await api.reveal(id, cookie);
      expect(aired.status).toBe(200);
      seen.push(await aired.json());
    }
    await collect(); // after

    expect(seen.length).toBeGreaterThan(40);
    for (const body of seen) expect(body).toMatchObject({ ai_generated: true });
  });
});

describe("AI disclosure and crisis link on every episode", () => {
  it("EpisodeNotices discloses that the episode is AI-written and links crisis resources", () => {
    const html = renderToStaticMarkup(createElement(EpisodeNotices));
    expect(html).toMatch(/written by an AI model/i);
    expect(html).toMatch(/fictional adults/i);
    expect(CRISIS_LINKS.length).toBeGreaterThanOrEqual(2);
    for (const link of CRISIS_LINKS) {
      expect(link.href).toMatch(/^https:\/\//);
      expect(html).toContain(`href="${link.href}"`);
    }
    expect(html).toContain("https://988lifeline.org");
    expect(html).toContain("https://findahelpline.com");
    expect(html).toMatch(/rel="noopener noreferrer"/);
  });

  it("CrisisResources renders the same links on their own (used in the site footer)", () => {
    const html = renderToStaticMarkup(createElement(CrisisResources));
    for (const link of CRISIS_LINKS) expect(html).toContain(`href="${link.href}"`);
  });

  it("the episode page renders EpisodeNotices for every viewer, and the layout footer renders the crisis link", () => {
    const page = readFileSync(new URL("../app/episodes/[id]/page.tsx", import.meta.url), "utf8");
    expect(page).toMatch(/import EpisodeNotices[^;]*from "@\/app\/Notices"/);
    expect(page).toContain("<EpisodeNotices />");
    const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain("<CrisisResources />");
  });
});

describe("episode visibility stays as in M1, plus the drama question", () => {
  it("shows spectators the drama question but not its answer until the finale airs", async () => {
    const { creator, episode } = await setupEpisode("friends", { drama_question: "rejected", drama_answer: "a" });
    expect(episode).toMatchObject({ drama_question: "rejected", drama_answer: "a" });
    const before = await (await api.getEpisode(episode.id, newUserCookie())).json();
    expect(before.drama_question).toBe("rejected");
    expect(before).not.toHaveProperty("drama_answer");
    await api.reveal(episode.id, creator);
    const after = await (await api.getEpisode(episode.id, newUserCookie())).json();
    expect(after).toMatchObject({ drama_question: "rejected", drama_answer: "a" });
  });

  it("returns 404 for an unknown episode", async () => {
    const res = await api.getEpisode("missing", newUserCookie());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("episode_not_found");
  });
});
