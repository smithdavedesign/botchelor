// The daily clip's web loop for the home page (scripts/clips/daily-clip.mjs, lib/home-clip.ts): which seconds it shows,
// how ffmpeg is asked for it, the --upload mode's arguments, where the key comes from, and what an upload reports.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adminKey, dayOfClip, makeWebCut, parseUpload, posterArgs, uploadWebClip, WEB_CUT, WEB_LOOP, WEB_LOOP_FROM, webCutArgs, webLoopArgs, webLoopWindow } from "../scripts/clips/daily-clip.mjs";

describe("webLoopWindow", () => {
  it("starts just after the first line appears and ends a second after a line landed, 10 to 14 seconds on", () => {
    // Lines at 2.1, 6, 9.5, 12.8, 16, 20: from 2.3; 12.8 + 1 − 2.3 = 11.5 fits, 16 + 1 − 2.3 = 14.7 doesn't.
    expect(webLoopWindow([2.1, 6, 9.5, 12.8, 16, 20], 55)).toEqual({ start: 2.3, seconds: 11.5 });
  });
  it("is twelve seconds when no line lands in the window, and skips marks it never saw", () => {
    expect(webLoopWindow([null, 3, null, 30], 55)).toEqual({ start: 3.2, seconds: WEB_LOOP.target });
  });
  it("starts where it's told when nobody measured the clip (an --upload), two seconds in by default", () => {
    expect(webLoopWindow(null, 55)).toEqual({ start: WEB_LOOP_FROM, seconds: 12 });
    expect(webLoopWindow([], 55, 4.5)).toEqual({ start: 4.5, seconds: 12 });
  });
  it("never runs past the clip's end, and starts at 0 when the start would leave almost nothing", () => {
    expect(webLoopWindow([1], 8)).toEqual({ start: 1.2, seconds: 6.8 });
    expect(webLoopWindow(null, 4)).toEqual({ start: 0, seconds: 4 });
    for (const total of [3, 9, 20, 75]) {
      const w = webLoopWindow([0.5, 5, 11, 13], total);
      expect(w.start + w.seconds).toBeLessThanOrEqual(total + 0.01);
      expect(w.seconds).toBeLessThanOrEqual(WEB_LOOP.max);
    }
  });
});

describe("the ffmpeg arguments", () => {
  it("cut a muted, 480-wide, H.264 faststart loop with a capped bitrate", () => {
    const args = webLoopArgs({ src: "in.mp4", out: "out.mp4", start: 2.3, seconds: 11.5 });
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 6)).toEqual(["-ss", "2.3", "-t", "11.5", "-i", "in.mp4"]);
    expect(args).toContain("-an");
    expect(args[args.indexOf("-vf") + 1]).toContain("scale=480:854");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    // 700 kbit/s × 14 s is about 1.2 MB: under the 1.5 MB aim whatever the picture does.
    expect(args[args.indexOf("-maxrate") + 1]).toBe("700k");
    expect((700_000 / 8) * WEB_LOOP.max).toBeLessThan(1_500_000);
    expect(WEB_LOOP.maxBytes).toBeLessThan(1_500_000);
    expect(args.at(-1)).toBe("out.mp4");
    expect(webLoopArgs({ src: "a", out: "b", start: 0, seconds: 1, crf: 36 })).toContain("36");
  });
  it("cut the whole clip for the date's page: voices kept, 540 wide, H.264 faststart, a capped bitrate", () => {
    const args = webCutArgs({ src: "in.mp4", out: "cut.mp4" });
    expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 2)).toEqual(["-i", "in.mp4"]);
    // The whole clip: no start, no length, and the voices stay.
    expect(args).not.toContain("-ss");
    expect(args).not.toContain("-t");
    expect(args).not.toContain("-an");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    expect(args[args.indexOf("-vf") + 1]).toContain("scale=540:960");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    // 900 kbit/s of picture and 96 of voice, for the longest cut the route takes, stays under the route's 20 MB stop.
    expect(args[args.indexOf("-maxrate") + 1]).toBe("900k");
    expect(args[args.indexOf("-b:a") + 1]).toBe("96k");
    expect(((900_000 + 96_000) / 8) * WEB_CUT.maxSeconds).toBeLessThan(20_000_000);
    expect(args.at(-1)).toBe("cut.mp4");
    expect(webCutArgs({ src: "a", out: "b", crf: 35 })).toContain("35");
  });
  it("make no cut of a clip longer than the route takes, or of one with no length", () => {
    expect(makeWebCut({ mp4: "in.mp4", dir: "/nowhere", name: "x", seconds: WEB_CUT.maxSeconds + 1, ffmpeg: "/bin/false" })).toBeNull();
    expect(makeWebCut({ mp4: "in.mp4", dir: "/nowhere", name: "x", seconds: 0, ffmpeg: "/bin/false" })).toBeNull();
  });
  it("take the poster from the loop's own first frame", () => {
    const args = posterArgs({ src: "in.mp4", out: "p.jpg", start: 2.3 });
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual(["-ss", "2.3", "-i", "in.mp4"]);
    expect(args.slice(args.indexOf("-frames:v"), args.indexOf("-frames:v") + 2)).toEqual(["-frames:v", "1"]);
    expect(args.at(-1)).toBe("p.jpg");
  });
});

describe("--upload", () => {
  it("reads the clip, the date and the options, and is null for a daily run", () => {
    expect(parseUpload([])).toBeNull();
    expect(parseUpload(["some-episode-id", "--silent"])).toBeNull();
    expect(parseUpload(["--upload", "/clips/2026-11-15-a-b.mp4", "--episode", "abc-123"])).toEqual({ file: "/clips/2026-11-15-a-b.mp4", episode: "abc-123", from: WEB_LOOP_FROM, dry: false });
    expect(parseUpload(["--episode", "abc", "--dry", "--from", "3.5", "--upload", "x.mp4"])).toEqual({ file: "x.mp4", episode: "abc", from: 3.5, dry: true });
  });
  it("refuses half of it", () => {
    expect(() => parseUpload(["--upload", "x.mp4"])).toThrow(/usage/);
    expect(() => parseUpload(["--upload", "--episode", "abc"])).toThrow(/usage/);
    expect(() => parseUpload(["--upload", "x.mp4", "--episode", "abc", "--from", "soon"])).toThrow(/--from/);
  });
  it("reads the day from the clip's name", () => {
    expect(dayOfClip("/Users/x/BotchelorClips/2026-11-15-rudiger-ottoline.mp4")).toBe("2026-11-15");
    expect(dayOfClip("2026-11-15-a-b.mp4")).toBe("2026-11-15");
    expect(dayOfClip("/clips/barnaby-boardwalk-final.mp4")).toBeNull();
  });
});

describe("the admin password", () => {
  it("comes from the run's environment first, else the keychain, else there is none", () => {
    const fromEnv = ["env", "pass"].join("-");
    const fromChain = ["chain", "pass"].join("-");
    expect(adminKey({ FRONTIER_PASSWORD: ` ${fromEnv} ` }, () => fromChain)).toBe(fromEnv);
    expect(adminKey({}, () => `${fromChain}\n`)).toBe(fromChain);
    expect(adminKey({}, () => "")).toBeNull();
    expect(
      adminKey({}, () => {
        throw new Error("no such item");
      }),
    ).toBeNull();
  });
  it("is never written into the script, and the script never prints it", () => {
    const src = readFileSync(join(__dirname, "..", "scripts", "clips", "daily-clip.mjs"), "utf8");
    // Read with `security … -w` into a variable that only ever goes into the request's header.
    expect(src).toContain('"find-generic-password", "-s", "vault/botchelor/FRONTIER_PASSWORD", "-w"');
    expect(src.match(/\bkey\b[^\n]*console\.(log|error)|console\.(log|error)\([^\n]*\bkey\b/g)).toBeNull();
  });
});

describe("uploadWebClip", () => {
  const dir = mkdtempSync(join(tmpdir(), "bz-webclip-"));
  const loop = join(dir, "l.mp4");
  const poster = join(dir, "p.jpg");
  writeFileSync(loop, Buffer.from("loop-bytes"));
  writeFileSync(poster, Buffer.from("poster-bytes"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const secret = ["k", "9"].join("-");
  const base = { base: "https://show.example", key: secret, episode: "abc-123", day: "2026-11-15", loop, poster, seconds: 11.5 };

  it("posts the form with the key in the header only", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const res = await uploadWebClip({
      ...base,
      send: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response(JSON.stringify({ ok: true, id: "clip-1" }), { status: 200 });
      }) as typeof fetch,
    });
    expect(res).toEqual({ ok: true, status: 200, error: null, id: "clip-1" });
    expect(seen!.url).toBe("https://show.example/api/admin/home-clip");
    expect((seen!.init.headers as Record<string, string>)["x-frontier-key"]).toBe(secret);
    const form = seen!.init.body as FormData;
    expect(Object.fromEntries(["episode", "day", "width", "height", "seconds"].map((k) => [k, form.get(k)]))).toEqual({ episode: "abc-123", day: "2026-11-15", width: "480", height: "854", seconds: "11.5" });
    expect(await (form.get("loop") as Blob).text()).toBe("loop-bytes");
    expect(await (form.get("poster") as Blob).text()).toBe("poster-bytes");
    expect([...form.values()].some((v) => v === secret)).toBe(false);
  });

  it("sends the cut and its length when there is one, and neither when there isn't", async () => {
    const cut = join(dir, "clip-cut.mp4");
    writeFileSync(cut, Buffer.from("cut-bytes"));
    const forms: FormData[] = [];
    const send = (async (_url: string, init: RequestInit) => {
      forms.push(init.body as FormData);
      return new Response(JSON.stringify({ ok: true, id: "clip-1" }), { status: 200 });
    }) as typeof fetch;
    await uploadWebClip({ ...base, cut, cutSeconds: 64.5, send });
    await uploadWebClip({ ...base, send });
    expect(await (forms[0].get("cut") as Blob).text()).toBe("cut-bytes");
    expect(forms[0].get("cut_seconds")).toBe("64.5");
    expect(forms[1].get("cut")).toBeNull();
    expect(forms[1].get("cut_seconds")).toBeNull();
  });

  it("reports the route's refusal, and a network failure, without throwing", async () => {
    const refused = await uploadWebClip({ ...base, send: (async () => new Response(JSON.stringify({ error: "not_aired" }), { status: 409 })) as typeof fetch });
    expect(refused).toEqual({ ok: false, status: 409, error: "not_aired", id: null });
    const down = await uploadWebClip({
      ...base,
      send: (async () => {
        throw new Error("ECONNRESET");
      }) as typeof fetch,
    });
    expect(down.ok).toBe(false);
    expect(down.error).toContain("network");
    expect(JSON.stringify([refused, down])).not.toContain(secret);
  });
});
