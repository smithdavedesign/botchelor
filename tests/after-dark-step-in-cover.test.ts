// Who stands beside a Step in scene (David, 2026-11-24): "the role's cover standing in the scene as its picture", and
// 'an "always the newest picture" switch'. A scene opened from a roleplay's card starts on that card's cover of the
// character (lib/adult/roleplay-covers.ts coverInScene; lib/adult/step-in.ts coverOf, setStepInFigure); a viewer who
// draws often can have every new picture take that place by itself (lib/adult/step-in-picture.ts setStepInNewest).
// No live calls here. The fixtures are mild lines.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/after-dark/step-in",
}));
vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));
import type { ReactElement } from "react";
import { prerender } from "react-dom/static";
import StepInScenePage from "@/app/after-dark/step-in/[id]/page";
import { PUT as picturePut } from "@/app/api/admin/after-dark/step-in/[id]/picture/route";
import { POST as scenePost } from "@/app/api/admin/after-dark/step-in/[id]/route";
import { claimAdmin } from "@/lib/admins";
import { HIVE_VLM, setCheckFetchForTests, setCheckSleepForTests } from "@/lib/adult/check";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { setBriefModelForTests } from "@/lib/adult/picture-brief";
import { setReelFetchForTests, setReelPausesForTests } from "@/lib/adult/reels";
import { coverInScene, ROLEPLAY_COVERS } from "@/lib/adult/roleplay-covers";
import { saveAdultSettings } from "@/lib/adult/settings";
import { endStepIn, getStepInScene, moveStepIn, quickStepIn, sendStepInLine, setStepInFigure, setStepInRandomForTests, startStepIn, STORY_PLACE } from "@/lib/adult/step-in";
import { drawStepInPicture, setStepInBeside, setStepInNewest, stepInPictureState } from "@/lib/adult/step-in-picture";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { setPlaceForTests } from "@/lib/place";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

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
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("REPLICATE_API_TOKEN", "");
  setSeasonCastForTests([RAFE, JUNIPER]);
  setStepInRandomForTests(() => 0);
  setReelPausesForTests(false);
  setCheckSleepForTests(async () => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setBriefModelForTests(undefined);
  setSeasonCastForTests(null);
  setStepInRandomForTests(null);
  setReelFetchForTests(null);
  setReelPausesForTests(true);
  setCheckFetchForTests(null);
  setCheckSleepForTests(null);
  setPlaceForTests({ country: "US", region: "CA" });
});

// Rafe and Juniper, the two house characters in After Dark here. Juniper is on the cover of "The neighbour next door",
// as the neighbour who answers (the viewer knocks: side 0); Rafe is on another card's.
const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const NAME = HOUSE_CHARACTERS[1].name.split(/\s+/)[0];
const CARD = "neighbours";
const COVER = ROLEPLAY_COVERS[CARD];
const HOME = "venue:home";

function signIn(id: string): string {
  const c = signedInCookie(id);
  jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
  return c.split(";")[0];
}
async function admin() {
  const id = randomUUID();
  await claimAdmin(t.db, id);
  return { id, cookie: signIn(id) };
}
async function subscriber() {
  const id = randomUUID();
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  return { id, cookie: signIn(id) };
}
/** After Dark set up for pictures (Venice's and Hive's keys), and Step in as it ships (admins only) unless opened. */
const setUp = (extra: Parameters<typeof saveAdultSettings>[1] = {}) => saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice", hive_key: "placeholder-hive", ...extra });

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
/** Each of them has the face this viewer's pictures keep (a baseline), so nothing has to be made first. */
async function faces(owner: string) {
  for (const [id, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4) on conflict do nothing`, [`${id}-${owner.slice(0, 8)}`, owner, c, Buffer.from(PNG)]);
  }
}
const isNotes = (m: ChatMessage[]) => m[0].content.startsWith("You keep the running notes of a private scene");
const isCrisisCheck = (m: ChatMessage[]) => m[0].content.startsWith("You check one message a person typed");
const REPLY = { story: ['She set her glass down and turned in the doorway. "You made it," she said, as if it had been in doubt.', "Rain had started on the landing window, and the lamp in the hall made a small warm circle of it."] };
/** The scene's writer (every reply the same mild story), the moment's reader, the picture model and its checker. */
function models() {
  setAdultModelForTests({
    complete: async (m) => {
      if (isCrisisCheck(m)) return '{"risk": false}';
      if (isNotes(m)) return JSON.stringify({ recap: "They met and talked.", line: "An evening of talk." });
      return JSON.stringify(REPLY);
    },
  });
  setBriefModelForTests({
    complete: async () => JSON.stringify({ place: "the doorway of her flat, a lamp on in the hall", wearing: "a soft cardigan", kept_on: "", happening: "She leans on the door frame, smiling into the camera.", mood: "warm", state: "dressed" }),
  });
  setReelFetchForTests(async () => new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } }));
  setCheckFetchForTests(async (input: RequestInfo | URL) =>
    Response.json(
      String(input) === HIVE_VLM
        ? { choices: [{ message: { role: "assistant", content: '{"answer": "ADULTS"}' } }] }
        : { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.98 }] }] },
    ),
  );
}

/** A scene opened from the card, as the front page's shelf opens one: the story's own place, the opening still to come. */
async function fromCard(viewer: string, who = JUNIPER, you: 0 | 1 = COVER.you) {
  const r = await quickStepIn(t.db, viewer, who, new Date(), { roleplay: { id: CARD, you } });
  if (!r.ok) throw new Error(`card failed: ${r.status} ${r.message}`);
  return r.id;
}
/** One line of the viewer's and its reply: the reply's id. */
async function line(viewer: string, sceneId: string, text = "I brought your parcel up. Is that the lamp from the market?") {
  const sent = await sendStepInLine(t.db, viewer, sceneId, text);
  if (!sent.ok) throw new Error(`send failed: ${sent.status} ${sent.message}`);
  return sent.view.messages.at(-1)!.id;
}
const view = async (viewer: string, sceneId: string) => {
  const r = await getStepInScene(t.db, viewer, sceneId);
  if (!r.ok) throw new Error(`scene: ${r.status} ${r.message}`);
  return r.view;
};
const draw = async (viewer: string, sceneId: string, reply: string) => {
  const r = await drawStepInPicture(t.db, viewer, sceneId, reply, BASE_URL);
  if (!r.ok) throw new Error(`draw failed: ${r.status} ${r.message}`);
  return r;
};
const post = (path: string, body: unknown, cookie: string) => new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const put = (path: string, body: unknown, cookie: string) => new Request(`${BASE_URL}${path}`, { method: "PUT", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");
const page = async (id: string) => html(await StepInScenePage({ params: Promise.resolve({ id }) }));

describe("a cover as a scene's picture", () => {
  it("is the card's own, for the one in it on the side it shows, and nobody else", () => {
    for (const [id, cover] of Object.entries(ROLEPLAY_COVERS)) {
      expect(coverInScene(id, cover.character, cover.you), id).toBe(cover);
      // The sides the other way round: the picture would show them dressed for the viewer's part.
      expect(coverInScene(id, cover.character, cover.you === 0 ? 1 : 0), id).toBeNull();
      expect(coverInScene(id, "someone-else", cover.you), id).toBeNull();
    }
    expect(coverInScene("no-such-roleplay", JUNIPER, 0)).toBeNull();
    expect(coverInScene(null, JUNIPER, 0)).toBeNull();
  });

  it("says where its character stands across the picture: right of the middle in every one", () => {
    for (const [id, cover] of Object.entries(ROLEPLAY_COVERS)) {
      expect(Number.isInteger(cover.focus), id).toBe(true);
      expect(cover.focus, id).toBeGreaterThanOrEqual(55);
      expect(cover.focus, id).toBeLessThanOrEqual(78);
    }
  });
});

describe("the role's cover, standing in the scene", () => {
  it("is what a scene opened from its card starts on; anyone else, the other side, another place or no roleplay has the portrait", async () => {
    models();
    await setUp();
    const a = await admin();
    expect((await view(a.id, await fromCard(a.id))).cover).toEqual({ src: COVER.src, alt: COVER.alt, focus: COVER.focus, off: false });
    // The same card with someone who isn't in its picture, and with her on the other side of it.
    expect((await view(a.id, await fromCard(a.id, RAFE))).cover).toBeNull();
    expect((await view(a.id, await fromCard(a.id, JUNIPER, COVER.you === 0 ? 1 : 0))).cover).toBeNull();
    // Set up by hand where its story is set: the same picture. Anywhere else, or with no roleplay, the portrait.
    const there = await startStepIn(t.db, a.id, { character_id: JUNIPER, place: STORY_PLACE, roleplay: { id: CARD, you: COVER.you } });
    const elsewhere = await startStepIn(t.db, a.id, { character_id: JUNIPER, place: HOME, roleplay: { id: CARD, you: COVER.you } });
    const plain = await startStepIn(t.db, a.id, { character_id: JUNIPER, place: HOME });
    if (!there.ok || !elsewhere.ok || !plain.ok) throw new Error("start failed");
    expect(there.view.cover).toMatchObject({ src: COVER.src, off: false });
    expect(elsewhere.view.cover).toBeNull();
    expect(plain.view.cover).toBeNull();
  });

  it("goes when the scene moves somewhere else: the picture is of them where the story is set", async () => {
    models();
    await setUp();
    const a = await admin();
    const id = await fromCard(a.id);
    await line(a.id, id);
    expect((await view(a.id, id)).cover).not.toBeNull();
    expect(await moveStepIn(t.db, a.id, id, HOME)).toMatchObject({ ok: true, view: { cover: null } });
  });

  it("gives way to the portrait when they ask, and comes back; a picture of the scene's goes over either and comes away to the one they had", async () => {
    models();
    await setUp();
    const a = await admin();
    await faces(a.id);
    const id = await fromCard(a.id);
    const reply = await line(a.id, id);
    expect(await setStepInFigure(t.db, a.id, id, "portrait")).toMatchObject({ ok: true, view: { cover: { src: COVER.src, off: true } } });
    expect(await setStepInFigure(t.db, a.id, id, "cover")).toMatchObject({ ok: true, view: { cover: { off: false } } });
    // One of the scene's own pictures in that place: the cover is still the scene's, underneath.
    await draw(a.id, id, reply);
    expect(await setStepInBeside(t.db, a.id, id, reply)).toMatchObject({ ok: true, state: { beside: reply } });
    expect((await view(a.id, id)).cover).toMatchObject({ off: false });
    // Taken away again: the cover is back. With the portrait asked for first, it's the portrait that's back.
    expect(await setStepInBeside(t.db, a.id, id, null)).toMatchObject({ ok: true, state: { beside: null } });
    expect((await view(a.id, id)).cover).toMatchObject({ off: false });
    await setStepInFigure(t.db, a.id, id, "portrait");
    await setStepInBeside(t.db, a.id, id, reply);
    await setStepInBeside(t.db, a.id, id, null);
    expect((await view(a.id, id)).cover).toMatchObject({ off: true });
    // The menu's way back from a picture puts the picture away with it.
    await setStepInBeside(t.db, a.id, id, reply);
    expect(await setStepInFigure(t.db, a.id, id, "cover")).toMatchObject({ ok: true, view: { cover: { off: false } } });
    expect((await stepInPictureState(t.db, a.id, id))?.beside).toBeNull();
    // Only the scene's owner chooses; and it's still theirs to change once the scene has ended.
    const other = await admin();
    expect(await setStepInFigure(t.db, other.id, id, "portrait")).toMatchObject({ ok: false, status: 404 });
    expect((await view(a.id, id)).cover).toMatchObject({ off: false });
    await endStepIn(t.db, a.id, id);
    expect(await setStepInFigure(t.db, a.id, id, "portrait")).toMatchObject({ ok: true, view: { cover: { off: true } } });
  });

  it("stands where the portrait would, cut around where they stand in it, and the menu has the way to the portrait and back", async () => {
    models();
    await setUp();
    const a = await admin();
    const id = await fromCard(a.id);
    await line(a.id, id);
    const standing = await page(id);
    // The show's own picture (public/cast): no veil of its own, since discreet mode leaves those alone.
    expect(standing).toContain(`<div class="character-figure ad-si-figure" data-figure="cover" data-step-in-cover="" aria-hidden="true" style="--si-cover-x:${COVER.focus}%"><img class="character-figure-img" src="${COVER.src}" alt=""`);
    expect(standing).toMatch(new RegExp(`<button type="button"[^>]*data-step-in-portrait-back[^>]*>Show ${NAME}&#x27;s portrait instead</button>`));
    expect(standing).not.toContain("data-step-in-cover-back");
    await setStepInFigure(t.db, a.id, id, "portrait");
    const portrait = await page(id);
    expect(portrait).not.toContain('data-figure="cover"');
    expect(portrait).toMatch(new RegExp(`<button type="button"[^>]*data-step-in-cover-back[^>]*>Show ${NAME} dressed for the roleplay</button>`));
    expect(portrait).not.toContain("data-step-in-portrait-back");
    // A scene with no cover has neither: nothing else could stand there.
    const plain = await startStepIn(t.db, a.id, { character_id: JUNIPER, place: HOME });
    if (!plain.ok) throw new Error(plain.message);
    const none = await page(plain.id);
    expect(none).not.toContain("data-step-in-cover");
    expect(none).not.toContain("data-step-in-portrait-back");
    // Framed like one of the scene's own pictures on a wide screen and cut tall around them; under the night on a
    // tablet and a phone, showing the part of it they stand in. Never blurred: only the scene's own pictures are.
    const css = readFileSync("app/ux/after-dark.css", "utf8");
    expect(css).toContain('.ad-si-figure[data-figure="cover"] .character-figure-img {\n    aspect-ratio: 3 / 4;\n    object-position: var(--si-cover-x, 68%) center;');
    expect(css).toContain('.ad-si-stage .ad-si-figure[data-figure="cover"] .character-figure-img {\n    object-position: var(--si-cover-x, 68%) center;');
    expect(css).toContain('.ad-si-view:has(.ad-si-figure[data-figure="cover"])::after');
    expect(css).not.toMatch(/\[data-ad-discreet="blur"\][^{]*data-figure="cover"/);
  });

  it("the route: the scene's own move, closed like the rest of Step in, and open where only text is allowed", async () => {
    models();
    await setUp();
    const a = await admin();
    const id = await fromCard(a.id);
    const path = `/api/admin/after-dark/step-in/${id}`;
    const sub = await subscriber();
    expect((await scenePost(post(path, { action: "figure", show: "portrait" }, sub.cookie), ctx(id))).status).toBe(404);
    expect((await scenePost(post(path, { action: "figure", show: "nobody" }, a.cookie), ctx(id))).status).toBe(422);
    const res = await scenePost(post(path, { action: "figure", show: "portrait" }, a.cookie), ctx(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scene: { cover: { src: COVER.src, off: true } } });
    // Both are the show's own pictures, so this isn't the picture route's: where only text is allowed, a subscriber's
    // scene still opens on its cover and they can still have the portrait.
    await saveAdultSettings(t.db, { rollout: { companion: "everyone" } });
    signIn(sub.id);
    const theirs = await fromCard(sub.id);
    setPlaceForTests({ country: "GB", region: null });
    expect(await page(theirs)).toContain('data-figure="cover"');
    const there = await scenePost(post(`/api/admin/after-dark/step-in/${theirs}`, { action: "figure", show: "portrait" }, sub.cookie), ctx(theirs));
    expect(there.status).toBe(200);
    expect(await page(theirs)).not.toContain('data-figure="cover"');
  });
});

describe("always the newest picture", () => {
  it("is off until they turn it on; on, each picture made stands beside the scene as it lands, and an earlier one can still be put there by hand", async () => {
    models();
    await setUp();
    const a = await admin();
    await faces(a.id);
    const started = await startStepIn(t.db, a.id, { character_id: JUNIPER, place: HOME });
    if (!started.ok) throw new Error(started.message);
    const id = started.id;
    const one = await line(a.id, id);
    expect(await stepInPictureState(t.db, a.id, id)).toMatchObject({ newest: false, beside: null });
    // Off: making a picture moves nothing.
    expect((await draw(a.id, id, one)).state).toMatchObject({ newest: false, beside: null });
    // Turned on in a scene that has pictures: the newest of them goes there now.
    expect(await setStepInNewest(t.db, a.id, id, true)).toMatchObject({ ok: true, state: { newest: true, beside: one } });
    const two = await line(a.id, id, "Tell me about the market.");
    expect((await draw(a.id, id, two)).state).toMatchObject({ newest: true, beside: two });
    // By hand, an earlier one; the next picture made takes the place again.
    expect(await setStepInBeside(t.db, a.id, id, one)).toMatchObject({ ok: true, state: { beside: one, newest: true } });
    expect((await draw(a.id, id, two)).state).toMatchObject({ beside: two });
    // Turned off: what stands there stays, and the next picture made moves nothing.
    expect(await setStepInNewest(t.db, a.id, id, false)).toMatchObject({ ok: true, state: { newest: false, beside: two } });
    const three = await line(a.id, id, "And the lamp, where did you find it?");
    expect((await draw(a.id, id, three)).state).toMatchObject({ newest: false, beside: two });
  });

  it("is theirs in every scene of theirs, and nobody else's", async () => {
    models();
    await setUp();
    const a = await admin();
    await faces(a.id);
    const first = await startStepIn(t.db, a.id, { character_id: JUNIPER, place: HOME });
    const second = await startStepIn(t.db, a.id, { character_id: RAFE, place: HOME });
    if (!first.ok || !second.ok) throw new Error("start failed");
    // Turned on where nothing has been drawn yet: nothing to put there, and nothing moves.
    expect(await setStepInNewest(t.db, a.id, first.id, true)).toMatchObject({ ok: true, state: { newest: true, beside: null, pictures: {} } });
    expect(await stepInPictureState(t.db, a.id, second.id)).toMatchObject({ newest: true, beside: null });
    const reply = await line(a.id, second.id);
    expect((await draw(a.id, second.id, reply)).state).toMatchObject({ beside: reply });
    expect((await stepInPictureState(t.db, a.id, first.id))?.beside).toBeNull();
    const other = await admin();
    await faces(other.id);
    const theirs = await startStepIn(t.db, other.id, { character_id: JUNIPER, place: HOME });
    if (!theirs.ok) throw new Error(theirs.message);
    expect((await stepInPictureState(t.db, other.id, theirs.id))?.newest).toBe(false);
    // Asked through someone else's scene: not found, and their own switch is as it was.
    expect(await setStepInNewest(t.db, other.id, first.id, true)).toMatchObject({ ok: false, status: 404 });
    expect((await stepInPictureState(t.db, other.id, theirs.id))?.newest).toBe(false);
  });

  it("goes over a roleplay's cover too, and the cover is still there underneath", async () => {
    models();
    await setUp();
    const a = await admin();
    await faces(a.id);
    const id = await fromCard(a.id);
    const reply = await line(a.id, id);
    await setStepInNewest(t.db, a.id, id, true);
    expect((await draw(a.id, id, reply)).state).toMatchObject({ beside: reply });
    expect((await view(a.id, id)).cover).toMatchObject({ off: false });
    const shown = await page(id);
    expect(shown).toContain('data-figure="picture"');
    expect(shown).not.toContain('data-figure="cover"');
    // The menu has both ways back.
    expect(shown).toContain("data-step-in-cover-back");
    expect(shown).toMatch(new RegExp(`data-step-in-portrait-back[^>]*>Show ${NAME}&#x27;s portrait again</button>`));
  });

  it("the switch is in the scene's menu and under the picture that stands there; the route is the pictures' own", async () => {
    models();
    await setUp();
    const a = await admin();
    await faces(a.id);
    const started = await startStepIn(t.db, a.id, { character_id: JUNIPER, place: HOME });
    if (!started.ok) throw new Error(started.message);
    const id = started.id;
    const reply = await line(a.id, id);
    await draw(a.id, id, reply);
    const off = await page(id);
    // Only in the menu until a picture stands there: plain buttons (the menu sits inside the composer's form).
    expect(off.match(/data-step-in-newest="off"/g)).toHaveLength(1);
    expect(off).toMatch(/<button type="button"[^>]*aria-pressed="false"[^>]*data-step-in-newest="off"[^>]*>🖼 Always the newest picture<\/button>/);
    const path = `/api/admin/after-dark/step-in/${id}/picture`;
    const sub = await subscriber();
    expect((await picturePut(put(path, { newest: true }, sub.cookie), ctx(id))).status).toBe(404);
    expect((await picturePut(put(path, { newest: "yes" }, a.cookie), ctx(id))).status).toBe(422);
    expect((await picturePut(put(path, {}, a.cookie), ctx(id))).status).toBe(422);
    const res = await picturePut(put(path, { newest: true }, a.cookie), ctx(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pictures: { newest: true, beside: reply } });
    signIn(a.id);
    const on = await page(id);
    expect(on.match(/data-step-in-newest="on"/g)).toHaveLength(2);
    expect(on).toContain("🖼 Always the newest picture: on");
    expect(on).toMatch(/aria-pressed="true"[^>]*data-step-in-newest="on"[^>]*>✓ Always the newest picture<\/button>/);
    // Where only text is allowed there are no pictures to choose among: refused like every picture move, and not offered.
    await saveAdultSettings(t.db, { rollout: { companion: "everyone" } });
    signIn(sub.id);
    const theirs = await startStepIn(t.db, sub.id, { character_id: JUNIPER, place: HOME });
    if (!theirs.ok) throw new Error(theirs.message);
    setPlaceForTests({ country: "GB", region: null });
    expect((await picturePut(put(`/api/admin/after-dark/step-in/${theirs.id}/picture`, { newest: true }, sub.cookie), ctx(theirs.id))).status).toBe(451);
    expect(await page(theirs.id)).not.toContain("data-step-in-newest");
  });
});
