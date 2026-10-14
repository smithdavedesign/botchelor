import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedFrom } from "@/lib/engine";
import { checkFields } from "@/lib/safety";
import { DATE_VENUES, pickVenue, venue, venueBackdropCss, venueName, VENUE_IDS } from "@/lib/venues";
import {
  api,
  episodeJson,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  startTestDb,
  validCharacter,
} from "./helpers";

describe("the date venue library", () => {
  it("offers 6-10 reusable locations with distinct ids and names", () => {
    expect(DATE_VENUES.length).toBeGreaterThanOrEqual(6);
    expect(DATE_VENUES.length).toBeLessThanOrEqual(10);
    expect(new Set(DATE_VENUES.map((v) => v.id)).size).toBe(DATE_VENUES.length);
    expect(new Set(DATE_VENUES.map((v) => v.name)).size).toBe(DATE_VENUES.length);
  });

  it("gives every venue a name, a stage direction and a backdrop", () => {
    for (const v of DATE_VENUES) {
      expect(v.name.trim().length).toBeGreaterThan(0);
      expect(v.prompt.trim().length).toBeGreaterThan(0);
      for (const hue of v.hues) {
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThanOrEqual(360);
      }
    }
  });

  // The venue text is written into the model's prompt and shown to the audience, so it goes through
  // the same filter as everything else that reaches a page.
  it("passes the content filter", () => {
    for (const v of DATE_VENUES) {
      expect(checkFields({ name: v.name, prompt: v.prompt, plate: v.plate })).toEqual({ ok: true });
    }
  });

  it("deals a venue deterministically and can reach every one of them", () => {
    expect(pickVenue(7)).toBe(pickVenue(7));
    const dealt = new Set(Array.from({ length: 200 }, (_, i) => pickVenue(seedFrom(`episode-${i}`, 11))));
    expect([...dealt].sort()).toEqual([...VENUE_IDS].sort());
  });

  it("falls back for an episode stored before the library existed", () => {
    expect(venue(null)).toEqual(DATE_VENUES[0]);
    expect(venue(undefined)).toEqual(DATE_VENUES[0]);
    expect(venueName(null)).toBe(DATE_VENUES[0].name);
  });

  it("paints a backdrop from both of a venue's hues", () => {
    const css = venueBackdropCss("retro_arcade");
    const [from, to] = venue("retro_arcade").hues;
    expect(css).toContain(`${from} `);
    expect(css).toContain(`${to} `);
  });
});

describe("a date happens at a venue", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  let creator: string;
  let characterId: string;

  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    creator = newUserCookie();
    characterId = (await (await api.createCharacter(validCharacter(), creator)).json()).id;
  });

  it("deals one from the library, stores it on the episode and shows it to spectators", async () => {
    scriptedModel([episodeJson()]);
    const episode = await (await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    expect(VENUE_IDS).toContain(episode.venue);

    const { rows } = await t.db.query<{ setup: { venue?: string } }>("select setup from episodes where id = $1", [episode.id]);
    expect(rows[0].setup.venue).toBe(episode.venue);

    // A spectator who has not seen the finale still learns where the date is: it is the teaser, not a secret.
    const teaser = await (await api.getEpisode(episode.id, newUserCookie())).json();
    expect(teaser.venue).toBe(episode.venue);
    expect(teaser).not.toHaveProperty("finale");
  });

  it("tells the showrunner where to set the date", async () => {
    const { calls } = scriptedModel([episodeJson()]);
    const episode = await (await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    const prompt = calls[0].map((m) => m.content).join("\n");
    expect(prompt).toContain(venue(episode.venue).prompt);
    expect(prompt).toContain("date_location");
  });

  it("does not send every date to the same place", async () => {
    const dealt = new Set<string>();
    for (let i = 0; i < 6; i++) {
      scriptedModel([episodeJson()]);
      const episode = await (await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, creator)).json();
      dealt.add(episode.venue);
      await t.db.query("delete from free_episode_usage");
    }
    // Six dates, each with its own id: they should not all land in the same place.
    expect(dealt.size).toBeGreaterThan(1);
  });
});
