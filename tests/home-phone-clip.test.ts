/**
 * The clip on the stage (HOME_PHONE_CLIP, 2026-11-23): on a phone the day's clip plays in the first screen, standing
 * where the neon heart hangs with the cast either side. Pure parts: the switch, the cast line in two halves
 * (lib/home-open.ts stageSides), the screen as rendered, the play counter the engagement report reads
 * (lib/clip-count.ts, the short version's cut_* events with where: "home_phone"), what the server keeps of those events,
 * how the clip is wired to them (events never send from dev or a headless browser, so the plumbing is tested here), and
 * the stylesheet (phones only; from 861px the screen is as it was).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomeClip from "@/app/HomeClip";
import HomeOpen from "@/app/HomeOpen";
import { clipCounter, clipWhere, PHONE_MEDIA, type ClipEvent } from "@/lib/clip-count";
import { cleanBeacon } from "@/lib/engagement";
import { homePhoneClipOn, stageSides, type OpenFace } from "@/lib/home-open";

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const face = (id: string): OpenFace => ({ id, name: id, hue: null, portrait: null });
const slot = (id: string, lead = false) => ({ face: face(id), lead });
/** A side as "id" for a face standing on a phone, "(id)" for one stepped out there, "*" for a lead. */
const say = (side: { face: OpenFace; lead: boolean; far: boolean }[]) => side.map((s) => `${s.far ? "(" : ""}${s.face.id}${s.lead ? "*" : ""}${s.far ? ")" : ""}`);

describe("the switch", () => {
  it("is on unless HOME_PHONE_CLIP=0", () => {
    expect(homePhoneClipOn({})).toBe(true);
    expect(homePhoneClipOn({ HOME_PHONE_CLIP: "1" })).toBe(true);
    expect(homePhoneClipOn({ HOME_PHONE_CLIP: " 0 " })).toBe(false);
  });
});

describe("the cast either side of the phone", () => {
  it("puts tonight's two nearest the phone, one a side, with one stepped-back face each; the rest step out", () => {
    const { left, right } = stageSides([slot("a"), slot("b"), slot("x", true), slot("y", true), slot("c"), slot("d")]);
    expect(say(left)).toEqual(["(a)", "b", "x*"]);
    expect(say(right)).toEqual(["y*", "c", "(d)"]);
  });

  it("is the line itself read left then right, so a wide screen shows it as one row", () => {
    const line = [slot("a"), slot("x", true), slot("y", true), slot("z", true), slot("b")];
    const { left, right } = stageSides(line);
    expect([...left, ...right].map((s) => s.face.id)).toEqual(line.map((s) => s.face.id));
  });

  it("keeps all three of tonight's people when there are three, and steps the others out", () => {
    const { left, right } = stageSides([slot("a"), slot("x", true), slot("y", true), slot("z", true), slot("b")]);
    expect(say(left)).toEqual(["(a)", "x*", "y*"]);
    expect(say(right)).toEqual(["z*", "(b)"]);
  });

  it("keeps as many stepped-back faces a side, so the phone stays in the middle", () => {
    const one = stageSides([slot("a"), slot("x", true), slot("y", true)]);
    expect(say(one.left)).toEqual(["(a)", "x*"]);
    expect(say(one.right)).toEqual(["y*"]);
    const none = stageSides([slot("a"), slot("b"), slot("c")]);
    expect(say(none.left)).toEqual(["(a)", "b"]);
    expect(say(none.right)).toEqual(["c"]);
    expect(stageSides([slot("x", true), slot("y", true)])).toEqual({ left: [{ face: face("x"), lead: true, far: false }], right: [{ face: face("y"), lead: true, far: false }] });
    expect(stageSides([])).toEqual({ left: [], right: [] });
  });
});

describe("the screen", () => {
  const clip = createElement(HomeClip, { loopSrc: "/loop.mp4", posterSrc: "/poster.jpg", width: 480, height: 854, watchHref: "/episodes/e1?play=1", caption: "Juno × Pell", home: { stage: true } });
  const line = [slot("a"), slot("x", true), slot("y", true), slot("b")];
  const render = (onStage: boolean, withClip = true) => renderToStaticMarkup(createElement(HomeOpen, { arc: false, line, lede: "Describe a character in a sentence.", box: null, clip: withClip ? clip : null, onStage }));

  it("stands the clip on the stage with the cast in two halves either side of it", () => {
    const html = render(true);
    expect(html).toContain('class="home-open home-open--one home-open--on-stage"');
    expect(html).toContain('<div class="home-open-cast" aria-hidden="true"><ul class="home-open-side is-left"><li class="home-open-back">');
    expect(html).toContain('<ul class="home-open-side is-right"><li class="home-open-lead">');
    expect(html.match(/class="home-open-lead"/g)?.length).toBe(2);
    // The clip is the screen's, poster first: muted, looping, inline, nothing fetched before it plays, no autoplay
    // attribute (the script starts it on screen, so reduced motion and Save-Data keep the poster).
    const video = /<video[^>]*>/.exec(html)![0];
    for (const attr of ["muted", "loop", "playsInline", 'preload="none"', 'poster="/poster.jpg"']) expect(video.toLowerCase(), attr).toContain(attr.toLowerCase());
    expect(video).not.toContain("autoplay");
    // Before it plays there is no tap target over it: the caption's button is the one way to watch, as before.
    expect(html).not.toContain("home-clip-tap");
    expect(html.match(/<a\b/g)?.length).toBe(2); // the plain "Make your character" (no box here) and the clip's watch button
  });

  it("is the line as one list with the switch off, or with no clip to stand there", () => {
    for (const html of [render(false), render(true, false)]) {
      expect(html).not.toContain("home-open--on-stage");
      expect(html).not.toContain("home-open-side");
      expect(html).toContain('<ul class="home-open-cast" aria-hidden="true"><li class="home-open-back">');
    }
  });
});

describe("counting the clip's plays", () => {
  const run = (where: Parameters<typeof clipCounter>[0]) => {
    const sent: ClipEvent[] = [];
    return { sent, c: clipCounter(where, (e) => sent.push(e)) };
  };

  it("knows a phone's stage from under the box and from a wide screen", () => {
    expect(clipWhere(true, true)).toBe("home_phone");
    expect(clipWhere(true, false)).toBe("home_below");
    expect(clipWhere(false, true)).toBe("home_wide");
    expect(PHONE_MEDIA).toBe("(max-width: 860px)");
  });

  it("counts a play once, then a whole pass when it loops round, and nothing after", () => {
    const { sent, c } = run("home_phone");
    c.at(1); // before it started: nothing
    c.play(true, 12.4);
    c.play(true, 12.4); // resumed after resting off screen: not a new play
    for (const t of [0.3, 4, 8, 11.9]) c.at(t);
    c.at(0.2);
    c.at(5);
    expect(c.leave("hidden", 6)).toBe(false);
    expect(sent).toEqual([
      { name: "cut_play", props: { place: "home", where: "home_phone", auto: true, of: 12 } },
      { name: "cut_ended", props: { place: "home", where: "home_phone", of: 12 } },
    ]);
  });

  it("counts leaving before a whole pass once, with how far it got: a tap, the page hidden, or left", () => {
    const tap = run("home_phone");
    tap.c.play(false, 12);
    tap.c.at(3);
    tap.c.at(4.6);
    expect(tap.c.leave("tap", 4.6)).toBe(true);
    expect(tap.c.leave("away", 5)).toBe(false);
    tap.c.at(0.1);
    expect(tap.sent).toEqual([
      { name: "cut_play", props: { place: "home", where: "home_phone", auto: false, of: 12 } },
      { name: "cut_left", props: { place: "home", where: "home_phone", via: "tap", at: 5, of: 12, pct: 42 } },
    ]);
    // Never played (the poster stayed: less motion, or no autoplay and no tap): nothing at all.
    const still = run("home_wide");
    expect(still.c.leave("hidden", 0)).toBe(false);
    expect(still.sent).toEqual([]);
    // A length the browser never said: 0, and so no share.
    const unknown = run("home_below");
    unknown.c.play(true, Number.NaN);
    unknown.c.leave("away", 3);
    expect(unknown.sent[1]).toEqual({ name: "cut_left", props: { place: "home", where: "home_below", via: "away", at: 3, of: 0, pct: 0 } });
  });

  it("sends names and props the server keeps as they are", () => {
    const { sent, c } = run("home_phone");
    c.play(true, 12);
    c.leave("hidden", 6);
    const beacon = cleanBeacon({ v: "visitor-0001", s: "session-0001", events: sent.map((e) => ({ e: e.name, path: "/", props: e.props, t: Date.now() })) });
    expect(beacon?.events.map((e) => [e.event, e.props])).toEqual([
      ["cut_play", { place: "home", where: "home_phone", auto: true, of: 12 }],
      ["cut_left", { place: "home", where: "home_phone", via: "hidden", at: 6, of: 12, pct: 50 }],
    ]);
  });
});

describe("the clip's wiring (app/HomeClip.tsx)", () => {
  const src = read("app/HomeClip.tsx");

  it("counts into the site's own events, sends at once when the page goes, and only on home", () => {
    expect(src).toContain("clipCounter(clipWhere(window.matchMedia?.(PHONE_MEDIA).matches ?? false, stage), (e) => queueEvent(e.name, e.props))");
    expect(src).toContain('if (document.visibilityState === "hidden" && count?.leave("hidden", v.currentTime)) flush();');
    expect(src).toContain('count?.leave("away", v.currentTime);');
    expect(src).toContain("counter.current?.play(auto.current, v.duration);");
    expect(src).toContain("const count = counting ? ");
  });

  it("plays only on screen, after the page is live, and never by itself for less motion or Save-Data", () => {
    expect(src).toContain("new IntersectionObserver(");
    expect(src).toContain("if (wanted.current && v.paused) play();");
    expect(src).toContain("} else if (!v.paused) v.pause();");
    expect(src).toContain('window.matchMedia?.("(prefers-reduced-motion: reduce)").matches');
    expect(src).toContain("connection?.saveData === true");
    expect(src).toContain("wanted.current = !(calm || saving);");
  });

  it("on the stage, a tap on the playing clip opens the date as its watch button does, for a finger only", () => {
    expect(src).toContain('{stage && state === "playing" && (');
    expect(src).toContain('<Link className="home-clip-tap" href={watchHref} prefetch={false} tabIndex={-1} aria-hidden="true" data-track={`${track}-watch`} data-track-where="home_phone" onClick={leaving}>');
    expect(src).toContain('const leaving = () => counter.current?.leave("tap", video.current?.currentTime ?? 0);');
  });
});

describe("the stylesheet", () => {
  const front = read("app/ux/front.css");
  const start = front.indexOf("/* ── The clip on the stage");
  const block = front.slice(start, front.indexOf("/* Dust in the stage's two spotlight beams"));

  it("stands the clip on the stage on phones only: every stage rule is inside the phone query", () => {
    expect(start).toBeGreaterThan(0);
    const media = block.indexOf("@media (max-width: 860px) {");
    expect(media).toBeGreaterThan(0);
    // Before the query: the halves as one row, and the tap target and its cue hidden or inert anywhere else.
    expect(block.slice(0, media)).not.toContain("home-open--on-stage");
    expect(block.slice(0, media)).toMatch(/\.home-open-side \{\s*display: contents;/);
    expect(block.slice(0, media)).toMatch(/\.home-clip-tap \{\s*display: none;/);
    expect(block.slice(media)).toContain(".home-open--on-stage .home-clip .phone {\n    grid-area: 1 / 2;");
    expect(block.slice(media)).toContain(".home-open--on-stage .home-open-side .is-far {\n    display: none;");
    // Three leads put two on one side: then every lead shrinks to fit two in a side's share, so the phone stays centred.
    expect(block.slice(media)).toContain(".home-open--on-stage:has(.home-open-lead + .home-open-lead) {\n    --stage-lead: min(clamp(3rem, 14.5vw, 4.25rem), (100vw - 2 * var(--gutter) - var(--stage-clip) - 1.5rem) / 4);");
    // The wide screen's own rules never name the stage.
    const wide = front.slice(front.indexOf("@media (min-width: 861px) {"), start);
    expect(wide).not.toContain("on-stage");
  });
});
