// The 2026-11-14 builder feedback (an email after a Reddit thread): a stalled date, a blind date that drew the partner
// already on a date, a name refused only at Create, the minute the hero promised, and the first date's card vanishing.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST as postNotifyReady } from "@/app/api/episodes/[id]/notify-ready/route";
import { describeError, watchLinkOf } from "@/app/request";
import { filmedLabel } from "@/app/episodes/[id]/GeneratingPoller";
import { NAME_MAX_WORDS, nameWords } from "@/lib/field-limits";
import { renewLease, runGenerationJob, setInlineGenerationForTests } from "@/lib/jobs";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, jsonRequest, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

describe("pure helpers", () => {
  it("counts a name's words the way the save does", () => {
    expect(NAME_MAX_WORDS).toBe(5);
    expect(nameWords("  Zoë  ")).toBe(1);
    expect(nameWords("")).toBe(0);
    expect(nameWords('Zoë "Café" Marlowe 🚀')).toBe(4);
    expect(nameWords("Lady Seraphine of the Ninth Moon")).toBe(6);
  });

  it("says how far the filming got, approximately", () => {
    expect(filmedLabel(3, 12)).toBe("3 of about 12 lines filmed");
    expect(filmedLabel(1, null)).toBe("1 line filmed");
    // A move adds lines: past the usual length it's just the count.
    expect(filmedLabel(14, 12)).toBe("14 lines filmed");
  });

  it("turns the agents' date_in_progress refusal into words for a person, with a link to the date", () => {
    const body = {
      error: "date_in_progress",
      episode_id: "ep-1",
      watch_path: "/episodes/ep-1?play=1",
      character_name: "Zoë",
      partner_name: "Barnaby",
      message: "Zoë and Barnaby already have a date booked that the show's model is still writing (ep-1). … get_episode … plan_second_date …",
    };
    const text = describeError(body);
    expect(text).toContain("Zoë is still on a date with Barnaby");
    expect(text).not.toMatch(/get_episode|plan_second_date|ep-1/);
    expect(watchLinkOf(body)).toEqual({ href: "/episodes/ep-1?play=1", label: "Watch it" });
    expect(watchLinkOf({ error: "taken", watch_path: "/episodes/x" })).toBeUndefined();
    expect(watchLinkOf({ error: "date_in_progress", watch_path: "https://evil.example/" })).toBeUndefined();
  });
});

describe("with the database", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    setInlineGenerationForTests(false); // the real async path: dates stay 'generating' until the job runs
  });
  afterEach(() => {
    setInlineGenerationForTests(true);
  });

  async function newDate(partner = HOUSE_PARTNER_ID) {
    const creator = newUserCookie();
    const char = await (await api.createCharacter(validCharacter(), creator)).json();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = await (await api.createEpisode({ character_id: char.id, partner_id: partner }, creator)).json();
    return { creator, char, ep };
  }

  const notifyReady = (id: string, cookie: string) => postNotifyReady(jsonRequest(`/api/episodes/${id}/notify-ready`, {}, { cookie }), { params: Promise.resolve({ id }) });
  const filmedNotices = async (userId: string) =>
    (await t.db.query<{ title: string; link: string }>(`select title, link from notifications where user_id = $1 and kind = 'date_filmed'`, [userId])).rows;

  it("a second booking for a pair still filming is refused with the date's link and both names", async () => {
    const { creator, char, ep } = await newDate();
    expect(ep.status).toBe("generating");
    const res = await api.createEpisode({ character_id: char.id, partner_id: HOUSE_PARTNER_ID }, creator);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("date_in_progress");
    expect(body.watch_path).toBe(`/episodes/${ep.id}?play=1`);
    expect(body.character_name).toBeTruthy();
    expect(body.partner_name).toBeTruthy();
    // Agents still get their own instructions.
    expect(body.message).toContain("get_episode");
  });

  it("a blind date never draws the partner they're already on a date with", async () => {
    // The cast is just the partner they're filming with: before, the blind date drew them again and was refused with the
    // agents' date_in_progress words; now there's nobody else, and it says so plainly.
    setSeasonCastForTests([HOUSE_PARTNER_ID]);
    try {
      const { creator, char, ep } = await newDate();
      expect(ep.status).toBe("generating");
      const res = await api.createEpisode({ character_id: char.id, blind: true }, creator);
      const body = await res.json();
      expect(body.error).toBe("partner_not_available");
      expect(res.status).toBe(422);
    } finally {
      setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id)); // the harness's own cast (tests/helpers.ts)
    }
  });

  it("notifies the creator when it's filmed only if they asked", async () => {
    const asked = await newDate();
    const res = await notifyReady(asked.ep.id, asked.creator);
    expect(res.status).toBe(200);
    await runGenerationJob(t.db, asked.ep.id);
    const notices = await filmedNotices(userIdOf(asked.creator));
    expect(notices).toHaveLength(1);
    expect(notices[0].link).toBe(`/episodes/${asked.ep.id}?play=1`);

    const quiet = await newDate();
    await runGenerationJob(t.db, quiet.ep.id);
    expect(await filmedNotices(userIdOf(quiet.creator))).toHaveLength(0);
  });

  it("only the creator can ask to hear about a date", async () => {
    const { ep } = await newDate();
    const res = await notifyReady(ep.id, newUserCookie());
    expect(res.status).toBe(404);
  });

  it("each line renews only the current attempt's lease", async () => {
    const { ep } = await newDate();
    await t.db.query(`update generation_jobs set status = 'running', attempts = 2, leased_until = now() + interval '330 seconds' where episode_id = $1`, [ep.id]);
    const lease = async () => new Date((await t.db.query<{ leased_until: string }>(`select leased_until from generation_jobs where episode_id = $1`, [ep.id])).rows[0].leased_until).getTime();
    const before = await lease();
    // A dead first attempt's late write leaves the second's lease alone.
    await renewLease(t.db, ep.id, 1, 150);
    expect(await lease()).toBe(before);
    // The live attempt's line shortens it to the heartbeat.
    const now = new Date();
    await renewLease(t.db, ep.id, 2, 150, now);
    expect(Math.abs((await lease()) - (now.getTime() + 150_000))).toBeLessThan(1000);
  });

  it("the episode poll restarts a date whose writer died (the site no longer waits for the cron)", async () => {
    const { creator, ep } = await newDate();
    // A writer that claimed it and died: running, its lease run out.
    await t.db.query(`update generation_jobs set status = 'running', attempts = 1, leased_until = now() - interval '1 second' where episode_id = $1`, [ep.id]);
    expect((await (await api.getEpisode(ep.id, creator)).json()).status).toBe("generating");
    // The rescue runs after the response (or at once outside a request): wait for it.
    let status = "generating";
    for (let i = 0; i < 50 && status === "generating"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      status = (await t.db.query<{ status: string }>(`select status from episodes where id = $1`, [ep.id])).rows[0]?.status ?? "gone";
    }
    expect(status).toBe("ready");
    const job = (await t.db.query<{ attempts: number }>(`select attempts from generation_jobs where episode_id = $1`, [ep.id])).rows[0];
    expect(job.attempts).toBe(2);
    expect(BASE_URL).toBeTruthy();
  });
});
