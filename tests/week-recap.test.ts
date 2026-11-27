// The week in review (lib/week-recap.ts, 2026-11-24): which week is meant, the week's list (GET /api/week), the admin
// upload's refusals, the public file route (byte ranges, taken down with any of its dates), and the pages (/week and
// /week/<monday>: the video, a card a date, the empty state, the switch).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/week",
  useSearchParams: () => new URLSearchParams(),
}));
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { POST as upload } from "@/app/api/admin/week-recap/route";
import { GET as weekList } from "@/app/api/week/route";
import { GET as recapFile } from "@/app/api/week-recap/[id]/[file]/route";
import WeekPage, { generateMetadata as weekMeta } from "@/app/week/page";
import WeekOfPage, { generateMetadata as weekOfMeta } from "@/app/week/[id]/page";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setObjectStoreForTests, type ObjectStore } from "@/lib/object-store";
import { weekIdOf, weekWindow } from "@/lib/season-window";
import { latestWeekRecap, RECAP_MAX_BYTES, RECAP_MAX_DATES, recapNeighbours, recapWeek, weekBest, weekLabel, weekOfId, weekRecap, weekRecapOn } from "@/lib/week-recap";
import { api, BASE_URL, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

const KEY = ["owner", "pass", "recap"].join("-");
/** The smallest things the route takes for an MP4 and a JPEG: the right first bytes (it never decodes them). */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(40, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 3)]);
const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;
const LINES = ["So you review fountains?", "Only the ones that deserve it.", "And this one?", "A four. It's trying too hard.", "Harsh.", "Fair."].map((dialogue, i) => ({ side: i % 2 ? "b" : "a", dialogue }));

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.stubEnv("FRONTIER_PASSWORD", KEY);
  setObjectStoreForTests(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setObjectStoreForTests(undefined);
});

const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** This week's Monday and last week's, as ids. */
const THIS_WEEK = () => weekIdOf(new Date());
const LAST_WEEK = () => weekIdOf(new Date(weekWindow(new Date()).start.getTime() - 1));

/** A date with a house character, public; `aired`: revealed now, or at `airedAt`. */
async function date(name: string, opts: { aired?: boolean; airedAt?: Date; partner?: number } = {}) {
  const owner = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name }), owner)).json()).id as string;
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[opts.partner ?? 0].id }, owner)).json();
  await t.db.query(`update episodes set visibility = 'public', transcript = $2::jsonb where id = $1`, [ep.id, JSON.stringify(LINES)]);
  if (opts.aired !== false) expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  else await t.db.query(`update episodes set revealed_at = null where id = $1`, [ep.id]);
  if (opts.airedAt) await t.db.query(`update episodes set revealed_at = $2 where id = $1`, [ep.id, opts.airedAt.toISOString()]);
  return { owner, character, id: ep.id as string, name };
}

function form(episodes: string[], over: Record<string, string | Blob | null> = {}) {
  const f = new FormData();
  const fields: Record<string, string | Blob | null> = {
    week: THIS_WEEK(),
    episodes: episodes.join(","),
    width: "540",
    height: "960",
    seconds: "62.4",
    video: new Blob([new Uint8Array(MP4)], { type: "video/mp4" }),
    poster: new Blob([new Uint8Array(JPEG)], { type: "image/jpeg" }),
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) if (v !== null) f.set(k, v);
  return f;
}
const send = (body: FormData, key: string | null = KEY) => upload(new Request(`${BASE_URL}/api/admin/week-recap`, { method: "POST", headers: key ? { "x-frontier-key": key } : {}, body }));
const file = (id: string, name: string, headers: Record<string, string> = {}) => recapFile(new Request(`${BASE_URL}/api/week-recap/${id}/${name}`, { headers }), { params: Promise.resolve({ id, file: name }) });
const list = (query = "") => weekList(new Request(`${BASE_URL}/api/week${query}`));

describe("which week", () => {
  it("is on unless WEEK_RECAP is 0", () => {
    expect(weekRecapOn({})).toBe(true);
    expect(weekRecapOn({ WEEK_RECAP: "0" })).toBe(false);
  });

  it("names a week by its Monday (UTC), and only by its Monday", () => {
    expect(weekOfId("2026-11-16")).toMatchObject({ id: "2026-11-16" });
    expect(weekOfId("2026-11-16")!.to.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(weekOfId("2026-11-17")).toBeNull();
    expect(weekOfId("2026-13-40")).toBeNull();
    expect(weekOfId("last week")).toBeNull();
  });

  it("means the last complete week unless asked for the current one or a named one, never one still to come", () => {
    const tuesday = new Date("2026-11-24T22:00:00Z");
    expect(recapWeek(tuesday)!.id).toBe("2026-11-16");
    expect(recapWeek(tuesday, "")!.id).toBe("2026-11-16");
    expect(recapWeek(tuesday, "current")!.id).toBe("2026-11-23");
    expect(recapWeek(tuesday, "2026-11-09")!.id).toBe("2026-11-09");
    expect(recapWeek(tuesday, "2026-11-30")).toBeNull();
    expect(recapWeek(tuesday, "2026-11-18")).toBeNull();
    // Sunday evening Pacific is Monday in UTC: the week that just ended is the complete one.
    expect(recapWeek(new Date("2026-11-23T01:00:00Z"))!.id).toBe("2026-11-16");
  });

  it("says a week as its seven days", () => {
    expect(weekLabel(weekOfId("2026-11-16")!)).toBe("Nov 16 to 22");
    expect(weekLabel(weekOfId("2026-11-30")!)).toBe("Nov 30 to Dec 6");
  });
});

describe("GET /api/week: the week's dates", () => {
  it("lists what aired this week between public characters, with only what the date's page shows", async () => {
    const a = await date("Pell Ardent");
    const res = await list("?week=current");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.week).toMatchObject({ id: THIS_WEEK(), complete: false });
    expect(body.week.label).toMatch(/ to /);
    expect(body.dates).toHaveLength(1);
    expect(Object.keys(body.dates[0]).sort()).toEqual(["aired_at", "ending", "grade", "id", "names", "title"]);
    expect(body.dates[0]).toMatchObject({ id: a.id, names: ["Pell Ardent", HOUSE_CHARACTERS[0].name] });
    expect(body.dates[0].ending).toMatch(/second date/i);
    // By default: the last complete week, which this date isn't in.
    expect((await (await list()).json()).dates).toEqual([]);
    expect((await (await list()).json()).week).toMatchObject({ id: LAST_WEEK(), complete: true });
  });

  it("leaves out a date that hasn't aired, a private one, and one with a private character", async () => {
    const kept = await date("Pell Ardent");
    await date("Ines Rook", { aired: false });
    const priv = await date("Dara Venn", { partner: 1 });
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [priv.id]);
    const shy = await date("Lio Marsh", { partner: 2 });
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [shy.character]);
    const dates = (await (await list("?week=current")).json()).dates as { id: string }[];
    expect(dates.map((d) => d.id)).toEqual([kept.id]);
  });

  it("finds a named week's dates, and refuses a week that isn't one", async () => {
    const lastWeek = new Date(weekWindow(new Date()).start.getTime() - 2 * 24 * 60 * 60 * 1000);
    const old = await date("Pell Ardent", { airedAt: lastWeek });
    expect(((await (await list()).json()).dates as { id: string }[]).map((d) => d.id)).toEqual([old.id]);
    expect(((await (await list(`?week=${LAST_WEEK()}`)).json()).dates as { id: string }[]).map((d) => d.id)).toEqual([old.id]);
    expect((await (await list("?week=current")).json()).dates).toEqual([]);
    const bad = await list("?week=yesterday");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_week");
    expect(await weekBest(t.db, recapWeek(new Date(), LAST_WEEK())!, 0)).toEqual([]);
  });

  it("answers 404 when the recap is switched off", async () => {
    vi.stubEnv("WEEK_RECAP", "0");
    expect((await list()).status).toBe(404);
  });
});

describe("POST /api/admin/week-recap", () => {
  it("needs the admin password", async () => {
    const d = await date("Pell Ardent");
    expect((await send(form([d.id]), null)).status).toBe(403);
    expect((await send(form([d.id]), "wrong")).status).toBe(403);
    const res = await upload(new Request(`${BASE_URL}/api/admin/week-recap`, { method: "POST", headers: { cookie: d.owner }, body: form([d.id]) }));
    expect(res.status).toBe(403);
    expect((await t.db.query("select 1 from week_recaps")).rows).toHaveLength(0);
  });

  it("refuses the wrong week, dates, files, sizes and shapes", async () => {
    const d = await date("Pell Ardent");
    const err = async (over: Record<string, string | Blob | null>, episodes = [d.id]) => (await (await send(form(episodes, over))).json()).error;
    expect(await err({ week: "2026-11-17" })).toBe("invalid_week");
    expect(await err({ week: "2999-01-04" })).toBe("invalid_week");
    expect(await err({}, [])).toBe("invalid_episodes");
    expect(await err({}, ["../etc"])).toBe("invalid_episodes");
    expect(await err({}, Array.from({ length: RECAP_MAX_DATES + 1 }, (_, i) => `date-${i}`))).toBe("invalid_episodes");
    expect(await err({ poster: null })).toBe("missing_files");
    expect(await err({ video: new Blob([new Uint8Array(JPEG)]) })).toBe("invalid_files");
    expect(await err({ seconds: "400" })).toBe("invalid_size");
    expect(await err({ width: "4000" })).toBe("invalid_size");
    expect((await send(form([d.id], { video: new Blob([new Uint8Array(Buffer.concat([MP4, Buffer.alloc(RECAP_MAX_BYTES)]))]) }))).status).toBe(413);
    expect((await t.db.query("select 1 from week_recaps")).rows).toHaveLength(0);
  });

  it("refuses the whole upload when one of its dates isn't a public aired date", async () => {
    const good = await date("Pell Ardent");
    const unaired = await date("Ines Rook", { aired: false, partner: 1 });
    const res = await send(form([good.id, unaired.id]));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_aired", episode_id: unaired.id });
    const shy = await date("Lio Marsh", { partner: 2 });
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [shy.character]);
    expect(await (await send(form([good.id, shy.id]))).json()).toMatchObject({ error: "not_public", episode_id: shy.id });
    expect((await send(form([good.id, "no-such-date"]))).status).toBe(404);
    expect((await t.db.query("select 1 from week_recaps")).rows).toHaveLength(0);
  });

  it("answers 404 when the recap is switched off", async () => {
    const d = await date("Pell Ardent");
    vi.stubEnv("WEEK_RECAP", "0");
    expect((await send(form([d.id]))).status).toBe(404);
  });

  it("keeps a week's recap, one a week, and serves its files with byte ranges", async () => {
    const a = await date("Pell Ardent");
    const b = await date("Ines Rook", { partner: 1 });
    const res = await send(form([a.id, b.id]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, id: THIS_WEEK(), page: `/week/${THIS_WEEK()}`, episodes: [a.id, b.id] });

    const recap = await weekRecap(t.db, THIS_WEEK());
    expect(recap).toMatchObject({ id: THIS_WEEK(), width: 540, height: 960, seconds: 62.4, episodes: [a.id, b.id] });
    expect(recap!.src).toMatch(new RegExp(`^/api/week-recap/${THIS_WEEK()}/recap\\.mp4\\?v=\\w+$`));
    expect((await latestWeekRecap(t.db))!.id).toBe(THIS_WEEK());

    const whole = await file(THIS_WEEK(), "recap.mp4");
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("cache-control")).toContain("public");
    const bytes = Buffer.from(await whole.arrayBuffer());
    expect(bytes).toEqual(MP4);
    // Safari asks for the first two bytes before it plays anything.
    const part = await file(THIS_WEEK(), "recap.mp4", { range: "bytes=0-1" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-1/${bytes.length}`);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(bytes.subarray(0, 2));
    const tail = await file(THIS_WEEK(), "recap.mp4", { range: "bytes=-4" });
    expect(Buffer.from(await tail.arrayBuffer())).toEqual(bytes.subarray(bytes.length - 4));
    expect((await file(THIS_WEEK(), "recap.mp4", { range: `bytes=${bytes.length}-` })).status).toBe(416);
    const poster = await file(THIS_WEEK(), "poster.jpg");
    expect(poster.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await poster.arrayBuffer())).toEqual(JPEG);
    expect((await file(THIS_WEEK(), "other.bin")).status).toBe(404);
    expect((await file(LAST_WEEK(), "recap.mp4")).status).toBe(404);
    expect((await file("nope", "recap.mp4")).status).toBe(404);

    // The same week again replaces it: one row, the new cut.
    const again = await send(form([b.id], { seconds: "40" }));
    expect(again.status).toBe(200);
    expect((await t.db.query<{ episodes: string[] }>("select episodes from week_recaps")).rows).toEqual([{ episodes: [b.id] }]);
    expect((await weekRecap(t.db, THIS_WEEK()))!.seconds).toBe(40);
  });

  it("puts the files in the store when there is one, and sends a signed link", async () => {
    const kept = new Map<string, Buffer>();
    const store: ObjectStore = {
      put: async (key, bytes) => void kept.set(key, bytes),
      get: async (key) => kept.get(key) ?? null,
      remove: async (key) => void kept.delete(key),
      presign: async (key) => ({ url: `https://media.example/${key}?signed=1`, maxAge: 900 }),
    };
    setObjectStoreForTests(store);
    const d = await date("Pell Ardent");
    await send(form([d.id]));
    expect([...kept.keys()].every((k) => k.startsWith("clips/"))).toBe(true);
    expect(kept.size).toBe(2);
    const row = (await t.db.query<{ mp4_key: string; mp4_data: Buffer | null }>("select mp4_key, mp4_data from week_recaps")).rows[0];
    expect(row.mp4_key).toMatch(/^clips\/week-.+\.mp4$/);
    expect(row.mp4_data).toBeNull();
    const res = await file(THIS_WEEK(), "recap.mp4");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://media.example/${row.mp4_key}?signed=1`);
    // Sent again, the week's old files leave the store.
    await new Promise((r) => setTimeout(r, 5));
    await send(form([d.id]));
    expect(kept.size).toBe(2);
    expect(kept.has(row.mp4_key)).toBe(false);
  });
});

describe("only while every date in it is public", () => {
  it("takes the recap off its routes and its page when one of its dates is taken down, and puts it back with the date", async () => {
    const a = await date("Pell Ardent");
    const b = await date("Ines Rook", { partner: 1 });
    await send(form([a.id, b.id]));
    expect((await file(THIS_WEEK(), "recap.mp4")).status).toBe(200);

    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [b.id]);
    expect((await file(THIS_WEEK(), "recap.mp4")).status).toBe(404);
    expect((await file(THIS_WEEK(), "poster.jpg")).status).toBe(404);
    expect(await weekRecap(t.db, THIS_WEEK())).toBeNull();
    expect(await latestWeekRecap(t.db)).toBeNull();
    await expect(WeekOfPage({ params: Promise.resolve({ id: THIS_WEEK() }) })).rejects.toThrow(NOT_FOUND);

    await t.db.query(`update episodes set visibility = 'public' where id = $1`, [b.id]);
    expect((await file(THIS_WEEK(), "recap.mp4")).status).toBe(200);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [a.character]);
    expect((await file(THIS_WEEK(), "recap.mp4")).status).toBe(404);
    await t.db.query(`update characters set visibility = 'public' where id = $1`, [a.character]);
    // A date deleted outright takes it down too.
    await t.db.query(`delete from episodes where id = $1`, [b.id]);
    expect((await file(THIS_WEEK(), "recap.mp4")).status).toBe(404);
  });
});

describe("the pages", () => {
  it("say the first recap lands Sunday before there is one, with one way on", async () => {
    const html = text(renderToStaticMarkup(await WeekPage()));
    expect(html).toContain("The week in review");
    expect(html).toContain("The first recap lands Sunday");
    expect(html).not.toContain("<video");
    expect(html.match(/class="button"/g)).toHaveLength(1);
    expect(html).toContain('href="/watch"');
    expect(await weekMeta()).toMatchObject({ robots: { index: false } });
    // A week with no recap is not a page.
    await expect(WeekOfPage({ params: Promise.resolve({ id: THIS_WEEK() }) })).rejects.toThrow(NOT_FOUND);
    await expect(weekOfMeta({ params: Promise.resolve({ id: "not-a-week" }) })).rejects.toThrow(NOT_FOUND);
  });

  it("show the week's video, then a card a date with how it ended and one thing to do", async () => {
    const a = await date("Pell Ardent");
    const b = await date("Ines Rook", { partner: 1 });
    await send(form([b.id, a.id]));
    for (const html of [text(renderToStaticMarkup(await WeekPage())), text(renderToStaticMarkup(await WeekOfPage({ params: Promise.resolve({ id: THIS_WEEK() }) })))]) {
      expect(html).toContain("<h1>The week in review</h1>");
      expect(html).not.toContain("This week on Botchelor");
      const video = /<video[^>]*>/.exec(html)![0];
      expect(video).toContain(`src="/api/week-recap/${THIS_WEEK()}/recap.mp4?v=`);
      expect(video).toContain(`poster="/api/week-recap/${THIS_WEEK()}/poster.jpg?v=`);
      expect(video).toContain("controls");
      expect(video.toLowerCase()).toContain("playsinline");
      expect(video).toContain('preload="metadata"');
      // The cut's own order, each with both names, the ending and the one button.
      const cards = [...html.matchAll(/data-week-date="([^"]+)"/g)].map((m) => m[1]);
      expect(cards).toEqual([b.id, a.id]);
      expect(html).toContain(`Ines Rook × ${HOUSE_CHARACTERS[1].name}`);
      expect(html).toContain(`Pell Ardent × ${HOUSE_CHARACTERS[0].name}`);
      expect(html).toMatch(/How it ended<\/span> <strong>[^<]*second date/i);
      expect(html.match(/class="button"/g)).toHaveLength(2);
      expect(html).toContain(`href="/episodes/${a.id}?play=1"`);
      expect(html.match(/>Watch the date</g)).toHaveLength(2);
      expect(html).toContain("2 dates from the week of");
    }
    const meta = await weekMeta();
    expect(meta.title).toMatch(/^The week in review, .+ · Botchelor$/);
    expect(JSON.stringify(meta.openGraph)).toContain(`/api/week-recap/${THIS_WEEK()}/recap.mp4`);
    expect(meta.alternates).toMatchObject({ canonical: "/week" });
    expect((await weekOfMeta({ params: Promise.resolve({ id: THIS_WEEK() }) })).alternates).toMatchObject({ canonical: `/week/${THIS_WEEK()}` });
  });

  it("link the weeks either side that have a recap", async () => {
    const a = await date("Pell Ardent");
    await send(form([a.id]));
    await send(form([a.id], { week: LAST_WEEK() }));
    expect(await recapNeighbours(t.db, THIS_WEEK())).toEqual({ previous: LAST_WEEK(), next: null });
    expect(await recapNeighbours(t.db, LAST_WEEK())).toEqual({ previous: null, next: THIS_WEEK() });
    const html = text(renderToStaticMarkup(await WeekOfPage({ params: Promise.resolve({ id: LAST_WEEK() }) })));
    expect(html).toContain(`href="/week/${THIS_WEEK()}"`);
    expect(html).toContain("The week after");
    expect(html).not.toContain("The week before");
    // /week is the newest.
    expect(text(renderToStaticMarkup(await WeekPage()))).toContain(`data-week-recap="${THIS_WEEK()}"`);
  });

  it("are gone with the switch, and Watch links to them only while it's on", async () => {
    const a = await date("Pell Ardent");
    await send(form([a.id]));
    vi.stubEnv("WEEK_RECAP", "0");
    await expect(WeekPage()).rejects.toThrow(NOT_FOUND);
    await expect(weekMeta()).rejects.toThrow(NOT_FOUND);
    await expect(WeekOfPage({ params: Promise.resolve({ id: THIS_WEEK() }) })).rejects.toThrow(NOT_FOUND);
    expect((await file(THIS_WEEK(), "recap.mp4")).status).toBe(404);
    expect(readFileSync("app/watch/page.tsx", "utf8")).toContain('{weekRecapOn() && <Link href="/week">{t("The week in review")}</Link>}');
  });
});
