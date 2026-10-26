import { unzipSync } from "fflate";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as captionsPost } from "@/app/api/admin/after-dark/captions/route";
import { GET as exportGet, POST as exportPost } from "@/app/api/admin/after-dark/export/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { POST as pgCaptionsPost } from "@/app/api/studio/captions/route";
import { GET as pgExportGet, POST as pgExportPost } from "@/app/api/studio/export/route";
import { deleteAfterDarkData } from "@/lib/account";
import { DIGITAL_SOURCE_TYPE, readXmp } from "@/lib/ai-mark";
import { adultCaptions } from "@/lib/adult/captions";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { savePrivacy } from "@/lib/adult/privacy";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { pruneExports } from "@/lib/media-tools/export";
import { setModelForTests } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// The export pack and captions (lib/media-tools/export.ts, lib/adult/captions.ts, lib/studio/pg-captions.ts): no live
// calls; no bucket, so exports are kept in their row.
let t: Awaited<ReturnType<typeof startTestDb>>;
let PNG: Buffer;
beforeAll(async () => {
  t = await startTestDb();
  PNG = await sharp({ create: { width: 300, height: 400, channels: 3, background: "#553366" } }).png().toBuffer();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setModelForTests(null);
  setSeasonCastForTests(null);
});

const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const post = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const get = (handler: (r: Request) => Promise<Response>, path: string, cookie: string) => handler(new Request(`${BASE_URL}${path}`, { headers: { cookie } }));
async function admin() {
  const id = crypto.randomUUID();
  await claimAdmin(t.db, id);
  const cookie = signedInCookie(id);
  await post(settingsPost, "/api/admin/after-dark/settings", { enabled: true, openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }, cookie);
  return { id, cookie };
}
/** One of the owner's After Dark pictures (of one character, or of two). */
async function picture(owner: string, a: string, b: string | null = null, kind: "scene" | "baseline" = "scene") {
  const id = crypto.randomUUID();
  await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status) values ($1, $2, $3, $4, $5, 'p', 'image/png', $6, 'ready')`, [id, owner, a, b, kind, PNG]);
  return id;
}
const CAPTIONS = JSON.stringify({ captions: ["Caught me thinking about you.", "Some nights write themselves.", "You should see the view from here."], hashtags: ["#latenight", "#nofilter", "not a tag!"], safe: "A good night in." });

describe("an After Dark export", () => {
  it("packs their own pictures at the sizes asked, names saying nothing (discreet by default), every file marked", async () => {
    const me = await admin();
    const one = await picture(me.id, JUNIPER);
    const two = await picture(me.id, JUNIPER, RAFE);
    const res = await post(exportPost, "/api/admin/after-dark/export", { items: [one, two], sizes: ["original", "story"], format: "jpg" }, me.cookie);
    expect(res.status).toBe(200);
    const made = (await res.json()).export as { id: string; status: string; filename: string; files: number };
    expect(made).toMatchObject({ status: "ready", files: 4 });
    expect(made.filename).toMatch(/^botchelor-\d{4}-\d{2}-\d{2}\.zip$/);
    const dl = await get(exportGet, `/api/admin/after-dark/export?id=${made.id}`, me.cookie);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-disposition")).toContain(made.filename);
    expect(dl.headers.get("x-ai-generated")).toBe("true");
    const files = unzipSync(new Uint8Array(await dl.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(["about.txt", "botchelor-01-original.jpg", "botchelor-01-story.jpg", "botchelor-02-original.jpg", "botchelor-02-story.jpg"]);
    for (const [name, bytes] of Object.entries(files)) if (name.endsWith(".jpg")) expect(readXmp(bytes)).toContain(DIGITAL_SOURCE_TYPE);
    expect(Buffer.from(files["about.txt"]).toString()).toMatch(/made with AI/);
    // With the neutral title off, names say whose they are.
    await savePrivacy(t.db, me.id, { neutral_title: false });
    const named = (await (await post(exportPost, "/api/admin/after-dark/export", { items: [one], sizes: ["square"], format: "png" }, me.cookie)).json()).export as { filename: string };
    expect(named.filename).toMatch(/^juniper[a-z-]*-01-square\.png$/);
    // Their exports still kept.
    const list = (await (await get(exportGet, "/api/admin/after-dark/export", me.cookie)).json()).exports as { id: string }[];
    expect(list.map((e) => e.id)).toContain(made.id);
  });

  it("leaves out what isn't theirs (another's character in it, another person's picture) and says why", async () => {
    const me = await admin();
    const mine = await picture(me.id, JUNIPER);
    const theirOwner = crypto.randomUUID();
    const theirs = await picture(theirOwner, JUNIPER);
    // A character of someone else's in one of my pictures.
    const someone = signedInCookie(theirOwner);
    const other = (await (await api.createCharacter(validCharacter({ name: `Oli ${theirOwner.slice(0, 6)}` }), someone)).json()).id as string;
    const withOther = await picture(me.id, JUNIPER, other);
    const r = (await (await post(exportPost, "/api/admin/after-dark/export", { items: [mine, theirs, withOther], sizes: ["original"] }, me.cookie)).json()).export as { files: number; skipped: { id: string; why: string }[] };
    expect(r.files).toBe(1);
    expect(r.skipped).toEqual(expect.arrayContaining([{ id: theirs, why: "it isn't one of yours, or isn't ready" }, { id: withOther, why: "someone else's character is in it" }]));
    // Nothing of theirs at all: refused.
    expect((await post(exportPost, "/api/admin/after-dark/export", { items: [theirs], sizes: ["original"] }, me.cookie)).status).toBe(404);
    // Someone else's export isn't theirs to download.
    const made = (await (await post(exportPost, "/api/admin/after-dark/export", { items: [mine], sizes: ["original"] }, me.cookie)).json()).export as { id: string };
    const stranger = await admin();
    expect((await get(exportGet, `/api/admin/after-dark/export?id=${made.id}`, stranger.cookie)).status).toBe(404);
  });

  it("downloads one picture at one size as itself, adds captions.txt and a sheet when asked, and goes after a day", async () => {
    const me = await admin();
    const one = await picture(me.id, JUNIPER);
    const two = await picture(me.id, RAFE);
    const single = (await (await post(exportPost, "/api/admin/after-dark/export", { items: [one], sizes: ["original"], format: "png" }, me.cookie)).json()).export as { id: string; filename: string };
    expect(single.filename).toMatch(/\.png$/);
    const dl = await get(exportGet, `/api/admin/after-dark/export?id=${single.id}`, me.cookie);
    expect(dl.headers.get("content-type")).toBe("image/png");
    setAdultModelForTests({ complete: async () => CAPTIONS });
    const full = (await (await post(exportPost, "/api/admin/after-dark/export", { items: [one, two], sizes: ["feed"], captions: true, sheet: true }, me.cookie)).json()).export as { id: string };
    const files = unzipSync(new Uint8Array(await (await get(exportGet, `/api/admin/after-dark/export?id=${full.id}`, me.cookie)).arrayBuffer()));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["sheet.jpg", "captions.txt"]));
    const text = Buffer.from(files["captions.txt"]).toString();
    expect(text).toContain("Caught me thinking about you.");
    expect(text).toContain("#latenight #nofilter #AIgenerated #AIart");
    // A day on, it's gone: no download, and the daily job prunes it.
    await t.db.query(`update media_exports set expires_at = now() - interval '1 minute' where id = $1`, [full.id]);
    expect((await get(exportGet, `/api/admin/after-dark/export?id=${full.id}`, me.cookie)).status).toBe(404);
    expect(await pruneExports(t.db)).toBeGreaterThanOrEqual(1);
    expect((await t.db.query(`select 1 from media_exports where id = $1`, [full.id])).rows).toHaveLength(0);
  });

  it("is one at a time, and goes with the account", async () => {
    const me = await admin();
    const one = await picture(me.id, JUNIPER);
    await t.db.query(`insert into media_exports (id, owner_id, area, filename, mime, expires_at) values ('busy', $1, 'after-dark', '', 'application/zip', now() + interval '1 day')`, [me.id]);
    expect((await post(exportPost, "/api/admin/after-dark/export", { items: [one], sizes: ["original"] }, me.cookie)).status).toBe(409);
    await deleteAfterDarkData(t.db, me.id);
    expect((await t.db.query(`select 1 from media_exports where owner_id = $1`, [me.id])).rows).toHaveLength(0);
  });
});

describe("captions in their voice", () => {
  it("keeps three that hold to the lines, real hashtags plus the AI ones, a safe line; then reads them back", async () => {
    const me = await admin();
    const one = await picture(me.id, JUNIPER);
    let calls = 0;
    setAdultModelForTests({
      complete: async () => {
        calls++;
        return JSON.stringify({ captions: ["Caught me thinking about you.", "Some say I look like a teen here.", "Some nights write themselves."], hashtags: ["#latenight"], safe: "Feeling sexy tonight." });
      },
    });
    const res = await post(captionsPost, "/api/admin/after-dark/captions", { media_id: one }, me.cookie);
    expect(res.status).toBe(200);
    const c = (await res.json()).captions as { options: string[]; hashtags: string[]; safe: string; voice: string };
    // The one that crosses a line is dropped; the safe line that isn't safe is replaced.
    expect(c.options).toEqual(["Caught me thinking about you.", "Some nights write themselves."]);
    expect(c.hashtags).toEqual(["#latenight", "#AIgenerated", "#AIart"]);
    expect(c.safe).not.toMatch(/sexy/i);
    expect(c.voice).toBe(JUNIPER);
    // Kept: asked again, no new call; "three more" writes again.
    await post(captionsPost, "/api/admin/after-dark/captions", { media_id: one }, me.cookie);
    expect(calls).toBe(1);
    await post(captionsPost, "/api/admin/after-dark/captions", { media_id: one, fresh: true }, me.cookie);
    expect(calls).toBe(2);
    // Someone else's picture: not theirs to caption.
    const stranger = await admin();
    expect((await post(captionsPost, "/api/admin/after-dark/captions", { media_id: one }, stranger.cookie)).status).toBe(404);
  });

  it("tries once more when the first reply can't be used, then says so", async () => {
    const me = await admin();
    const one = await picture(me.id, JUNIPER);
    const replies = ["not json", CAPTIONS];
    setAdultModelForTests({ complete: async () => replies.shift() ?? "" });
    expect((await adultCaptions(t.db, me.id, one)).ok).toBe(true);
    setAdultModelForTests({ complete: async () => "never json" });
    expect(await adultCaptions(t.db, me.id, one, { fresh: true })).toMatchObject({ ok: false, status: 422 });
  });
});

describe("the PG Studio's export and captions", () => {
  it("packs and captions only the person's own PG pictures, with the show's free model", async () => {
    const uid = crypto.randomUUID();
    const cookie = signedInCookie(uid);
    const char = (await (await api.createCharacter(validCharacter({ name: `Pia ${uid.slice(0, 6)}` }), cookie)).json()).id as string;
    const pid = crypto.randomUUID();
    await t.db.query(`insert into studio_pg_pictures (id, owner_id, character_id, mime, data, content_rating) values ($1, $2, $3, 'image/png', $4, 'pg')`, [pid, uid, char, PNG]);
    const made = (await (await post(pgExportPost, "/api/studio/export", { items: [pid], sizes: ["story", "square"] }, cookie)).json()).export as { id: string; filename: string };
    expect(made.filename).toMatch(/^pia-[a-z0-9]+-\d{4}-\d{2}-\d{2}\.zip$/);
    const files = unzipSync(new Uint8Array(await (await get(pgExportGet, `/api/studio/export?id=${made.id}`, cookie)).arrayBuffer()));
    expect(Object.keys(files).filter((n) => n.endsWith(".jpg"))).toHaveLength(2);
    // Not theirs: another person can't export or caption it.
    const other = signedInCookie(crypto.randomUUID());
    expect((await post(pgExportPost, "/api/studio/export", { items: [pid], sizes: ["original"] }, other)).status).toBe(404);
    expect((await post(pgCaptionsPost, "/api/studio/captions", { picture_id: pid }, other)).status).toBe(404);
    setModelForTests({ complete: async () => CAPTIONS });
    const c = (await (await post(pgCaptionsPost, "/api/studio/captions", { picture_id: pid }, cookie)).json()).captions as { options: string[]; hashtags: string[] };
    expect(c.options).toHaveLength(3);
    expect(c.hashtags).toContain("#AIgenerated");
  });
});

describe("the tiles' tools and the export dialog", () => {
  it("offer Download and Caption, a tick while picking, and every size, format and extra", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: TileTools, SelectBar } = await import("@/app/studio/TileTools");
    const { default: ExportDialog } = await import("@/app/studio/ExportDialog");
    const { AFTER_DARK_API, PG_API } = await import("@/app/studio/selection");
    const tile = renderToStaticMarkup(createElement(TileTools, { id: "p1", api: AFTER_DARK_API }));
    expect(tile).toContain("⬇ Download");
    expect(tile).toContain("✍️ Caption");
    const picking = renderToStaticMarkup(createElement(TileTools, { id: "p1", api: PG_API, selecting: true, selected: true, onToggle: () => {} }));
    expect(picking).toContain("✓ Picked");
    expect(picking).not.toContain("Download");
    expect(renderToStaticMarkup(createElement(SelectBar, { count: 2, total: 5, onAll: () => {}, onExport: () => {}, onDone: () => {} }))).toMatch(/<strong>2<\/strong> of 5 picked[\s\S]*Pick all[\s\S]*Export 2 pictures…/);
    const dialog = renderToStaticMarkup(createElement(ExportDialog, { ids: ["a", "b"], api: AFTER_DARK_API, onClose: () => {} }));
    for (const label of ["As made", "Story 9:16", "Feed 4:5", "Square 1:1", "JPG (smaller)", "PNG (sharpest)", "captions.txt", "contact sheet", "badge", "Pack 2 files"]) expect(dialog).toContain(label);
    expect(dialog).toContain("Every file says it was made with AI in its own metadata");
  });
});
