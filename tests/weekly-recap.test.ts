// The week in review's cut (scripts/clips/weekly-recap.mjs, 2026-11-24): which week a Sunday run means, the line each
// date is quoted by, the edit decision list (order, labels, the cap), the caption, the checklist the social loop reads,
// the upload's form, the staging copy, and the Sunday line in the crowd's runner.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SERIES_MARK } from "../scripts/clips/daily-episode.mjs";
import { MAX_SECONDS, resolveBeats } from "../scripts/clips/episode-cut.mjs";
import {
  defaultWeek,
  mondayOf,
  RECAP_DATES,
  RECAP_ENDING_SECONDS,
  RECAP_MARK,
  RECAP_MIN_DATES,
  RECAP_TARGET,
  recapCaption,
  recapChecklist,
  recapEdl,
  recapLine,
  recapPosterArgs,
  recapSay,
  releaseRecap,
  uploadRecap,
  weekdayOf,
} from "../scripts/clips/weekly-recap.mjs";

const week = { id: "2026-11-16", label: "Nov 16 to 22" };
const NAMES: [string, string][] = [
  ["Juniper Vale", "Barnaby Thorne"],
  ["Sable Quist", "Nell Abiodun"],
  ["Dex Okafor", "Rafe Calloway"],
  ["Juniper Vale", "Sable Quist"],
  ["Orin Fletcher", "Kaz Lindqvist"],
  ["Imogen Strand", "Teo Brandt"],
  ["Marisol Pine", "Wally Osei"],
  ["Lior Nakamura", "Boaz Mehra"],
];
const slug = (name: string) => `house-${name.split(" ")[0].toLowerCase()}`;
/** A date as its public page gives it: seven lines, the best one in line 4. */
function episode(n: number, over: Record<string, unknown> = {}) {
  const [a, b] = NAMES[n];
  return {
    id: `ep${n}`,
    title: `Night ${n}`,
    venue: "jazz_bar",
    ending: n % 2 ? "friends" : "second_date",
    why: n % 2 ? "Just friends: the trust never came." : "A second date: chemistry carried it.",
    share_path: `/episodes/ep${n}`,
    best_line: `I'd hand you lamp number ${n} in a gale.`,
    characters: [
      { id: slug(a), name: a, pronouns: "she/her", portrait: "/cast/a.webp" },
      { id: slug(b), name: b, pronouns: "he/him", portrait: "/cast/b.webp" },
    ],
    transcript: [
      { side: "a" as const, dialogue: "You came back." },
      { side: "b" as const, dialogue: "The gulls said I would." },
      { side: "a" as const, dialogue: "They lie about most things." },
      { side: "b" as const, dialogue: "Not about this." },
      { side: "a" as const, dialogue: `Fine. I'd hand you lamp number ${n} in a gale. I don't hand the lamp to anyone.` },
      { side: "b" as const, dialogue: "Then I'll hold it steady." },
      { side: "a" as const, dialogue: "See that you do." },
    ],
    ...over,
  };
}
const listed = (n: number, over: Record<string, unknown> = {}) => ({ id: `ep${n}`, grade: n % 2 ? null : "B+", aired_at: `2026-11-${16 + n}T20:00:00.000Z`, ...over });
const many = (count: number) => ({ dates: Array.from({ length: count }, (_, i) => listed(i)), episodes: Array.from({ length: count }, (_, i) => episode(i)) });

describe("which week a run means", () => {
  it("knows a week by its Monday", () => {
    expect(mondayOf(new Date("2026-11-24T22:00:00Z"))).toBe("2026-11-23");
    expect(mondayOf(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-23");
    expect(mondayOf(new Date("2026-11-22T23:59:59Z"))).toBe("2026-11-16");
  });

  it("recaps the week that just ended, or on a week's last half day the one about to", () => {
    // Sunday 17:00 Pacific in winter is Monday 01:00 UTC; in summer, Monday 00:00; a little early, still Sunday in UTC.
    expect(defaultWeek(new Date("2026-11-23T01:00:00Z"))).toBe("2026-11-16");
    expect(defaultWeek(new Date("2026-11-23T00:00:00Z"))).toBe("2026-11-16");
    expect(defaultWeek(new Date("2026-11-22T23:40:00Z"))).toBe("2026-11-16");
    expect(defaultWeek(new Date("2026-11-22T12:00:00Z"))).toBe("2026-11-16");
    // Midweek, by hand: the last complete week.
    expect(defaultWeek(new Date("2026-11-24T22:00:00Z"))).toBe("2026-11-16");
    expect(defaultWeek(new Date("2026-11-22T11:59:00Z"))).toBe("2026-11-09");
  });

  it("names the day a date aired", () => {
    expect(weekdayOf("2026-11-17T20:00:00.000Z")).toBe("Tuesday");
    expect(weekdayOf("2026-11-22T23:59:00.000Z")).toBe("Sunday");
    expect(weekdayOf(null)).toBeNull();
    expect(weekdayOf("soon")).toBeNull();
  });
});

describe("the line a date is quoted by", () => {
  it("is its best line's own sentence", () => {
    expect(recapLine(episode(3))).toEqual({ line: 4, keep: [1], text: "I'd hand you lamp number 3 in a gale." });
  });

  it("is a short, pointed line of the second half when the date has no best line", () => {
    const e = episode(1, { best_line: null, transcript: [...episode(1).transcript.slice(0, 5), { side: "b" as const, dialogue: "Steady? In this weather? Never." }, { side: "a" as const, dialogue: "Good." }] });
    expect(recapLine(e)).toEqual({ line: 5, keep: [0], text: "Steady?" });
  });

  it("is cut to its first sentence when the best line runs long, and nothing when nobody spoke", () => {
    const long = `${"This sentence carries on for a good while about lamps and gales and gulls. ".repeat(2)}And then it ends here, at last, after rather a lot of weather.`;
    const e = episode(0, { best_line: long, transcript: [{ side: "a" as const, dialogue: long }, { side: "b" as const, dialogue: "Right." }] });
    expect(recapLine(e)).toMatchObject({ line: 0, keep: [0] });
    expect(recapLine(episode(0, { transcript: [] }))).toBeNull();
  });

  it("says the ending, and the grade when there is one", () => {
    expect(recapSay("A second date", "B+")).toBe("A second date. Report card: a B plus.");
    expect(recapSay("Just friends", "A-")).toBe("Just friends. Report card: an A minus.");
    expect(recapSay("A disaster", null)).toBe("A disaster.");
  });
});

describe("the recap's edit", () => {
  it("is a title, then each date's line and how it ended, in the week's order, then where the rest is", () => {
    const { dates, episodes } = many(3);
    // The pages can come back in any order: the week's list decides.
    const plan = recapEdl(week, dates, [...episodes].reverse());
    expect(plan.episodes.map((e) => e.id)).toEqual(["ep0", "ep1", "ep2"]);
    expect(plan.edl.episodes).toEqual(["ep0", "ep1", "ep2"]);
    expect(plan.edl.week).toBe("2026-11-16");
    expect(plan.edl.cover).toBe(0);
    expect(plan.edl.segments.map((s) => s.kind)).toEqual(["title", "line", "report", "line", "reveal", "line", "report", "card"]);
    const [title, line0, end0, line1, end1] = plan.edl.segments;
    expect(title).toMatchObject({ title: "This week on Botchelor", kicker: "The week in review · Nov 16 to 22", sub: "3 dates. 3 endings.", say: "This week on Botchelor." });
    expect(line0).toEqual({ kind: "line", ep: 0, line: 4, keep: [1], label: "Juniper × Barnaby · Monday" });
    expect(end0).toEqual({ kind: "report", ep: 0, say: "A second date. Report card: a B plus.", secs: RECAP_ENDING_SECONDS });
    expect(line1).toMatchObject({ ep: 1, label: "Sable × Nell · Tuesday" });
    expect(end1).toEqual({ kind: "reveal", ep: 1, say: "Just friends.", secs: RECAP_ENDING_SECONDS });
    expect(plan.edl.segments.at(-1)).toMatchObject({ kind: "card", url: "botchelor.com/week" });
    // The renderer takes it as it is: every line is the date's own, every ending its own date's.
    const beats = resolveBeats(plan.edl, plan.episodes);
    expect(beats).toHaveLength(8);
    expect(beats[1].text).toBe("I'd hand you lamp number 0 in a gale.");
    expect(beats[1].episode.id).toBe("ep0");
    expect(beats[2].image).toBe("/api/og/report-card/ep0?format=story");
    expect(beats[4].title).toBe("Just friends");
  });

  it("puts three of the week's faces on the title, nobody twice", () => {
    // Juniper is in the first date and the fourth: her second date shows the other one.
    const dates = [listed(0), listed(3), listed(1)];
    const plan = recapEdl(week, dates, [episode(0), episode(3), episode(1)]);
    expect(plan.edl.segments[0].faces).toEqual([[0, "a"], [1, "b"], [2, "b"]]);
    const [title] = resolveBeats(plan.edl, plan.episodes);
    expect(title.faces!.map((c) => c.name)).toEqual(["Juniper Vale", "Sable Quist", "Nell Abiodun"]);
  });

  it(`holds at most ${RECAP_DATES} dates and drops from the end until it fits`, () => {
    const { dates, episodes } = many(8);
    const plan = recapEdl(week, dates, episodes);
    expect(plan.episodes).toHaveLength(RECAP_DATES);
    expect(plan.episodes.map((e) => e.id)).toEqual(["ep0", "ep1", "ep2", "ep3", "ep4", "ep5"]);
    expect(plan.seconds).toBeLessThanOrEqual(RECAP_TARGET);
    expect(RECAP_TARGET).toBeLessThan(MAX_SECONDS);
    // A tighter target keeps the best of the week, never fewer than a week needs.
    const short = recapEdl(week, dates, episodes, { target: 30 });
    expect(short.episodes.map((e) => e.id)).toEqual(["ep0", "ep1", "ep2"].slice(0, short.episodes.length));
    expect(short.episodes.length).toBeGreaterThanOrEqual(RECAP_MIN_DATES);
    expect(short.episodes.length).toBeLessThan(RECAP_DATES);
    expect(recapEdl(week, dates, episodes, { target: 1 }).episodes).toHaveLength(RECAP_MIN_DATES);
    expect(recapEdl(week, dates, episodes, { max: 4 }).episodes).toHaveLength(4);
  });

  it("leaves out a date the story check turned away, one with no ending, one with no lines, and one whose page is gone", () => {
    const dates = [listed(0), listed(1), listed(2), listed(3), listed(4)];
    const episodes = [episode(0, { featurable: false }), episode(1, { ending: null, why: null }), episode(2, { transcript: [] }), episode(3)];
    expect(() => recapEdl(week, dates, episodes)).toThrow(/has 1 date to recap; a recap needs 2/);
    const plan = recapEdl(week, dates, [...episodes, episode(4)]);
    expect(plan.episodes.map((e) => e.id)).toEqual(["ep3", "ep4"]);
    expect(() => recapEdl(week, [], [])).toThrow(/has 0 dates to recap/);
  });
});

describe("the caption and the checklist", () => {
  const { dates, episodes } = many(3);
  const plan = recapEdl(week, dates, episodes);

  it("opens on the week in a line, lists each ending, and sends people to the week's page", () => {
    const rows = recapCaption(week, plan.edl, plan.episodes, dates).split("\n");
    expect(rows[0]).toBe("This week on Botchelor: 3 dates, 3 endings (Nov 16 to 22)");
    expect(rows[0].length).toBeLessThanOrEqual(100);
    expect(rows).toContain("Juniper × Barnaby: a second date (B+)");
    expect(rows).toContain("Sable × Nell: just friends");
    expect(rows).toContain("The whole week: botchelor.com/week/2026-11-16?s=tiktok");
    expect(rows).toContain("Every character is AI, and every date is AI-generated fiction.");
    expect(rows.at(-1)).toContain("#botchelor");
  });

  it("never carries the daily episode's mark, and its first date link is the top date", () => {
    const text = recapChecklist(week, plan.edl, plan.episodes, { total: 61.23, beats: 8, voices: "Kokoro (Venice)" }).join("\n");
    expect(text).not.toContain(SERIES_MARK);
    expect(text).not.toContain("Daily episode: Day");
    expect(/\/episodes\/([\w-]+)/.exec(text)![1]).toBe("ep0");
    expect(text).toContain(`${RECAP_MARK}2026-11-16 · 61.2 s · 8 beats`);
    expect(text).toContain("https://botchelor.com/week/2026-11-16");
  });
});

describe("sending it and staging it", () => {
  it("posts the web copy, its poster, the week and the dates with the admin key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recap-test-"));
    writeFileSync(join(dir, "v.mp4"), "video");
    writeFileSync(join(dir, "p.jpg"), "poster");
    const calls: { url: string; init: RequestInit }[] = [];
    const send = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ ok: true, page: "/week/2026-11-16" });
    }) as unknown as typeof fetch;
    const sent = await uploadRecap({ base: "https://botchelor.com", key: "k", week: "2026-11-16", video: join(dir, "v.mp4"), poster: join(dir, "p.jpg"), seconds: 61.2, episodes: ["ep0", "ep1"], send });
    expect(sent).toEqual({ ok: true, status: 200, error: null, page: "/week/2026-11-16" });
    expect(calls[0].url).toBe("https://botchelor.com/api/admin/week-recap");
    expect((calls[0].init.headers as Record<string, string>)["x-frontier-key"]).toBe("k");
    const form = calls[0].init.body as FormData;
    expect(Object.fromEntries(["week", "episodes", "width", "height", "seconds"].map((k) => [k, form.get(k)]))).toEqual({ week: "2026-11-16", episodes: "ep0,ep1", width: "540", height: "960", seconds: "61.2" });
    expect(form.get("video")).toBeInstanceOf(Blob);
    expect(form.get("poster")).toBeInstanceOf(Blob);
    // A refusal comes back as the route's own word; a dead network never throws.
    const refused = await uploadRecap({ base: "https://botchelor.com", key: "k", week: "2026-11-16", video: join(dir, "v.mp4"), poster: join(dir, "p.jpg"), seconds: 61.2, episodes: ["ep0"], send: (async () => Response.json({ error: "not_public" }, { status: 409 })) as unknown as typeof fetch });
    expect(refused).toMatchObject({ ok: false, status: 409, error: "not_public" });
    const down = await uploadRecap({ base: "https://botchelor.com", key: "k", week: "2026-11-16", video: join(dir, "v.mp4"), poster: join(dir, "p.jpg"), seconds: 61.2, episodes: ["ep0"], send: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    expect(down).toMatchObject({ ok: false, status: 0, error: "offline" });
  });

  it("takes the poster from the cut's first frame at the web copy's size", () => {
    const args = recapPosterArgs({ src: "cut.mp4", out: "poster.jpg" });
    expect(args).toContain("cut.mp4");
    expect(args.at(-1)).toBe("poster.jpg");
    expect(args.join(" ")).toContain("-frames:v 1");
    expect(args.join(" ")).toContain("scale=540:960");
  });

  it("copies a finished recap to the loop's staging folder, replacing an older copy", () => {
    const root = mkdtempSync(join(tmpdir(), "recap-release-"));
    const dir = join(root, "recaps", "2026-11-16");
    mkdirSync(dir, { recursive: true });
    for (const f of ["post.mp4", "cover.png", "caption.txt", "edl.json", "checklist.md"]) writeFileSync(join(dir, f), f);
    mkdirSync(join(root, "cuts", "week-2026-11-16"), { recursive: true });
    writeFileSync(join(root, "cuts", "week-2026-11-16", "stale.txt"), "old");
    const to = releaseRecap(dir, join(root, "cuts"), "2026-11-16");
    expect(to).toBe(join(root, "cuts", "week-2026-11-16"));
    for (const f of ["post.mp4", "cover.png", "caption.txt", "edl.json", "checklist.md"]) expect(readFileSync(join(to, f), "utf8")).toBe(f);
    expect(existsSync(join(to, "stale.txt"))).toBe(false);
  });
});

describe("scripts/crowd/run.sh: Sundays", () => {
  const run = readFileSync("scripts/crowd/run.sh", "utf8");

  it("cuts the week in review after the day's clip, sends and stages it, and never changes the clip job's answer", () => {
    const clip = run.indexOf("node scripts/clips/daily-clip.mjs");
    const sunday = run.indexOf('if [ "$(date +%u)" = 7 ]; then');
    const recap = run.indexOf("node scripts/clips/weekly-recap.mjs --upload --release");
    expect(clip).toBeGreaterThan(0);
    expect(sunday).toBeGreaterThan(clip);
    expect(recap).toBeGreaterThan(sunday);
    expect(run).toContain('>> "$HOME_DIR/logs/recap.log" 2>&1 || true');
    expect(run).toContain("clip=$?");
    expect(run).toContain("exit $clip ;;");
    // The clip is no longer exec'd: the shell has to live on for the recap.
    expect(run).not.toContain("exec /usr/bin/caffeinate -i node scripts/clips/daily-clip.mjs");
  });
});
