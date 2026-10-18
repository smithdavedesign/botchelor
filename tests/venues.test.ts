import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedFrom } from "@/lib/engine";
import { checkFields } from "@/lib/safety";
import { venueForPlan } from "@/lib/relationships";
import { assembleDate, DEFAULT_DATE_REQUEST } from "@/lib/simulation";
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
  it("offers a big library of reusable locations with distinct ids and names (33 since 2026-10-18)", () => {
    expect(DATE_VENUES.length).toBeGreaterThanOrEqual(33);
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

describe("the 2026-10-18 venues: the extreme ones, and twenty with their own small trouble", () => {
  const ids = new Set<string>(VENUE_IDS);

  it("has the five David asked for, and keeps the original eight first (their order never changes old deals' backdrops)", () => {
    for (const id of ["skydive", "surf_lesson", "dive_bar", "nightclub", "safari"]) expect(ids.has(id)).toBe(true);
    expect(VENUE_IDS.slice(0, 8)).toEqual(["rooftop_bar", "corner_cafe", "retro_arcade", "botanic_park", "tasting_menu", "night_beach", "double_date", "karaoke_booth"]);
  });

  it("never mentions anyone under 18, and keeps people out of every backdrop plate", () => {
    for (const v of DATE_VENUES) {
      expect(`${v.name} ${v.prompt} ${v.plate}`, v.id).not.toMatch(/\b(child|children|kid|kids|teen\w*|school|student|baby)\b/i);
      expect(v.plate, v.id).not.toMatch(/\b(couple|waiter|instructor|guide|host|pilot|chef|dj|actor|crowd|people|person|man|woman|teacher|retiree)\b/i);
    }
  });

  it("a plan made in their texts finds its new venue, and the old ones still find theirs", () => {
    const cases: [string, string][] = [
      ["Let's go skydiving next weekend, I dare you", "skydive"],
      ["Surfing lesson Saturday? I'll bring a spare wetsuit", "surf_lesson"],
      ["Pub quiz Thursday, our team needs a name", "dive_bar"],
      ["Dancing at that nightclub with the terrible DJ", "nightclub"],
      ["A safari, so we can finally see a giraffe", "safari"],
      ["An escape room. We'll lose, but beautifully.", "escape_room"],
      ["Bowling, loser buys the chips", "bowling_alley"],
      ["Ice skating — I'll hold the barrier, you hold me", "ice_rink"],
      ["Goat yoga on Sunday", "goat_yoga"],
      ["A ghost tour of the old manor", "haunted_house"],
      ["The museum's late opening, under the dinosaur", "museum_night"],
      ["Paintball with your cousins", "paintball"],
      ["Comedy open mic, front row, no fear", "comedy_club"],
      ["Coffee works. Bring the anthology story.", "corner_cafe"],
      ["Next time: karaoke, and I'm choosing the duet.", "karaoke_booth"],
      ["Let's do the botanic park on Thursday instead.", "botanic_park"],
    ];
    for (const [text, venueId] of cases) expect(venueForPlan([{ text }]), text).toBe(venueId);
  });

  it("a booked date's venue holds through a rebuild, whatever the dealer would deal now", () => {
    const sheet = { name: "Mira", age: 27, bio: "a cartographer", traits: ["curious", "warm", "dry"], want: "a map reader", dealbreaker: "liars", house: false };
    const parts = {
      episodeId: "ep-venue", a: { id: "mira", sheet }, b: { id: "rafe", sheet: { ...sheet, name: "Rafe", house: true } }, req: DEFAULT_DATE_REQUEST,
      seed: 12345, soulA: null, soulB: null, memoryA: null, memoryB: null, history: undefined,
    };
    const dealt = assembleDate(parts).setup.venue;
    const other = VENUE_IDS.find((v) => v !== dealt)!;
    expect(assembleDate({ ...parts, venueOverride: other }).setup.venue).toBe(other);
  });
});
