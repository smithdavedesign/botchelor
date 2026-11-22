/**
 * A date's report card (lib/report-card.ts, app/episodes/[id]/report-card, app/api/og/report-card/[id]; David
 * 2026-11-20, growth playbook "viral shareable moments"): the grades on a curve, what the card is made of, and the rule
 * that it exists only once a date has aired for everyone (never before, never for a private date), so a typed address
 * can't spoil an ending.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The route renders through next/og: keep the real renderer and record the element, to read the words it drew.
const og = vi.hoisted(() => ({ elements: [] as unknown[] }));
vi.mock("next/og", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/og")>();
  class RecordingImageResponse extends real.ImageResponse {
    constructor(...args: ConstructorParameters<typeof real.ImageResponse>) {
      og.elements.push(args[0]);
      super(...args);
    }
  }
  return { ...real, ImageResponse: RecordingImageResponse };
});
const nav = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error(`redirect ${to}`), { to });
  }),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("not found"), { notFound: true });
  }),
}));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), redirect: nav.redirect, notFound: nav.notFound }));
// Who's looking, for the page's own cookie read (a private date's own people get a note instead of the 404).
const viewer = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/headers")>()),
  cookies: async () => {
    const jar = new Map(
      viewer.cookie
        .split(";")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)] as const),
    );
    return { get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) };
  },
}));

import { readFileSync, writeFileSync } from "node:fs";
import { BEACON_REFS } from "@/app/funnel";
import { GET as cardRoute } from "@/app/api/og/report-card/[id]/route";
import ReportCardPage, { generateMetadata } from "@/app/episodes/[id]/report-card/page";
import { sourceOf } from "@/lib/engagement";
import type { BoxScore, EpisodeView } from "@/lib/game";
import {
  ALL_GRADES,
  gradeOf,
  overallGrade,
  rankOf,
  REPORT_CURVE,
  REPORT_REF,
  reportCardOf,
  reportCardPath,
  reportCardStoryPath,
  reportCardTitle,
  sharedReportCardPath,
  subjectsOf,
  verdictsOf,
} from "@/lib/report-card";
import { DATE_VARIABLES } from "@/lib/rules";
import { api, BASE_URL, newUserCookie, setupEpisode, startTestDb } from "./helpers";

const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const box = (finals: Partial<Record<(typeof DATE_VARIABLES)[number], number>>, delta = 0): BoxScore =>
  Object.fromEntries(DATE_VARIABLES.map((v) => [v, { start: 50, final: finals[v] ?? REPORT_CURVE[v][2], delta, peak: 0 }])) as unknown as BoxScore;

describe("grades on a curve (pure)", () => {
  it("a typical date is a B-, the best tenth an A or better, and the bottom a D or F, subject by subject", () => {
    for (const v of DATE_VARIABLES) {
      const [p10, , p50, , p90] = REPORT_CURVE[v];
      const good = v !== "awkwardness";
      expect(gradeOf(rankOf(v, p50)), v).toBe("B-");
      expect(gradeOf(rankOf(v, good ? p90 + 2 : p10 - 2)), v).toMatch(/^A/);
      expect(gradeOf(rankOf(v, good ? p10 - 5 : p90 + 5)), v).toMatch(/^[DF]$/);
    }
  });

  it("is monotonic, stays within 0–100, and turns awkwardness round", () => {
    for (const v of DATE_VARIABLES) {
      let last = v === "awkwardness" ? 101 : -1;
      for (let s = 0; s <= 100; s++) {
        const r = rankOf(v, s);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(100);
        if (v === "awkwardness") expect(r).toBeLessThanOrEqual(last);
        else expect(r).toBeGreaterThanOrEqual(last);
        last = r;
      }
    }
    expect(rankOf("chemistry", Number.NaN)).toBe(50);
    expect(ALL_GRADES[0]).toBe("A+");
    expect(gradeOf(0)).toBe("F");
    expect(gradeOf(100)).toBe("A+");
  });

  it("averages the subjects into the overall grade, and says how each one moved", () => {
    expect(overallGrade(box({}))).toBe("B-");
    expect(overallGrade(box({ chemistry: 95, attraction: 95, trust: 80, awkwardness: 5 }))).toBe("A+");
    expect(overallGrade(box({ chemistry: 30, attraction: 20, trust: 10, awkwardness: 90 }))).toBe("F");
    const moved = subjectsOf(box({}, 18));
    expect(moved.find((s) => s.variable === "chemistry")?.comment).toBe("Rose a lot over the night");
    expect(moved.find((s) => s.variable === "awkwardness")?.comment).toBe("Got a lot more awkward as it went");
    expect(subjectsOf(box({}, -5)).find((s) => s.variable === "trust")?.comment).toBe("Fell a little over the night");
    expect(subjectsOf(box({}, 1))[0].comment).toBe("Held steady all night");
  });

  it("says 'an A' and 'an F', 'a B'", () => {
    const card = { names: ["Ada", "Bo"] as [string, string], ending: "Just friends" };
    expect(reportCardTitle({ ...card, overall: "A-" })).toBe("Ada × Bo got an A- on their AI blind date (just friends)");
    expect(reportCardTitle({ ...card, overall: "F" })).toContain("got an F");
    expect(reportCardTitle({ ...card, overall: "B+" })).toContain("got a B+");
  });
});

describe("what goes on it (pure)", () => {
  const a = { id: "c_a", name: "Ada Quill", hue: 1, house: false, portrait: null };
  const b = { id: "c_b", name: "Bo Reyes", hue: 2, house: true, portrait: null };
  const aired = {
    id: "ep_1",
    hidden: false,
    revealed: true,
    visibility: "public",
    ending: "disaster",
    ending_detail: "walked_out",
    box_score: box({}),
    best_line: "  You alphabetise your spices?  ",
    characters: [a, b],
  } as unknown as EpisodeView;

  it("each side's own answer when the public may see it, else its diary line, else nothing", () => {
    const verdicts = verdictsOf({
      characters: [a, b] as EpisodeView["characters"],
      inner: { thoughts: [], choices: [{ character_id: "c_a", see_again: "no", reason: " He talked over the waiter. " }] },
      diary: [{ character_id: "c_b", line: "I'd go again, for the soup." }],
    });
    expect(verdicts).toEqual([
      { characterId: "c_a", name: "Ada Quill", kind: "see_again", seeAgain: "no", line: "He talked over the waiter." },
      { characterId: "c_b", name: "Bo Reyes", kind: "diary", line: "I'd go again, for the soup." },
    ]);
    expect(verdictsOf({ characters: [a, b] as EpisodeView["characters"] })).toEqual([]);
  });

  it("only once aired for everyone: never unaired, private, hidden or without a box score", () => {
    const card = reportCardOf(aired);
    expect(card).toMatchObject({ episodeId: "ep_1", names: ["Ada Quill", "Bo Reyes"], overall: "B-", quote: "You alphabetise your spices?" });
    expect(card?.ending).toMatch(/^A disaster · /);
    expect(card?.subjects.map((s) => s.variable)).toEqual([...DATE_VARIABLES]);
    expect(reportCardOf(null)).toBeNull();
    expect(reportCardOf({ ...aired, revealed: false })).toBeNull();
    expect(reportCardOf({ ...aired, visibility: "private" })).toBeNull();
    expect(reportCardOf({ ...aired, hidden: true })).toBeNull();
    expect(reportCardOf({ ...aired, box_score: undefined })).toBeNull();
    expect(reportCardOf({ ...aired, visibility: "unlisted" })).not.toBeNull();
  });

  it("its share is tagged, and the tag is its own source", () => {
    expect(sharedReportCardPath("ep_1")).toBe(`${reportCardPath("ep_1")}?ref=${REPORT_REF}`);
    expect(BEACON_REFS).toContain(REPORT_REF);
    expect(sourceOf({ ref: REPORT_REF })).toBe("report_share");
  });
});

describe("the page and the picture, on a real date", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    og.elements.length = 0;
    viewer.cookie = "";
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const picture = (id: string) => cardRoute(new Request(`${BASE_URL}/api/og/report-card/${id}`), { params: Promise.resolve({ id }) });
  const page = (id: string) => ReportCardPage({ params: Promise.resolve({ id }) });

  it("before the finale airs: no picture, and the page sends you to the episode to call it", async () => {
    const { episode } = await setupEpisode("disaster");
    expect((await picture(episode.id)).status).toBe(404);
    await expect(page(episode.id)).rejects.toMatchObject({ to: `/episodes/${episode.id}` });
    expect((await generateMetadata({ params: Promise.resolve({ id: episode.id }) })).robots).toEqual({ index: false, follow: false });
  });

  it("once aired: the grades, the ending and the share, on the page and on the picture", async () => {
    const { episode, creator } = await setupEpisode("disaster");
    expect((await api.reveal(episode.id, creator)).status).toBe(200);

    const html = text(renderToStaticMarkup(await page(episode.id)));
    const overall = /data-report-card="([^"]+)"/.exec(html)?.[1];
    expect(ALL_GRADES).toContain(overall);
    expect(html).toContain("A disaster");
    expect(html.match(/data-subject=/g)).toHaveLength(DATE_VARIABLES.length);
    // 2026-11-22 audit: the letter is where the date stands among aired ones, said over the grades, not only at the foot.
    expect(html).toContain("Each grade compares this date with every date on the air; the words say how it went on the night.");
    expect(html).toContain(`href="${`/episodes/${episode.id}`}?ref=${REPORT_REF}"`);
    expect(html).toContain('href="/create"');

    const meta = await generateMetadata({ params: Promise.resolve({ id: episode.id }) });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(String(meta.openGraph?.title)).toContain(` ${overall} on their AI blind date (a disaster`);

    const res = await picture(episode.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const words = text(renderToStaticMarkup(og.elements[0] as ReactElement));
    expect(words).toContain("date report card");
    expect(words).toContain("A disaster");
    for (const label of ["Chemistry", "Attraction", "Trust", "Awkwardness"]) expect(words).toContain(label);
  });

  it("?format=story draws the same card at 9:16 (1080×1920), and an unaired date has none in either shape", async () => {
    const { episode, creator } = await setupEpisode("friends");
    const story = (id: string) => cardRoute(new Request(`${BASE_URL}${reportCardStoryPath(id)}`), { params: Promise.resolve({ id }) });
    expect((await story(episode.id)).status).toBe(404);
    await api.reveal(episode.id, creator);
    og.elements.length = 0;
    const res = await story(episode.id);
    expect(res.status).toBe(200);
    const png = Buffer.from(await res.arrayBuffer());
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1920]); // the IHDR's width and height
    if (process.env.REPORT_STORY_OUT) writeFileSync(process.env.REPORT_STORY_OUT, png);
    const words = text(renderToStaticMarkup(og.elements[0] as ReactElement));
    expect(words).toContain("date report card");
    expect(words).toContain("Just friends");
    expect(words).toContain("AI characters on a blind date nobody steers");
  });

  it("a private date has none, aired or not: its own people are told why, anyone else gets the 404", async () => {
    const { episode, creator } = await setupEpisode("second_date");
    await api.reveal(episode.id, creator);
    expect((await api.setVisibility(episode.id, "private", creator)).status).toBe(200);
    expect((await picture(episode.id)).status).toBe(404);
    await expect(page(episode.id)).rejects.toMatchObject({ notFound: true });
    // 2026-11-22 audit: its owner read "doesn't exist, or it was hidden after several viewers reported it".
    viewer.cookie = creator;
    const own = text(renderToStaticMarkup(await page(episode.id)));
    expect(own).toContain("Private dates have no report card");
    expect(own).toContain("is private: only you can watch it");
    expect(own).toContain(`href="/episodes/${episode.id}"`);
    expect(own).not.toContain("data-subject=");
    viewer.cookie = newUserCookie();
    await expect(page(episode.id)).rejects.toMatchObject({ notFound: true });
  });
});

describe("where it's linked", () => {
  const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  it("from the box score and both end screens, only when the page decides there is one", () => {
    const page = source("app/episodes/[id]/page.tsx");
    expect(page).toContain('const reportCard = episode.revealed && episode.box_score && episode.visibility !== "private" && !episode.hidden ? reportCardPath(episode.id) : null;');
    expect(page).toContain("reportCard={reportCard} />");
    expect(page).toContain("reportCard={reportCard}\n");
    expect(source("app/episodes/[id]/BoxScore.tsx")).toContain("{reportCard && (");
    const theater = source("app/episodes/[id]/EpisodeTheater.tsx");
    expect(theater).toContain("reportCard={reportCard ?? null}");
    expect(theater).toContain('className="theater-report"');
    expect(source("app/episodes/[id]/VerdictCard.tsx")).toContain('className="verdict-report"');
    expect(source("app/episodes/[id]/report-card/page.tsx")).toContain("href={reportCardStoryPath(id)}");
  });
});
