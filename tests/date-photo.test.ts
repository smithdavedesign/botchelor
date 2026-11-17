// A photo from the date in the character's texts (lib/date-photo.ts, app/api/og/date-photo/[id], 2026-11-15): the
// snapshot's route (it renders, for whom, and never with the ending), the photo message in the after-date text, how the
// thread shows it, the tease's photo (sent once a date), the real date photo in its place, and the DATE_PHOTO_TEXTS switch. The life text's photo is in
// tests/character-life.test.ts; the cast opener's in tests/cast-opener.test.ts.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The route renders through next/og. This keeps the real renderer (so the picture is real) and records the element it
// was given, so a test can read the words on it: Satori draws text as shapes, not as text in the file.
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

import { GET as photoRoute } from "@/app/api/og/date-photo/[id]/route";
import DatePhoto from "@/app/companion/[id]/DatePhoto";
import { sendAfterDateText, teaseAfterAir } from "@/lib/after-date-text";
import { recordAsset, reviewAsset } from "@/lib/assets";
import { getThread, openThread, sendMessage, setCompanionModelForTests, threadIdFor } from "@/lib/companion";
import { voiceNote } from "@/lib/companion-voice";
import { DATE_PHOTO_ASPECT, datePhotoEpisode, datePhotoPath, datePhotoTexts } from "@/lib/companion-shared";
import { backdropJpeg, datePhotoAlt, datePhotoDay, datePhotoFacts, portraitJpeg, textPhoto } from "@/lib/date-photo";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { ENDING_LABELS, ENDINGS, type Ending } from "@/lib/rules";
import { venueName } from "@/lib/venues";
import { api, BASE_URL, newUserCookie, setupEpisode, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const photo = (id: string, cookie?: string) => photoRoute(new Request(`${BASE_URL}/api/og/date-photo/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });

/** The route's picture for `id` as `cookie` sees it: the response, its bytes, and the words drawn on it. */
async function snapshot(id: string, cookie?: string) {
  og.elements.length = 0;
  const res = await photo(id, cookie);
  expect(res.status).toBe(200);
  const bytes = Buffer.from(await res.arrayBuffer());
  expect(og.elements).toHaveLength(1);
  return { res, bytes, words: text(renderToStaticMarkup(og.elements[0] as ReactElement)) };
}

/** Every way an ending can be written: the stored value and its label ("friends", "Just friends"). */
const endingWords = (ending: Ending) => [ending, ending.replace("_", " "), ENDING_LABELS[ending]].map((w) => w.toLowerCase());
const isWebp = (b: Buffer) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
const isPng = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const photoRows = async (threadId: string) =>
  (await t.db.query<{ id: string; text: string; media_url: string | null; action: string | null; via: string }>(`select id, text, media_url, action, via from companion_messages where thread_id = $1 and via = 'photo' order by created_at, id`, [threadId])).rows;

describe("the snapshot's words (pure)", () => {
  it("says who, where and when, and never how it ended", () => {
    const alt = datePhotoAlt({ names: ["Lexi Marlowe", "Teo Varga"], venue: "night_market", at: "2026-11-14T20:00:00Z" });
    expect(alt).toMatch(/^A photo from the date: Lexi and Teo at .+, Saturday, November 14\.$/);
    expect(datePhotoAlt({ names: ["Lexi", "Teo"], venue: null, at: "2026-11-14T20:00:00Z" })).toBe("A photo from the date: Lexi and Teo, Saturday, November 14.");
    expect(datePhotoDay("2026-11-15T03:00:00Z")).toBe("Sunday, November 15");
  });

  it("is on by default and DATE_PHOTO_TEXTS=0 turns it off; only the snapshot route's own path is ever a photo", () => {
    const ep = { id: "ep-1", names: ["Lexi", "Teo"] as const, venue: "night_market", at: "2026-11-14T20:00:00Z" };
    expect(datePhotoTexts({})).toBe(true);
    expect(datePhotoTexts({ DATE_PHOTO_TEXTS: "1" })).toBe(true);
    expect(datePhotoTexts({ DATE_PHOTO_TEXTS: "0" })).toBe(false);
    expect(textPhoto(ep, {})).toEqual({ url: "/api/og/date-photo/ep-1", alt: datePhotoAlt(ep) });
    expect(textPhoto(ep, { DATE_PHOTO_TEXTS: "0" })).toBeNull();
    expect(datePhotoEpisode(datePhotoPath("ep-1"))).toBe("ep-1");
    for (const bad of [null, "", "https://evil.example/x.png", "/api/og/date-photo/", "/api/og/date-photo/a/b", "/api/og/episode/ep-1", "javascript:alert(1)"]) expect(datePhotoEpisode(bad)).toBeNull();
    expect(DATE_PHOTO_ASPECT).toEqual({ width: 4, height: 5 });
  });
});

describe("GET /api/og/date-photo/<id>", () => {
  it("renders a picture of the two of them, the place and the day, cached for everyone when the date is public", async () => {
    const { creator, character, episode } = await setupEpisode("second_date");
    await t.db.query(`update episodes set created_at = '2026-11-14T20:00:00Z' where id = $1`, [episode.id]);
    const venue = (await t.db.query<{ venue: string }>(`select setup->>'venue' as venue from episodes where id = $1`, [episode.id])).rows[0].venue;
    const { res, bytes, words } = await snapshot(episode.id);
    expect(isWebp(bytes) || isPng(bytes)).toBe(true);
    expect(res.headers.get("content-type")).toBe(isWebp(bytes) ? "image/webp" : "image/png");
    expect(res.headers.get("cache-control")).toMatch(/^public, max-age=86400, s-maxage=604800/);
    // Made by a model (the backdrop and the faces): marked as such.
    expect(res.headers.get("x-ai-generated")).toBe("true");
    expect(words).toContain(`${character.name.split(" ")[0]} & ${HOUSE_CHARACTERS[0].name.split(" ")[0]}`);
    expect(words).toContain(text(venueName(venue)));
    expect(words).toContain("Saturday, November 14");
    // The same picture for its owner: nothing on it depends on who asks.
    expect((await snapshot(episode.id, creator)).words).toBe(words);
  });

  it("never gives the ending away, whatever it was and whoever asks", async () => {
    for (const ending of ENDINGS) {
      const { creator, episode } = await setupEpisode(ending);
      for (const cookie of [undefined, creator]) {
        const lower = (await snapshot(episode.id, cookie)).words.toLowerCase();
        for (const word of ENDINGS.flatMap(endingWords)) expect(lower, `${ending}: "${word}"`).not.toContain(word);
        for (const word of ["second date", "disaster", "friends", "went well", "wants", "chemistry"]) expect(lower).not.toContain(word);
      }
    }
  });

  it("is the episode page's rule: 404 for a date that isn't there, a private one to anyone but its people, a reported one, and After Dark's", async () => {
    expect((await photo("no-such-date")).status).toBe(404);
    const { creator, episode } = await setupEpisode("friends");
    const stranger = newUserCookie();
    await t.db.query(`update episodes set visibility = 'private' where id = $1`, [episode.id]);
    expect((await photo(episode.id)).status).toBe(404);
    expect((await photo(episode.id, stranger)).status).toBe(404);
    const mine = await photo(episode.id, creator);
    expect(mine.status).toBe(200);
    // What depends on who asks is never kept for everyone.
    expect(mine.headers.get("cache-control")).toBe("private, max-age=86400");
    // Unlisted: anyone with the link, like the page.
    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [episode.id]);
    expect((await photo(episode.id)).status).toBe(200);
    // Hidden by reports: only its people.
    for (let i = 0; i < 3; i++) await t.db.query(`insert into reports (episode_id, reporter_id) values ($1, $2)`, [episode.id, crypto.randomUUID()]);
    expect((await photo(episode.id, stranger)).status).toBe(404);
    expect((await photo(episode.id, creator)).status).toBe(200);
    await t.db.query(`delete from reports where episode_id = $1`, [episode.id]);
    await t.db.query(`update episodes set visibility = 'public', setup = setup || '{"after_dark":true}'::jsonb where id = $1`, [episode.id]);
    expect((await photo(episode.id, creator)).status).toBe(404);
  });

  it("draws a private character's face only for its owner, and then keeps the picture out of shared caches", async () => {
    const { creator, character, episode } = await setupEpisode("friends");
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [character.id]);
    const forStranger = await datePhotoFacts(t.db, episode.id, null);
    expect(forStranger?.sides.map((s) => s.showFace)).toEqual([false, true]);
    expect(forStranger?.shared).toBe(false);
    const forOwner = await datePhotoFacts(t.db, episode.id, userIdOf(creator));
    expect(forOwner?.sides.map((s) => s.showFace)).toEqual([true, true]);
    expect((await photo(episode.id)).headers.get("cache-control")).toBe("private, max-age=86400");
    // The date still being wrapped up (the early verdict's "Hear from"): its picture is already there.
    await t.db.query(`update episodes set status = 'generating' where id = $1`, [episode.id]);
    expect(await datePhotoFacts(t.db, episode.id, userIdOf(creator))).not.toBeNull();
  });

  it("puts the show's own art in as small JPEGs (the rasterizer draws a WebP as nothing), and a gradient where there is none", async () => {
    const face = await portraitJpeg(t.db, HOUSE_CHARACTERS[0].id, { width: 248, height: 310 });
    expect(face).toMatch(/^data:image\/jpeg;base64,/);
    // Small: a few tens of KB, not the megabyte a full portrait is.
    expect(face!.length).toBeLessThan(120_000);
    expect(await backdropJpeg("night_market", { width: 640, height: 800 })).toMatch(/^data:image\/jpeg;base64,/);
    expect(await backdropJpeg(null, { width: 640, height: 800 })).toBeNull();
    expect(await backdropJpeg("no_such_place", { width: 640, height: 800 })).toBeNull();
    // A character with no approved portrait: null, so the snapshot paints its gradient tile with its initials.
    const { character } = await setupEpisode("friends");
    expect(await portraitJpeg(t.db, character.id, { width: 248, height: 310 })).toBeNull();
  });
});

describe("the photo message in the after-date text", () => {
  it("is one message right after the first bubble, under the text's tag, sent once; the thread shows it as a photo that opens the date", async () => {
    const { creator, episode } = await setupEpisode("second_date");
    const me = userIdOf(creator);
    const r = await sendAfterDateText(t.db, { userId: me, episodeId: episode.id, now: new Date("2026-11-14T20:00:00Z") });
    if (!r.ok) throw new Error(r.error);
    const all = (await t.db.query<{ role: string; via: string; text: string; action: string | null; media_url: string | null; offers: Any }>(`select role, via, text, action, media_url, offers from companion_messages where thread_id = $1 order by created_at, id`, [r.thread_id])).rows;
    // The notice, the first bubble (with the chips), the photo, then the rest.
    expect(all.map((m) => `${m.role}:${m.via}`)).toEqual(["system:text", "character:text", "character:photo", "character:text", "character:text"]);
    expect(all[2]).toMatchObject({ media_url: `/api/og/date-photo/${episode.id}`, action: `after_date:${episode.id}`, offers: null });
    expect(all[2].text).toMatch(/^A photo from the date: /);
    expect(all[1].offers).not.toBeNull();
    // Tapping "Hear from" again: nothing new, the photo included.
    expect(await sendAfterDateText(t.db, { userId: me, episodeId: episode.id })).toMatchObject({ ok: true, sent: false });
    expect(await photoRows(r.thread_id)).toHaveLength(1);

    const view = await getThread(t.db, me, r.thread_id);
    if (!view.ok) throw new Error("no thread");
    const shown = view.view.messages.filter((m) => m.photo);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ role: "character", photo: { src: `/api/og/date-photo/${episode.id}`, href: `/episodes/${episode.id}` }, action: null });
    // Its alt text is the message's text; the after-date text itself gets no "Watch the date" link (they just watched it).
    expect(shown[0].text).toMatch(/^A photo from the date: /);
    expect(view.view.messages.some((m) => m.link)).toBe(false);
    // The chips still sit on the first bubble, not on the photo.
    expect(view.view.messages.find((m) => m.offers)?.photo).toBeUndefined();
  });

  it("rides the tease too, so every text about a date looks the same, and the Hear-from text after it doesn't send it again", async () => {
    const { creator, character, episode } = await setupEpisode("disaster");
    const me = userIdOf(creator);
    // Opted in (the tease only goes to a thread that tapped "Hear from" once), and the date has aired.
    await openThread(t.db, me, character.id, new Date(), { opener: false });
    const thread = (await threadIdFor(t.db, me, character.id))!;
    await t.db.query(`update companion_threads set muted_proactive = false where id = $1`, [thread]);
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episode.id]);
    expect(await teaseAfterAir(t.db, episode.id)).toBe(1);
    const all = (await t.db.query<{ role: string; via: string; text: string; action: string | null; media_url: string | null }>(`select role, via, text, action, media_url from companion_messages where thread_id = $1 order by created_at, id`, [thread])).rows;
    // The notice, "Back from the date with …", the photo, "Come see how it went."
    expect(all.map((m) => `${m.role}:${m.via}`)).toEqual(["system:text", "character:text", "character:photo", "character:text"]);
    expect(all[2]).toMatchObject({ media_url: `/api/og/date-photo/${episode.id}`, action: `tease:${episode.id}` });
    // The photo's words never give the ending away, like the tease's.
    for (const w of endingWords("disaster")) expect(all[2].text.toLowerCase()).not.toContain(w);
    const view = await getThread(t.db, me, thread);
    if (!view.ok) throw new Error("no thread");
    expect(view.view.messages.filter((m) => m.photo).map((m) => m.photo)).toEqual([{ src: `/api/og/date-photo/${episode.id}`, href: `/episodes/${episode.id}` }]);
    // "Watch the date" still sits under its last bubble.
    expect(view.view.messages.at(-1)).toMatchObject({ text: "Come see how it went.", link: { href: `/episodes/${episode.id}`, label: "Watch the date" } });

    // They watched it and tapped "Hear from": the words come, the same photo doesn't come twice.
    const heard = await sendAfterDateText(t.db, { userId: me, episodeId: episode.id });
    expect(heard).toMatchObject({ ok: true, sent: true, thread_id: thread });
    expect((await photoRows(thread)).map((p) => p.action)).toEqual([`tease:${episode.id}`]);
    expect((await t.db.query(`select 1 from companion_messages where thread_id = $1 and action = $2`, [thread, `after_date:${episode.id}`])).rows).toHaveLength(3);
  });

  it("DATE_PHOTO_TEXTS=0: the text goes without a photo", async () => {
    vi.stubEnv("DATE_PHOTO_TEXTS", "0");
    const { creator, episode } = await setupEpisode("friends");
    const r = await sendAfterDateText(t.db, { userId: userIdOf(creator), episodeId: episode.id });
    if (!r.ok) throw new Error(r.error);
    expect(await photoRows(r.thread_id)).toEqual([]);
    expect((await t.db.query(`select 1 from companion_messages where thread_id = $1 and role = 'character'`, [r.thread_id])).rows).toHaveLength(3);
  });

  it("shows the real date photo in the snapshot's place once the owner made one, and never renders an address that isn't the snapshot's", async () => {
    const { creator, character, episode } = await setupEpisode("second_date");
    const me = userIdOf(creator);
    const r = await sendAfterDateText(t.db, { userId: me, episodeId: episode.id });
    if (!r.ok) throw new Error(r.error);
    // A date photo from the PG Studio (lib/studio/date-photos.ts): an approved pg asset kept with the date.
    const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const asset = await recordAsset(t.db, { character_id: character.id, kind: "photo", source_type: "generated", source_model: "test", prompt: "a selfie together", url: PNG_1X1, content_rating: "pg" });
    await t.db.query(`insert into date_photos (asset_id, episode_id, owner_id, style) values ($1, $2, $3, 'selfie')`, [asset, episode.id, me]);
    const before = await getThread(t.db, me, r.thread_id);
    // Not approved yet: still the snapshot.
    expect(before.ok && before.view.messages.find((m) => m.photo)?.photo?.src).toBe(`/api/og/date-photo/${episode.id}`);
    await reviewAsset(t.db, asset, "approved", "test");
    const after = await getThread(t.db, me, r.thread_id);
    expect(after.ok && after.view.messages.find((m) => m.photo)?.photo).toEqual({ src: `/api/assets/${asset}`, href: `/episodes/${episode.id}` });
    // Whatever else is stored as a photo's address is not rendered as one.
    const [row] = await photoRows(r.thread_id);
    await t.db.query(`update companion_messages set media_url = 'https://evil.example/x.png' where id = $1`, [row.id]);
    const tampered = await getThread(t.db, me, r.thread_id);
    expect(tampered.ok && tampered.view.messages.some((m) => m.photo)).toBe(false);
  });

  it("is not a line the character said: it stays out of the reply's turns, the prompt is told it was sent, and it has no voice note", async () => {
    const { creator, episode } = await setupEpisode("second_date");
    const me = userIdOf(creator);
    const r = await sendAfterDateText(t.db, { userId: me, episodeId: episode.id });
    if (!r.ok) throw new Error(r.error);
    const seen: ChatMessage[][] = [];
    setCompanionModelForTests({
      async complete(messages) {
        const system = messages[0]?.content ?? "";
        if (system.startsWith("You check one message")) return `{"risk": false}`;
        if (system.startsWith("You are ")) seen.push(messages);
        return JSON.stringify({ messages: ["Ha. It was a good night."] });
      },
    });
    const sent = await sendMessage(t.db, me, r.thread_id, "cute picture!");
    expect(sent.ok).toBe(true);
    expect(seen).toHaveLength(1);
    const [system, ...turns] = seen[0];
    expect(system.content).toContain("Photos you sent them (snapshots from your dates");
    expect(system.content).toMatch(/- A photo from the date: /);
    expect(turns.map((m) => m.content).join("\n")).not.toContain("A photo from the date");
    const [row] = await photoRows(r.thread_id);
    expect(await voiceNote(t.db, me, r.thread_id, row.id)).toMatchObject({ ok: false, status: 422 });
  });
});

describe("the photo in the thread (app/companion/[id]/DatePhoto.tsx)", () => {
  it("is one link to the date with the alt text on the image and its shape fixed before it loads", () => {
    const html = text(renderToStaticMarkup(DatePhoto({ src: "/api/og/date-photo/ep-1", alt: "A photo from the date: Lexi and Teo at the night market, Saturday, November 14.", href: "/episodes/ep-1" })));
    expect(html).toContain('href="/episodes/ep-1"');
    expect(html).toContain('alt="A photo from the date: Lexi and Teo at the night market, Saturday, November 14."');
    // 4:5 on the element itself, so the box is there before the picture is (no jump in the thread).
    expect(html).toMatch(/width="320"[^>]*height="400"|height="400"[^>]*width="320"/);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("Watch the date");
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
