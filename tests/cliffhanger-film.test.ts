// The day's cliffhanger with the date on film (lib/date-film.ts; scripts/clips/cliffhanger.mjs, 2026-11-24): which filmed
// confessional may open the cut, the scenes behind the lines, the ffmpeg graph with pictures over the two tiles, and the
// ask the day's video makes of the site first. A date with no film is cut exactly as before (tests/cliffhanger.test.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AFTER_TALK,
  CLIFF,
  cliffArgs,
  cliffhangerEdl,
  cliffSeconds,
  CONFESSIONAL_MAX_S,
  cutText,
  fileKind,
  filmScenes,
  layerHtml,
  pickConfessional,
  SHOT_AREA,
  shotPlan,
  spoilerHits,
  tellsAfter,
  TILES,
} from "../scripts/clips/cliffhanger.mjs";
import type { CliffEpisode } from "../scripts/clips/cliffhanger.mjs";
import { askForFilm } from "../scripts/clips/daily-episode.mjs";
import { resolveBeats } from "../scripts/clips/episode-cut.mjs";

const NELL_LINE = "Sable said no before I'd finished asking, and then told me why, which nobody ever does.";
const SABLE_LINE = "She asks a follow-up like she's defusing something, and I liked being the something.";

const date: CliffEpisode = {
  id: "ep7",
  title: "Spinning out of control",
  venue: "pottery_class",
  ending: "second_date",
  why: "An eighth date: chemistry 80 and attraction 59 carried it.",
  share_path: "/episodes/ep7",
  date_number: 7,
  best_line: "Is thinking always the enemy of fun, or just in empty rooms?",
  characters: [
    { id: "house-nell", name: "Nell Abiodun", pronouns: "she/her", portrait: "/cast/house-nell-v5.webp" },
    { id: "house-sable", name: "Sable Quist", pronouns: "she/her", portrait: "/cast/house-sable-v5.webp" },
  ],
  transcript: [
    { side: "a", dialogue: "You're here. Good. The wheel's already going too fast." },
    { side: "b", dialogue: "NELL! Yes, I'm here, the gull lost. Wobbliest bowl gets a party hat!" },
    { side: "a", dialogue: "A party hat is just a bribe. Are you planning to wobble on purpose for it?" },
    { side: "b", dialogue: "Wobble on purpose? I'd never insult the wheel like that." },
    { side: "a", dialogue: "Oh. Right. That's fair, it's a fair no. Can I ask one follow-up, though? Is thinking always the enemy of fun, or just in empty rooms?" },
    { side: "b", dialogue: "Honest answer? Only in empty rooms. And I said no before you'd even finished asking, which is my speed thing, and it wasn't fair to you." },
    { side: "a", dialogue: "Then I'm glad you grabbed a hat. Thank you for saying it straight, Sable." },
    { side: "b", dialogue: "Honest back, because you earned it: afterwards I go quiet." },
    { side: "a", dialogue: "I have to leave first, my shift's calling. Next time, the hypocaust." },
  ],
  diary: [
    { character_id: "house-nell", line: NELL_LINE },
    { character_id: "house-sable", line: SABLE_LINE },
  ],
} as CliffEpisode;

const film = (over: Partial<NonNullable<CliffEpisode["film"]>> = {}): NonNullable<CliffEpisode["film"]> => ({
  scenes: [
    { src: "/api/date-film/s0/scene.webp", caption: "Nell steadies the wheel" },
    { src: "/api/date-film/s1/scene.webp", caption: "Sable holds up a party hat" },
  ],
  confessionals: [
    { character_id: "house-nell", src: "/api/date-film/c0/clip.mp4", seconds: 6.31, line: NELL_LINE },
    { character_id: "house-sable", src: "/api/date-film/c1/clip.mp4", seconds: 5.81, line: SABLE_LINE },
  ],
  ...over,
});
const filmed = (over: Partial<NonNullable<CliffEpisode["film"]>> = {}): CliffEpisode => ({ ...date, film: film(over) });

describe("the confessional that may open the cut", () => {
  it("is the shorter filmed line of the two, with its side and its words", () => {
    expect(pickConfessional(filmed())).toEqual({ side: "b", line: SABLE_LINE, src: "/api/date-film/c1/clip.mp4", seconds: 5.81 });
  });

  it("is none when the date has no film, or none that may open it", () => {
    expect(pickConfessional(date)).toBeNull();
    expect(pickConfessional(filmed({ confessionals: [] }))).toBeNull();
    // Too long for a short's opening.
    expect(pickConfessional(filmed({ confessionals: [{ character_id: "house-nell", src: "/x.mp4", seconds: CONFESSIONAL_MAX_S + 0.1, line: NELL_LINE }] }))).toBeNull();
    // Someone who wasn't on the date, a clip with no address, and a line the date doesn't show as a diary line.
    expect(pickConfessional(filmed({ confessionals: [{ character_id: "house-juniper", src: "/x.mp4", seconds: 5, line: "A line." }] }))).toBeNull();
    expect(pickConfessional(filmed({ confessionals: [{ character_id: "house-nell", src: "", seconds: 5, line: NELL_LINE }] }))).toBeNull();
    expect(pickConfessional({ ...filmed(), diary: [] })).toBeNull();
  });

  it("never opens on a line that says how the date went", () => {
    const tells = [
      "Juniper called me the closest thing to a dear friend, so I know exactly where she's standing.",
      "I'd see her again in a heartbeat.",
      "He walked me home and I let him.",
      "It was a disaster and I loved every minute.",
      "I want another date with her.",
      "I asked for her number at the door.",
      "We ended the night at the bus stop.",
      "She kissed my cheek and I forgot my own name.",
    ];
    for (const line of tells) {
      expect(tellsAfter(line) || /date/.test(line), line).toBe(true);
      const e = { ...filmed({ confessionals: [{ character_id: "house-nell", src: "/c.mp4", seconds: 5, line }] }), diary: [{ character_id: "house-nell", line }] };
      expect(pickConfessional(e), line).toBeNull();
    }
    // The clip's own words are clean, but the whole diary line it was cut from isn't: still out.
    const cut = { ...filmed({ confessionals: [{ character_id: "house-nell", src: "/c.mp4", seconds: 5, line: "She told me why." }] }), diary: [{ character_id: "house-nell", line: "She told me why. I'd see her again tomorrow." }] };
    expect(pickConfessional(cut)).toBeNull();
    // The date's ending by its own name.
    const named = "An eighth date is what I'd call it, if anyone asked me.";
    expect(spoilerHits(named, date).length).toBeGreaterThan(0);
    expect(pickConfessional({ ...filmed({ confessionals: [{ character_id: "house-nell", src: "/c.mp4", seconds: 5, line: named }] }), diary: [{ character_id: "house-nell", line: named }] })).toBeNull();
    expect(AFTER_TALK.flags).toContain("i");
  });

  it("lets through a line about a moment, not an outcome", () => {
    for (const line of [NELL_LINE, SABLE_LINE, "Barnaby didn't rush me when I went quiet, and that's the only reason I said the Ottoline thing at all.", "She asked what I'm like with people I don't keep in my coat, and I haven't stopped hearing it since."]) {
      expect(tellsAfter(line), line).toBe(false);
    }
  });
});

describe("the cut of a date on film", () => {
  it("opens on the filmed confessional, then the hook, the reply and the question, and lists the scenes", () => {
    const edl = cliffhangerEdl(filmed(), { n: 4 });
    expect(edl.segments.map((s) => s.kind)).toEqual(["diary", "cold", "line", "card"]);
    expect(edl.segments[0]).toEqual({ kind: "diary", side: "b", label: "Sable · diary cam", clip: { src: "/api/date-film/c1/clip.mp4", seconds: 5.81, line: SABLE_LINE } });
    expect(edl.scenes).toEqual([
      { src: "/api/date-film/s0/scene.webp", caption: "Nell steadies the wheel" },
      { src: "/api/date-film/s1/scene.webp", caption: "Sable holds up a party hat" },
    ]);
    // The beats resolve against the public record: the diary beat is that character's own public line.
    const beats = resolveBeats(edl, [filmed()]);
    expect(beats[0]).toMatchObject({ kind: "diary", text: SABLE_LINE, label: "Sable · diary cam" });
    expect(beats[0].speaker?.id).toBe("house-sable");
    // Nothing in it says how it ended.
    expect(spoilerHits(cutText(edl, [filmed()]), filmed())).toEqual([]);
    expect(cutText(edl, [filmed()])).toContain(SABLE_LINE);
  });

  it("is the same three beats as ever without film, or when told to leave it out", () => {
    const plain = cliffhangerEdl(date, { n: 4 });
    expect(plain.segments.map((s) => s.kind)).toEqual(["cold", "line", "card"]);
    expect(plain.scenes).toBeUndefined();
    expect(cliffhangerEdl(filmed(), { n: 4, film: false })).toEqual(plain);
    // Scenes without a confessional that may open it: the three beats, over the scenes.
    const scenesOnly = cliffhangerEdl(filmed({ confessionals: [] }), { n: 4 });
    expect(scenesOnly.segments.map((s) => s.kind)).toEqual(["cold", "line", "card"]);
    expect(scenesOnly.scenes).toHaveLength(2);
    expect(filmScenes(date)).toEqual([]);
  });

  it("runs a filmed confessional exactly as long as its clip, and still holds the question", () => {
    const beats = resolveBeats(cliffhangerEdl(filmed(), { n: 4 }), [filmed()]);
    const fixed: (number | undefined)[] = [];
    fixed[0] = 5.81;
    const secs = cliffSeconds(beats, [5.26, 3.1, 2.8, 3.9], fixed);
    expect(secs[0]).toBe(5.81);
    expect(secs.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(CLIFF.min);
    // Without a fixed beat, nothing changed.
    expect(cliffSeconds(beats.slice(1), [3.1, 2.8, 3.9])).toEqual(cliffSeconds(beats.slice(1), [3.1, 2.8, 3.9], []));
  });
});

describe("which picture each beat shows", () => {
  const beats: { kind: "diary" | "cold" | "line" | "card" }[] = [{ kind: "diary" }, { kind: "cold" }, { kind: "line" }, { kind: "card" }];
  const starts = [0, 5.81, 10.2, 14.4];
  const seconds = [5.81, 4.39, 4.2, 3.6];

  it("is the clip for its own beat, a scene a line in order, and the last scene behind the question", () => {
    expect(shotPlan(beats, { starts, seconds, clipAt: 0, clip: "/t/open.mp4", scenes: ["/t/s0.png", "/t/s1.png", "/t/s2.png"] })).toEqual([
      { kind: "clip", file: "/t/open.mp4", at: 0, secs: 5.81 },
      { kind: "scene", file: "/t/s0.png", at: 5.81, secs: 4.39 },
      { kind: "scene", file: "/t/s1.png", at: 10.2, secs: 4.2 },
      { kind: "scene", file: "/t/s1.png", at: 14.4, secs: 3.6 },
    ]);
  });

  it("repeats the one scene a date has, and shows nothing over the faces without any", () => {
    expect(shotPlan(beats, { starts, seconds, clipAt: 0, clip: "/t/open.mp4", scenes: ["/t/s0.png"] }).map((s) => s.file)).toEqual(["/t/open.mp4", "/t/s0.png", "/t/s0.png", "/t/s0.png"]);
    expect(shotPlan(beats, { starts, seconds, clipAt: 0, clip: "/t/open.mp4", scenes: [] })).toEqual([{ kind: "clip", file: "/t/open.mp4", at: 0, secs: 5.81 }]);
    expect(shotPlan(beats.slice(1), { starts: [0, 4.4, 8.6], seconds: [4.4, 4.2, 3.6] })).toEqual([]);
  });
});

describe("the ffmpeg graph with pictures over the tiles", () => {
  const base = {
    background: "/t/base.png",
    faces: [],
    tops: [
      { file: "/t/top0.png", secs: 5.81 },
      { file: "/t/top1.png", secs: 4.39 },
    ],
    voices: [
      { file: "/t/open.mp4", at: 0 },
      { file: "/t/v1.mp3", at: 5.93 },
    ],
    total: 10.2,
    out: "/t/post.mp4",
  };
  const shots = [
    { kind: "clip" as const, file: "/t/open.mp4", at: 0, secs: 5.81 },
    { kind: "scene" as const, file: "/t/s0.png", at: 5.81, secs: 4.39 },
  ];

  it("lays the clip and the scene over both tiles, each in its own stretch, under the words", () => {
    const args = cliffArgs({ ...base, shots });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(SHOT_AREA).toEqual({ x: 0, y: TILES[0].y, w: 1080, h: TILES[0].h });
    // The clip: played once from its start, cropped to the picture's space, shown only for its beat.
    expect(graph).toContain(`[1:v]fps=30,scale=1080:${TILES[0].h}:force_original_aspect_ratio=increase,crop=1080:${TILES[0].h}:(iw-ow)/2:(ih-oh)*0.12,setsar=1,format=yuv420p,setpts=PTS-STARTPTS+0.000/TB[s0]`);
    expect(graph).toContain(`[bg][s0]overlay=0:${TILES[0].y}:eof_action=pass:enable='between(t,0.000,5.810)'[su0]`);
    // The scene: a still pushed in slowly, starting where its beat does.
    expect(graph).toMatch(/\[2:v\]scale=2160:\d+:force_original_aspect_ratio=increase,crop=2160:\d+:\(iw-ow\)\/2:\(ih-oh\)\*0\.2,zoompan=z='1\+0\.080\*on\/132'/);
    expect(graph).toContain("setpts=PTS-STARTPTS+5.810/TB[s1]");
    expect(graph).toContain(`[su0][s1]overlay=0:${TILES[0].y}:eof_action=pass:enable='between(t,5.810,10.200)'[su1]`);
    // The words go over the last picture, and the clip isn't looped.
    expect(graph).toContain("[3:v][4:v]concat=n=2:v=1:a=0,format=rgba[top]");
    expect(graph).toContain("[su1][top]overlay=0:0");
    expect(args.join(" ")).not.toContain("-stream_loop -1 -i /t/open.mp4");
    // Its own sound starts with it; the voiced line comes after.
    expect(graph).toContain("[5:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=0|0[a0]");
    expect(graph).toContain("adelay=5930|5930[a1]");
    expect(args.filter((a) => a === "/t/open.mp4")).toHaveLength(2);
  });

  it("is what it always was with no pictures", () => {
    const plain = { ...base, faces: [{ file: "/t/f0.mp4", kind: "loop" as const }, { file: "/t/f1.png", kind: "still" as const }] };
    expect(cliffArgs({ ...plain, shots: [] })).toEqual(cliffArgs(plain));
    expect(cliffArgs(plain).join(" ")).not.toContain("between(t,");
  });
});

describe("the layer over a picture", () => {
  it("has the words and the label, and no tiles to light or seam between them", () => {
    const beats = resolveBeats(cliffhangerEdl(filmed(), { n: 4 }), [filmed()]);
    const over = layerHtml(beats[0], { e: filmed(), n: 4, plain: true });
    expect(over).toContain("Sable · diary cam");
    expect(over).toContain("She asks a follow-up");
    expect(over).not.toContain('class="tile');
    expect(over).not.toContain('class="seam"');
    const tiles = layerHtml(beats[1], { e: filmed(), n: 4 });
    expect(tiles).toContain('class="tile');
    expect(tiles).toContain('class="seam"');
  });
});

describe("a film file's kind", () => {
  it("is read from its first bytes", () => {
    expect(fileKind(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(8)]))).toBe("mp4");
    expect(fileKind(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("webp");
    expect(fileKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("png");
    expect(fileKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpg");
    expect(fileKind(Buffer.from("<!doctype html><html>"))).toBeNull();
  });
});

describe("asking the site to film the date", () => {
  const calls: { url: string; headers: Headers; body: string }[] = [];
  const site = (status: number, body: string) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response(body, { status });
    }) as typeof fetch;

  it("posts the date with the admin key and reads the streamed answer", async () => {
    calls.length = 0;
    const answer = { ok: true, stopped: "done", scenes: { drawn: 3, note: null }, confessionals: { made: 2, note: null }, spent_usd: 0.2331, film: { scenes: [], confessionals: [] } };
    const got = await askForFilm("ep7", "https://botchelor.test", { key: "the-key", fetchImpl: site(200, `\n\n\n${JSON.stringify(answer)}`), env: {} });
    expect(got).toMatchObject({ ok: true, why: null, made: "3 scene(s) drawn, 2 confessional(s) filmed, 0.23 dollars spent" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://botchelor.test/api/admin/date-film");
    expect(calls[0].headers.get("x-frontier-key")).toBe("the-key");
    expect(JSON.parse(calls[0].body)).toEqual({ episode: "ep7" });
  });

  it("says why when it isn't filmed, and asks nobody without a key or with the ask off", async () => {
    calls.length = 0;
    expect(await askForFilm("ep7", "https://botchelor.test", { key: null, fetchImpl: site(200, "{}"), env: {} })).toEqual({ ok: false, why: "no admin key, so the date isn't filmed" });
    expect(await askForFilm("ep7", "https://botchelor.test", { key: "k", fetchImpl: site(200, "{}"), env: { DATE_FILM_ASK: "0" } })).toEqual({ ok: false, why: null });
    expect(calls).toHaveLength(0);
    expect((await askForFilm("ep7", "https://botchelor.test", { key: "k", fetchImpl: site(404, JSON.stringify({ error: "off", message: "DATE_FILM is off." })), env: {} })).why).toBe("the site didn't film it (DATE_FILM is off.)");
    expect((await askForFilm("ep7", "https://botchelor.test", { key: "k", fetchImpl: site(200, JSON.stringify({ ok: false, stopped: "not_aired" })), env: {} })).why).toBe("the site didn't film it (not_aired)");
    // The budget spent is still an answer: the cut is made from what's there, and the note says so.
    const spent = { ok: true, stopped: "done", scenes: { drawn: 0, note: null }, confessionals: { made: 0, note: "the day's or the month's film budget is spent" }, spent_usd: 0 };
    expect((await askForFilm("ep7", "https://botchelor.test", { key: "k", fetchImpl: site(200, JSON.stringify(spent)), env: {} })).made).toContain("film budget is spent");
  });
});

describe("the film is never required", () => {
  const cliff = readFileSync("scripts/clips/cliffhanger.mjs", "utf8");
  const daily = readFileSync("scripts/clips/daily-episode.mjs", "utf8");

  it("cuts the date without its film when the film can't be used, and checks both cuts for the ending", () => {
    expect(cliff).toContain("const edl = cliffhangerEdl(e, { n: day, film: false });");
    expect(cliff).toContain("if (hasFilm && !spoilerHits(cutText(filmed, [e]), e).length) {");
    expect(cliff).toContain("cutting it without");
    expect(cliff).toContain("return cutCliffhanger(edl, e, { base, posts, out, day, log });");
    expect(cliff).toContain('if (clipAt >= 0 && !clip) throw new Error("the filmed confessional couldn\'t be fetched");');
  });

  it("asks for the film only for the cliffhanger, and a failed ask stops nothing", () => {
    expect(daily).toContain("const asked = await askForFilm(id, base).catch((err) => ({ ok: false, why: err?.message ?? String(err) }));");
    expect(daily).toContain("if (asked?.ok) [e] = await fetchEpisodes([id], base);");
  });
});
