// The Mac's half of requested clips (scripts/clips/clip-queue.mjs): the edit of the date (the daily episode's, outside
// the series, closing on the credit card), the credit burned into every frame, which failures are worth another try,
// the secret, and one request from claim to done (or failed) with the show and the renderer stood in.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { creditCard, doneForm, processOne, requestEdl, retryable, workerSecret } from "../scripts/clips/clip-queue.mjs";
import { frameHtml, resolveBeats } from "../scripts/clips/episode-cut.mjs";

const date = {
  id: "ep9",
  title: "Midnight Among The Poetry Cats",
  venue: "late_bookshop",
  ending: "second_date",
  why: "A ninth date: chemistry 74 carried it.",
  share_path: "/episodes/ep9",
  best_line: "I'd rather hold the other end of the hat.",
  characters: [
    { id: "c-nell", name: "Nell Arden", pronouns: "she/her", portrait: "/api/assets/n" },
    { id: "house-sable", name: "Sable Quist", pronouns: "she/her", portrait: "/cast/s.webp" },
  ],
  transcript: [
    { side: "a" as const, dialogue: "Sable. You came in on time." },
    { side: "b" as const, dialogue: "Four whole seconds of quiet, a personal record!" },
    { side: "a" as const, dialogue: "I counted them. Out loud, in my head." },
    { side: "b" as const, dialogue: "Oh. Okay. So the stranger gets to keep their sad little quiet." },
    { side: "a" as const, dialogue: "That was a flat no. I'm sorry, Sable. I'd rather hold the other end of the hat. Truly." },
    { side: "b" as const, dialogue: "Okay. You said sorry, and you meant it." },
  ],
};
const CREDIT = "Nell Arden by @dave · botchelor.com";
const claimed = { id: "clip1", attempt: 2, episode_id: "ep9", character_id: "c-nell", side: "a", credit: CREDIT, caption: "My OC Nell Arden…", episode: date };

describe("the requested clip's edit", () => {
  it("is the daily episode's cut outside the series, closing on the credit card", () => {
    const edl = requestEdl(date, claimed);
    expect(edl.direction).toBe("requested clip");
    expect(edl.episodes).toEqual(["ep9"]);
    expect(edl.segments[0]).toMatchObject({ kind: "cold", label: "A blind date on Botchelor" });
    expect(edl.segments[1]).toMatchObject({ kind: "title", kicker: "Botchelor" });
    expect(JSON.stringify(edl)).not.toContain("Day ");
    expect(edl.segments.at(-1)).toEqual(creditCard(CREDIT));
    // Every quoted word is the date's own: the beats resolve against the date as it is.
    const beats = resolveBeats(edl, [date]);
    expect(beats[0].text).toBe("I'd rather hold the other end of the hat.");
  });

  it("burns the credit into every frame, and no frame without one gets it", () => {
    const beats = resolveBeats(requestEdl(date, claimed), [date]);
    for (const b of beats) expect(frameHtml(b, { base: "https://botchelor.com", credit: CREDIT })).toContain(`<p class="credit">Nell Arden by @dave · botchelor.com</p>`);
    expect(frameHtml(beats[0], { base: "https://botchelor.com" })).not.toContain('class="credit"');
    expect(frameHtml(beats[0], { base: "https://botchelor.com", credit: "<b>x</b>" })).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("can't cut a date with too few lines", () => {
    expect(() => requestEdl({ ...date, transcript: date.transcript.slice(0, 2) }, claimed)).toThrow(/spoken lines/);
  });

  it("tries again only what might go better the second time", () => {
    expect(retryable("edit", "anything")).toBe(false);
    expect(retryable("render", "the cut runs 101.0 s, over 95: trim it")).toBe(false);
    expect(retryable("render", "Venice: HTTP 503")).toBe(true);
    expect(retryable("render", "done: HTTP 502")).toBe(true);
  });

  it("reads the secret from the run, else the keychain, else none", () => {
    expect(workerSecret({ CLIP_WORKER_SECRET: " s3cret " }, () => "kc")).toBe("s3cret");
    expect(workerSecret({}, () => "from-keychain\n")).toBe("from-keychain");
    expect(
      workerSecret({}, () => {
        throw new Error("no item");
      }),
    ).toBeNull();
  });

  it("sends the clip, its cover and the claim's attempt", () => {
    const f = doneForm({ id: "clip1", attempt: 2, seconds: 31.456, clip: new Uint8Array([1, 2]), poster: new Uint8Array([3]) });
    expect(f.get("id")).toBe("clip1");
    expect(f.get("attempt")).toBe("2");
    expect(f.get("seconds")).toBe("31.46");
    expect(f.get("clip")).toBeInstanceOf(Blob);
    expect(f.get("poster")).toBeInstanceOf(Blob);
  });
});

describe("one request, claim to done", () => {
  type Call = { url: string; init?: RequestInit };
  function show(request: unknown, answers: Record<string, number> = {}) {
    const calls: Call[] = [];
    const f = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const path = new URL(url).pathname;
      if (path.endsWith("/claim")) return new Response(JSON.stringify({ request }), { status: answers.claim ?? 200 });
      return new Response(JSON.stringify({ ok: true }), { status: answers[path.split("/").at(-1)!] ?? 200 });
    };
    return { calls, f };
  }
  const quiet = () => {};

  it("does nothing when the queue is empty", async () => {
    const { calls, f } = show(null);
    expect(await processOne({ base: "https://botchelor.com", secret: "s", f, log: quiet })).toBe("none");
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe("Bearer s");
  });

  it("renders with the credit and caption it was given and sends the files back", async () => {
    const { calls, f } = show(claimed);
    let opts: { credit?: string | null; caption?: string | null; base: string } | null = null;
    const render = (async (_edl: unknown, eps: unknown[], o: { out: string; credit?: string | null; caption?: string | null; base: string }) => {
      opts = o;
      expect(eps).toEqual([date]);
      writeFileSync(join(o.out, "post.mp4"), Buffer.from("mp4"));
      writeFileSync(join(o.out, "cover.png"), Buffer.from("png"));
      return { total: 30.2, beats: [], seconds: [], voices: "macOS say" };
    }) as never;
    expect(await processOne({ base: "https://botchelor.com", secret: "s", f, render, log: quiet })).toBe("done");
    expect(opts).toMatchObject({ credit: CREDIT, caption: claimed.caption, base: "https://botchelor.com" });
    const sent = calls.find((c) => c.url.endsWith("/api/clips/worker/done"))!;
    const form = sent.init?.body as FormData;
    expect(form.get("id")).toBe("clip1");
    expect(form.get("attempt")).toBe("2");
    expect(form.get("seconds")).toBe("30.2");
  });

  it("reports a date it can't cut as failed for good, and a render failure as worth another try", async () => {
    const short = show({ ...claimed, episode: { ...date, transcript: date.transcript.slice(0, 1) } });
    expect(await processOne({ base: "https://botchelor.com", secret: "s", f: short.f, log: quiet })).toBe("failed");
    const report = JSON.parse(String(short.calls.at(-1)!.init?.body));
    expect(report).toMatchObject({ id: "clip1", attempt: 2, retry: false });

    const flaky = show(claimed);
    const render = (async () => {
      throw new Error("Venice: HTTP 503");
    }) as never;
    expect(await processOne({ base: "https://botchelor.com", secret: "s", f: flaky.f, render, log: quiet })).toBe("failed");
    expect(JSON.parse(String(flaky.calls.at(-1)!.init?.body))).toMatchObject({ retry: true, error: "Venice: HTTP 503" });
  });

  it("stops when the show turns the claim away (a wrong secret)", async () => {
    const { f } = show(null, { claim: 404 });
    await expect(processOne({ base: "https://botchelor.com", secret: "s", f, log: quiet })).rejects.toThrow(/HTTP 404/);
  });
});
