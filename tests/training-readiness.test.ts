// The readiness tracker for the roadmap's learning items (lib/training-readiness.ts, ROADMAP #577 and #578): #577's
// labelled lines count only through the dataset gates (aired public dates, opted-in characters and voters, never After
// Dark), "mostly from other players" leaves our own out, and #578's dates and swipers are counted the way Real use counts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getReadiness } from "@/app/api/admin/training-readiness/route";
import { ReadinessView } from "@/app/admin/analytics/QualityTab";
import { claimAdmin } from "@/lib/admins";
import { registerAccount } from "@/lib/auth";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setLineVote } from "@/lib/line-feedback";
import { setMlConsent } from "@/lib/ml-consent";
import { fineTuneFrom, fineTuneReadiness, FINE_TUNE_GATE, gateText, outcomesReadiness, OUTCOMES_GATE, trainingReadiness } from "@/lib/training-readiness";
import { BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from admins");
  await t.db.query("delete from swipes");
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const HOUSE = HOUSE_CHARACTERS[0].id;
const LINES = [
  { side: "a", act: 0, dialogue: "Hello there.", action: "", emotion: "pleased", interest: 0.6 },
  { side: "b", act: 0, dialogue: "Hi. You found the place.", action: "", emotion: "dry", interest: 0.5 },
  { side: "a", act: 1, dialogue: "I followed the smell of dumplings.", action: "", emotion: "warm", interest: 0.6 },
];

let n = 0;
async function account(): Promise<string> {
  const userId = userIdOf(newUserCookie());
  await registerAccount(t.db, userId, `rdy${++n}${Math.floor(Math.random() * 1e6)}`, ["a", "good", "password"].join("-"));
  return userId;
}
async function optedIn(): Promise<string> {
  const user = await account();
  await setMlConsent(t.db, user, true);
  return user;
}
async function character(owner: string, o: { visibility?: string; at?: string } = {}): Promise<string> {
  const id = `rdy-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker, visibility, created_at)
     values ($1, $2, $3, 30, 'bio', '["kind","bold","warm"]'::jsonb, 'love', 'rudeness', $4, coalesce($5::timestamptz, now()))`,
    [id, owner, `Char ${n}`, o.visibility ?? "public", o.at ?? null],
  );
  return id;
}
type EpisodeOpts = { visibility?: string; afterDark?: boolean; creator?: string; at?: string };
async function episode(a: string, b: string, o: EpisodeOpts = {}): Promise<string> {
  const id = `rdy-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, transcript, visibility, status, revealed_at, setup, created_at)
     values ($1, $2, $3, $4, 'A bar.', '[]'::jsonb, '[]'::jsonb, '', '', 'friends', $5::jsonb, $6, 'ready', now(), $7::jsonb, coalesce($8::timestamptz, now()))`,
    [id, o.creator ?? "creator-x", a, b, JSON.stringify(LINES), o.visibility ?? "public", JSON.stringify(o.afterDark ? { after_dark: true } : {}), o.at ?? null],
  );
  return id;
}
const vote = (voter: string, ep: string, line = 0, value: 1 | -1 = 1) => setLineVote(t.db, { userId: voter, kind: "episode", refId: ep, lineIndex: line, vote: value });
const draft = (ep: string, turn: number, side: "a" | "b", rejected: string | null) =>
  t.db.query(`insert into turn_drafts (episode_id, turn_index, side, source, reason, rejected) values ($1, $2, $3, 'critic', 'a note', $4)`, [ep, turn, side, rejected]);
const gate = (r: { gates: { key: string; have: number; need: number; met: boolean }[] }, key: string) => r.gates.find((g) => g.key === key)!;

describe("#577: labelled lines, through the dataset gates", () => {
  it("counts a line once per date and line, by votes from opted-in people and kept critic drafts, and the characters speaking them", async () => {
    const owner = await optedIn();
    const fan = await optedIn();
    const mine = await character(owner);
    const ep = await episode(mine, HOUSE, { creator: owner });
    await vote(fan, ep, 0);
    await vote(owner, ep, 0, -1); // a second label on the same line: still one line
    await draft(ep, 1, "b", "Hi. Nice to meet you, I guess."); // the house character's line, revised
    await draft(ep, 2, "a", null); // a safety filter's catch keeps no text: not a label

    const r = await fineTuneReadiness(t.db);
    expect(gate(r, "lines")).toMatchObject({ have: 2, need: FINE_TUNE_GATE.lines, met: false });
    expect(gate(r, "characters")).toMatchObject({ have: 2, need: FINE_TUNE_GATE.characters });
    expect(r.detail).toMatchObject({ voted_lines: 1, critic_lines: 1, player_characters: 1 });
    expect(r.ready).toBe(false);
    expect(r.sentence).toMatch(/^Fine-tuning \(#577\) can start when 2,000 labelled lines .* Still needed: 1,998 more lines and 28 more characters\.$/);
  });

  it("leaves out what no dataset may read: no opt-in, an older-wording yes, private and After Dark dates, private characters, non-opted-in voters", async () => {
    const fan = await optedIn();
    const owner = await optedIn();
    const silent = await account();
    const dropped = [
      await episode(await character(silent), HOUSE), // its owner never opted in
      await episode(await character(owner), HOUSE, { visibility: "private" }),
      await episode(await character(owner), HOUSE, { visibility: "unlisted" }),
      await episode(await character(owner), HOUSE, { afterDark: true }),
      await episode(await character(owner, { visibility: "private" }), HOUSE), // a private character's sheet can't be used
    ];
    for (const ep of dropped) {
      await vote(fan, ep);
      await draft(ep, 1, "b", "A draft.");
    }
    // An opted-in date, but the only vote is from someone who never opted in.
    const good = await episode(await character(owner), HOUSE);
    await vote("anon-stranger", good);
    // After Dark votes are never read.
    await setLineVote(t.db, { userId: fan, kind: "after_dark", refId: "scene-x", lineIndex: 0, vote: 1 });
    expect(gate(await fineTuneReadiness(t.db), "lines").have).toBe(0);

    await t.db.query(`update ml_consents set version = '2026-01-01' where user_id = $1`, [fan]);
    await vote(fan, good, 1);
    expect(gate(await fineTuneReadiness(t.db), "lines").have).toBe(0);
  });

  it("'from other players' leaves our own out: an admin's votes and critic revisions on an admin's own dates count toward the total only", async () => {
    const admin = await optedIn();
    await claimAdmin(t.db, admin);
    const player = await optedIn();
    const ours = await episode(await character(admin), HOUSE, { creator: admin });
    await vote(admin, ours, 0);
    await draft(ours, 1, "b", "A draft.");
    const theirs = await episode(await character(player), HOUSE, { creator: player });
    await vote(admin, theirs, 0); // an admin's vote on a player's date: ours
    let r = await fineTuneReadiness(t.db);
    expect(gate(r, "lines").have).toBe(3);
    expect(gate(r, "others")).toMatchObject({ have: 0, need: 3, met: false });
    expect(r.detail.our_lines).toBe(3);

    await draft(theirs, 1, "b", "Another draft."); // a critic revision on a player's date: theirs
    await vote(player, theirs, 2);
    r = await fineTuneReadiness(t.db);
    expect(gate(r, "others")).toMatchObject({ have: 2, need: 5, met: false });
  });

  it("is ready once every gate is met, and 'mostly' means more than half", () => {
    const labels = Array.from({ length: FINE_TUNE_GATE.lines }, (_, i) => ({
      episode_id: `ep${i % 400}`,
      line_index: Math.floor(i / 400),
      kind: "vote" as const,
      voter: i % 2 ? "player" : "us",
      creator_id: "player",
      side: i % 2 ? "a" : "b",
      character_a: `c${i % 60}`,
      character_b: `h${i % 60}`,
      a_house: false,
      b_house: true,
    }));
    const half = fineTuneFrom(labels, new Set(["us"]));
    expect(gate(half, "others")).toMatchObject({ have: 1000, need: 2000, met: false }); // exactly half isn't "mostly"
    const most = fineTuneFrom(labels.map((l, i) => (i === 0 ? { ...l, voter: "player" } : l)), new Set(["us"]));
    expect(most.gates.every((g) => g.met)).toBe(true);
    expect(most.ready).toBe(true);
    expect(most.sentence).toMatch(/^Fine-tuning \(#577\) can start: the labelled lines are in\./);
    expect(gateText(gate(most, "others") as never)).toBe("1,001 of 2,000 (needs more than half)");
  });
});

describe("#578: real dates and swipers in 30 days, the way Real use counts", () => {
  const swipe = (swiper: string, target: string, at?: string) =>
    t.db.query(`insert into swipes (swiper, target, liked, created_at) values ($1, $2, true, coalesce($3::timestamptz, now()))`, [swiper, target, at ?? null]);

  it("counts real people's dates and distinct swipers, leaving our own and anything older than 30 days out", async () => {
    const admin = await account();
    await claimAdmin(t.db, admin);
    const person = await account();
    const keen = await optedIn();
    const pc = await character(person);
    const kc = await character(keen);
    const ac = await character(admin);
    await episode(pc, HOUSE, { creator: person });
    await episode(kc, HOUSE, { creator: keen });
    await episode(ac, HOUSE, { creator: admin }); // ours
    await episode(pc, HOUSE, { creator: person, at: new Date(Date.now() - 40 * 86_400_000).toISOString() }); // too old
    await swipe(pc, HOUSE);
    await swipe(pc, kc); // the same swiper twice: one swiper
    await swipe(kc, pc);
    await swipe(ac, pc); // ours

    const r = await outcomesReadiness(t.db);
    expect(gate(r, "dates")).toMatchObject({ have: 2, need: OUTCOMES_GATE.dates, met: false });
    expect(gate(r, "swipers")).toMatchObject({ have: 2, need: OUTCOMES_GATE.swipers, met: false });
    expect(r.sentence).toBe("Learning from outcomes (#578) can start when real use reaches 500 dates and 200 swipers in 30 days. Still needed: 498 more dates and 198 more swipers.");
    // What the offline evaluators may read: only the opted-in side (keen's date; keen's swipe on a non-opted-in card is out).
    expect(r.usable).toEqual({ dates: 1, swipers: 0 });
    await swipe(kc, HOUSE);
    expect((await outcomesReadiness(t.db)).usable).toEqual({ dates: 1, swipers: 1 });
  });
});

describe("the admin endpoint and the Quality tab", () => {
  it("is owner-only, and answers both items with their gates and no money", async () => {
    const anon = await getReadiness(new Request(`${BASE_URL}/api/admin/training-readiness`, { headers: { cookie: newUserCookie() } }));
    expect(anon.status).toBe(403);
    const admin = await account();
    await claimAdmin(t.db, admin);
    const res = await getReadiness(new Request(`${BASE_URL}/api/admin/training-readiness`, { headers: { cookie: signedInCookie(admin) } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fine_tune.gates.map((g: { key: string }) => g.key)).toEqual(["lines", "characters", "others"]);
    expect(body.outcomes.gates.map((g: { key: string }) => g.key)).toEqual(["dates", "swipers"]);
    expect(JSON.stringify(body)).not.toMatch(/\$|usd|revenue|price|cents|amount/i);
  });

  it("shows each gate as 'x of y' with the sentence that says when it can start", async () => {
    const html = renderToStaticMarkup(createElement(ReadinessView, { data: await trainingReadiness(t.db) }));
    expect(html).toContain("0 of 2,000");
    expect(html).toContain("0 of 30");
    expect(html).toContain("0 of 500");
    expect(html).toContain("0 of 200");
    expect(html).toContain("Fine-tuning (#577) can start when");
    expect(html).toContain("Learning from outcomes (#578) can start when");
    expect(html).not.toMatch(/\$\d|revenue/i);
  });
});
