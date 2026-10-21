import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getSecondDate, POST as postSecondDate } from "@/app/api/episodes/[id]/second-date/route";
import { setAfterglowEnabledForTests } from "@/lib/afterglow";
import type { SideOutcome } from "@/lib/engine";
import { loadRelationship } from "@/lib/relationships";
import {
  api,
  BASE_URL,
  episodeJson,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  scriptOutcome,
  setupPairedEpisode,
  startTestDb,
  userIdOf,
  validCharacter,
} from "./helpers";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const text = (t: string) => JSON.stringify({ text: t });
/** The model calls one date makes in the test harness (conversation off): the recap, then four afterglow texts. */
const scriptDate = (afterglow: string[] = ["Fun night.", "It was.", "Again?", "Yes."]) => scriptedModel([episodeJson(), ...afterglow.map(text)]);
const COFFEE = ["Morning. Still thinking about the sugar packets.", "Coffee works. Bring the anthology story and I'll bring dried apricots.", "You're on.", "Tuesday then."];

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const check = async (id: string, cookie: string) => {
  const res = await getSecondDate(new Request(`${BASE_URL}/api/episodes/${id}/second-date`, { headers: { cookie } }), params(id));
  return { status: res.status, body: (await res.json()) as Any };
};
const plan = async (id: string, cookie: string, body: Any = {}) => {
  const res = await postSecondDate(
    new Request(`${BASE_URL}/api/episodes/${id}/second-date`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }),
    params(id),
  );
  return { status: res.status, body: (await res.json()) as Any };
};

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  setAfterglowEnabledForTests(true); // the plan comes from the morning-after texts
});
afterAll(async () => {
  setAfterglowEnabledForTests(false);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

/** A house date where both characters want more, with the coffee plan in their texts. */
async function mutualHouseDate() {
  const creator = newUserCookie();
  const character = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), creator)).json();
  scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
  scriptDate(COFFEE);
  const first = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
  return { creator, character, first };
}

describe("a second date — only when they both want one", () => {
  it("a mutual house date: one click books it where they planned it, with the plan in it; once", async () => {
    const { creator, character, first } = await mutualHouseDate();
    const before = await check(first.id, creator);
    expect(before.body).toMatchObject({ mutual: true, can_plan: true, needs_their_yes: false, my_character_id: character.id, partner_character_id: HOUSE_PARTNER_ID });
    expect(before.body.plan.join(" ")).toMatch(/Coffee works/);

    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptDate();
    const booked = await plan(first.id, creator);
    expect(booked.status).toBe(200);
    const second = (await t.db.query<Any>(`select followup_of, setup, character_a, character_b from episodes where id = $1`, [booked.body.id])).rows[0];
    expect(second.followup_of).toBe(first.id);
    expect(second.setup.venue).toBe("corner_cafe"); // "coffee" in their plan
    expect(second.setup.plan.join(" ")).toMatch(/dried apricots/);
    expect([second.character_a, second.character_b]).toEqual([character.id, HOUSE_PARTNER_ID]);

    // The pair's edge now has both dates, the second marked as the second date of the first.
    const rel = (await loadRelationship(t.db, character.id, HOUSE_PARTNER_ID))!;
    expect(rel.all.dates).toBe(2);
    expect(rel.history[1].followup_of).toBe(first.id);

    // One second date per date.
    expect((await check(first.id, creator)).body).toMatchObject({ can_plan: false, reason: "planned", planned_episode_id: booked.body.id });
    expect((await plan(first.id, creator)).status).toBe(409);
  });

  it("not when only one of them wanted it; never for someone who owns neither character", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending: "friends", sides: [side(true), side(false)] });
    scriptDate();
    const first = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    expect((await check(first.id, creator)).body).toMatchObject({ mutual: false, can_plan: false, reason: "not_mutual" });
    const refused = await plan(first.id, creator);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("not_mutual");

    const stranger = newUserCookie();
    expect((await check(first.id, stranger)).status).toBe(403);
    expect((await plan(first.id, stranger)).status).toBe(403);
  });

  it("the episodes route itself refuses a second date that skips the rules", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending: "friends", sides: [side(false), side(true)] });
    scriptDate();
    const first = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    const res = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID, second_date_of: first.id }, creator);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_mutual");
  });

  it("another player's character that isn't open to dates: both creators say yes, and the second yes books it", async () => {
    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptDate();
    // setupPairedEpisode scripts its own outcome and model; re-script after for the afterglow.
    const { host, partner, hostCharacter, partnerCharacter, episode } = await (async () => {
      const r = await setupPairedEpisodeMutual();
      return r;
    })();

    const asked = await plan(episode.id, host);
    expect(asked.status).toBe(202);
    expect(asked.body.status).toBe("waiting");
    expect((await check(episode.id, host)).body).toMatchObject({ needs_their_yes: true, you_asked: true, they_asked: false });

    // Going around the button doesn't work either: their creator hasn't said yes.
    const sneak = await api.createEpisode({ character_id: hostCharacter.id, partner_id: partnerCharacter.id, second_date_of: episode.id }, host);
    expect(sneak.status).toBe(409);
    expect((await sneak.json()).error).toBe("needs_their_yes");

    expect((await check(episode.id, partner)).body).toMatchObject({ they_asked: true, my_character_id: partnerCharacter.id });
    scriptOutcome({ ending: "friends", sides: [side(true), side(false)] });
    scriptDate();
    const booked = await plan(episode.id, partner);
    expect(booked.status).toBe(200);
    const second = (await t.db.query<Any>(`select creator_id, character_a, followup_of from episodes where id = $1`, [booked.body.id])).rows[0];
    expect(second.followup_of).toBe(episode.id);
    expect(second.character_a).toBe(partnerCharacter.id); // the creator who completed it booked it
    // MCP 2.4.3: the other creator's notice says who started it and who performs it (the show's model, both sides).
    const notice = (await t.db.query<Any>(`select body from notifications where user_id = $1 and kind = 'second_date_booked'`, [userIdOf(host)])).rows[0];
    expect(notice.body).toMatch(/^Started by Otto's side \(their owner booked it\)\. The show's model performs both sides, Otto and Mira: nothing for you to write\./);
  });

  it("a second date is never more public than the date it follows", async () => {
    const { creator, character, first } = await mutualHouseDate();
    await api.setVisibility(first.id, "private", creator);
    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptDate();
    const booked = await plan(first.id, creator, { visibility: "public" });
    expect(booked.status).toBe(200);
    const vis = (await t.db.query<Any>(`select visibility from episodes where id = $1`, [booked.body.id])).rows[0].visibility;
    expect(vis).toBe("private");
    expect(character.id).toBeTruthy();
  });
});

/** setupPairedEpisode, but with both characters wanting more and the afterglow scripted. */
async function setupPairedEpisodeMutual() {
  const host = newUserCookie();
  const partner = newUserCookie();
  const partnerCharacter = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), partner)).json();
  const hostCharacter = await (await api.createCharacter(validCharacter(), host)).json();
  scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
  scriptDate(COFFEE);
  const res = await api.createEpisode({ character_id: hostCharacter.id, blind: true }, host);
  if (res.status !== 200) throw new Error(`paired episode setup failed with ${res.status}`);
  const episode = await res.json();
  return { host, partner, hostCharacter, partnerCharacter, episode };
}
// Kept for parity with the helper this mirrors.
void setupPairedEpisode;

describe("a free second date each week (FREE_WEEKLY_SECOND_DATE)", () => {
  const usedFree = async (cookie: string) => {
    const uid = cookie.match(/bz_uid=([^;]+)/)?.[1] ?? "";
    return (await t.db.query<{ used: number }>(`select coalesce(sum(used), 0)::int as used from free_episode_usage where user_id = $1`, [uid])).rows[0].used;
  };
  const book = async (id: string, cookie: string) => {
    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptDate(COFFEE);
    return plan(id, cookie);
  };

  it("is off by default: a second date costs a date like any other", async () => {
    delete process.env.FREE_WEEKLY_SECOND_DATE;
    const { creator, first } = await mutualHouseDate();
    expect((await check(first.id, creator)).body.free).toBe(false);
    expect(await usedFree(creator)).toBe(1);
    expect((await book(first.id, creator)).status).toBe(200);
    expect(await usedFree(creator)).toBe(2);
  });

  it("when on, the first second date this week is free, and the next one costs a date", async () => {
    process.env.FREE_WEEKLY_SECOND_DATE = "1";
    try {
      const { creator, first } = await mutualHouseDate();
      expect((await check(first.id, creator)).body.free).toBe(true);
      const second = await book(first.id, creator);
      expect(second.status).toBe(200);
      expect(await usedFree(creator)).toBe(1); // only the first date was charged

      expect((await check(second.body.id, creator)).body.free).toBe(false);
      expect((await book(second.body.id, creator)).status).toBe(200);
      expect(await usedFree(creator)).toBe(2);
    } finally {
      delete process.env.FREE_WEEKLY_SECOND_DATE;
    }
  });
});
