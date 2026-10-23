import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import AfterDarkTheater from "@/app/after-dark/[a]/[b]/AfterDarkTheater";
import ListenLines from "@/app/after-dark/[a]/[b]/Listen";
import MediaMenu from "@/app/after-dark/[a]/[b]/MediaMenu";
import { GET } from "@/app/api/admin/after-dark/route";
import { GET as clipsGet, POST as clipsPost } from "@/app/api/admin/after-dark/clips/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { HELD_BEAT_MS } from "@/app/useReplay";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { setReelFetchForTests, setReelPausesForTests, type Reel } from "@/lib/adult/reels";
import type { AdultScene } from "@/lib/adult/scenes";
import { claimAdmin } from "@/lib/admins";
import type { CharacterRef } from "@/lib/game";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// The media UI (app/after-dark/[a]/[b]/MediaMenu.tsx, Listen.tsx; David 2026-10-22) and what it asks the server for.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setReelPausesForTests(false);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setReelFetchForTests(null);
  setCheckFetchForTests(null);
  setReelPausesForTests(true);
});

const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
async function ready(cookie: string, ownerId: string, lines: unknown[], stage: number) {
  await call(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }, cookie);
  for (const [pid, c] of [["base-juniper", JUNIPER], ["base-rafe", RAFE]]) {
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data) values ($1, $2, $3, 'baseline', 'p', 'image/png', $4)`, [pid, ownerId, c, Buffer.from(PNG)]);
  }
  const scene = (await (await GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json()).scene as { id: string };
  await t.db.query(`update adult_scenes set lines = $2::jsonb, stage = $3, place = 'her bedroom', set_place = 'her bedroom' where id = $1`, [scene.id, JSON.stringify(lines), stage]);
  return scene;
}
function fakeMedia() {
  const seen: { path: string; body: Record<string, unknown> }[] = [];
  setReelFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace("https://api.venice.ai/api/v1", "");
    seen.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
    if (path === "/image/multi-edit") return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } });
    if (path === "/video/queue") return Response.json({ queue_id: "q1" });
    return new Response("?", { status: 500 });
  });
  setCheckFetchForTests(async (input: RequestInfo | URL) =>
    Response.json(String(input) === HIVE_VLM ? { choices: [{ message: { content: '{"answer": "ADULTS"}' } }] } : { output: [{ classes: [{ class: "no_child_present", value: 0.99 }, { class: "yes_child_present", value: 0.01 }] }] }),
  );
  return seen;
}

describe("a clip of the moment the theater is showing", () => {
  it("films the line it's on (`at`), held to how far the night had gone there, not where it is now", async () => {
    const { id, cookie } = await admin();
    const lines = [
      { who: "a", text: "*smiles* Hello again, you menace with the kettle.", stage: 0 },
      { who: "b", text: "*laughs* I brought the terrible tea, as promised.", stage: 0 },
      { who: "a", text: "*leans in close* Then come here and pour it.", stage: 1 },
      { who: "b", text: "*kisses her* There. Better than tea.", stage: 2 },
      { who: "a", text: "*pulls his shirt off* Much better than tea.", stage: 3 },
    ];
    await ready(cookie, id, lines, 3);
    const seen = fakeMedia();
    let asked = "";
    setAdultModelForTests({
      complete: async (messages) => {
        asked = String(messages[1].content);
        return JSON.stringify({ frame: "They kiss, his shirt off on the floor.", motion: "He pulls her closer.", line: 2 });
      },
    });
    const res = await call(clipsPost, "/api/admin/after-dark/clips", { a: RAFE, b: JUNIPER, here: true, at: 2 }, cookie);
    expect(res.status).toBe(200);
    // The director read up to line 2 only.
    expect(asked).toContain("Then come here and pour it.");
    expect(asked).not.toContain("Better than tea");
    expect(asked).toContain("It shows no more than tension and the first touches.");
    // Line 2 was at tension: a kiss with his shirt off goes past it, so the plain still for that stage.
    const reel = (await res.json()).reel as Reel;
    expect(reel.clip).toMatchObject({ stage: 1, label: "From here" });
    expect(reel.shots[0]).toMatchObject({ line: 2, text: "Then come here and pour it." });
    expect(String(seen.find((s) => s.path === "/image/multi-edit")!.body.prompt)).toContain("one's hand on the other's waist, both dressed");
  });

  it("films a moment of a saved night too, and needs a line before it", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, [{ who: "a", text: "Hi.", stage: 0 }], 0);
    await t.db.query(`insert into adult_nights (id, owner_id, character_a, character_b, lines, stage) values ('night-1', $1, $2, $3, $4::jsonb, 2)`, [
      id,
      JUNIPER,
      RAFE,
      JSON.stringify([
        { who: "a", text: "*waves* The ferry's late again tonight, of course.", stage: 2 },
        { who: "b", text: "*kisses her cheek* Then we wait together, properly.", stage: 2 },
      ]),
    ]);
    fakeMedia();
    setAdultModelForTests({ complete: async () => JSON.stringify({ frame: "By the water, the woman and the man close, both dressed.", motion: "He kisses her cheek.", line: 1 }) });
    const res = await call(clipsPost, "/api/admin/after-dark/clips", { a: RAFE, b: JUNIPER, here: true, at: 1, night_id: "night-1" }, cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()).reel as Reel).shots[0].text).toBe("Then we wait together, properly.");
    expect((await call(clipsPost, "/api/admin/after-dark/clips", { a: RAFE, b: JUNIPER, here: true, at: 0, night_id: "night-1" }, cookie)).status).toBe(409);
    // Someone else's night isn't theirs.
    const other = await admin();
    expect((await call(clipsPost, "/api/admin/after-dark/clips", { a: RAFE, b: JUNIPER, here: true, at: 1, night_id: "night-1" }, other.cookie)).status).toBe(404);
  });

  it("names who's who both ways round on the menu", async () => {
    const { id, cookie } = await admin();
    await ready(cookie, id, [{ who: "a", text: "Hi.", stage: 4 }], 4);
    const menu = await (await clipsGet(new Request(`${BASE_URL}/api/admin/after-dark/clips?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json();
    expect(menu.acts.find((a: { id: string }) => a.id === "on_top")).toMatchObject({ says: "Juniper on top of Rafe", swapped: "Rafe on top of Juniper" });
  });
});

describe("the controls", () => {
  const chars: [CharacterRef, CharacterRef] = [
    { id: "a", name: "Ada Vale", house: false, hue: 300, portrait: null },
    { id: "b", name: "Bo Reyes", house: false, hue: 200, portrait: null },
  ];
  const lines = [
    { who: "a" as const, text: "*smiles* Hi." },
    { who: "b" as const, text: "Hello." },
  ];

  it("puts Listen and Clip this in the theater, live and for a saved night", () => {
    const scene = { lines, place: null, stage: 0, dateVenue: null };
    for (const props of [{ onWrite: async () => {} }, {}]) {
      const html = renderToStaticMarkup(createElement(AfterDarkTheater, { scene, characters: chars, onExit: () => {}, ...props }));
      expect(html).toContain('aria-label="Listen: each line in their own voice"');
      expect(html).toContain("🎞 Clip this");
    }
  });

  it("puts Listen over the lines (nothing when there are none), and the clip or picture panel folded", () => {
    expect(renderToStaticMarkup(createElement(ListenLines, { lines, a: "a", b: "b", names: ["Ada", "Bo"] }))).toContain("🔈 Listen");
    expect(renderToStaticMarkup(createElement(ListenLines, { lines: [], a: "a", b: "b", names: ["Ada", "Bo"] }))).not.toContain("Listen");
    const scene = { id: "s", lines, a: { id: "a", name: "Ada Vale" }, b: { id: "b", name: "Bo Reyes" }, stage: 0, place: null, set_place: null, intensity: "explicit", hard_nos: { chips: [], own: [] } } as unknown as AdultScene;
    const html = renderToStaticMarkup(createElement(MediaMenu, { scene, onReel: () => {}, onPicture: () => {} }));
    expect(html).toMatch(/<details class="ad-panel ad-media">/);
    expect(html).toContain("🎞 A clip or a picture of the two of them");
  });

  it("brings the next line a beat after a held one's voice ends, not a whole turn later", () => {
    expect(HELD_BEAT_MS).toBeLessThan(1000);
  });
});
