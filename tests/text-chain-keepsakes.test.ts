// The date's photo in the couple's thread (lib/text-chain.ts `keepsakes`, lib/date-photo.ts; 2026-11-16: the owner made
// two real photos of a date and they showed in no thread). The snapshot for every date, the real photo in its place,
// who sees it (the chain's own layers), that it never says how the date went, and DATE_PHOTO_IN_CHAIN.
// Gifts in the chain are in tests/character-gifts.test.ts; the photos route in tests/date-photos.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import PublicThread from "@/app/couples/[a]/[b]/PublicThread";
import Thread from "@/app/couples/[a]/[b]/Thread";
import ThreadPreview from "@/app/couples/[a]/[b]/ThreadPreview";
import { GET as getTexts } from "@/app/api/couples/[a]/[b]/texts/route";
import { recordAsset, reviewAsset } from "@/lib/assets";
import { datePhotoInChain, datePhotoLine, PHOTO_LINES, photoSender, REAL_PHOTO_LINES, realPhotoLines } from "@/lib/date-photo";
import type { SideOutcome } from "@/lib/engine";
import type { CharacterRef } from "@/lib/game";
import { loadThread } from "@/lib/inbox";
import { pairKey, type End } from "@/lib/relationships";
import { ENDING_LABELS, REPORT_HIDE_THRESHOLD } from "@/lib/rules";
import { toneOf, TONES } from "@/lib/sheet-tone";
import { loadChain, loadChainsFor, PUBLIC_VIEWER, publicKeepsakes, type ChainItem, type ChainPhoto } from "@/lib/text-chain";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Line = { side: "a" | "b"; text: string };
const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function owner() {
  const creator = newUserCookie();
  const character = await (await api.createCharacter(validCharacter(), creator)).json();
  const [lo, hi] = pairKey(character.id, HOUSE_PARTNER_ID);
  const me: End = character.id === lo ? "lo" : "hi";
  // More dates in a day than the free ones.
  await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 10, 'test')`, [crypto.randomUUID(), userIdOf(creator)]);
  return { creator, userId: userIdOf(creator), character, lo, hi, me, them: (me === "lo" ? "hi" : "lo") as End };
}

/** A date with the house partner at `at`, with its morning-after texts (side "a" is the owner's character). */
async function date(creator: string, characterId: string, at: string, afterglow: Line[], opts: { air?: boolean; visibility?: "private" | "unlisted" } = {}) {
  scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID, ...(opts.visibility ? { visibility: opts.visibility } : {}) }, creator);
  expect(res.status).toBe(200);
  const episode = await res.json();
  if (opts.air !== false && opts.visibility !== "private") await api.reveal(episode.id, creator);
  await t.db.query(`update episodes set created_at = $2, afterglow = $3::jsonb where id = $1`, [episode.id, at, JSON.stringify(afterglow)]);
  return episode;
}

/** A real date photo (lib/studio/date-photos.ts): an asset kept with the date, approved and rated as asked. */
async function realPhoto(episodeId: string, characterId: string, ownerId: string, opts: { approve?: boolean; rating?: "pg" | "suggestive"; at?: string } = {}) {
  const asset = await recordAsset(t.db, { character_id: characterId, kind: "photo", source_type: "generated", source_model: "test", prompt: "the two of them", url: PNG_1X1, content_rating: opts.rating ?? "pg" });
  await t.db.query(`insert into date_photos (asset_id, episode_id, owner_id, style, created_at) values ($1, $2, $3, 'selfie', $4)`, [asset, episodeId, ownerId, opts.at ?? new Date().toISOString()]);
  if (opts.approve !== false) await reviewAsset(t.db, asset, "approved", "test");
  return asset;
}

const kinds = (items: ChainItem[]) => items.map((i) => (i.kind === "text" ? `text:${i.source}` : i.kind === "event" ? i.event : i.kind));
const photos = (items: ChainItem[]) => items.filter((i): i is ChainPhoto => i.kind === "photo");
const ALL_LINES = [...Object.values(PHOTO_LINES).flat(), ...Object.values(REAL_PHOTO_LINES).flat()];

describe("the date's photo in the couple's thread", () => {
  it("every date has one right after its marker and before the morning after: the snapshot, from one of the two, with a line", async () => {
    const { creator, userId, character, lo } = await owner();
    const ep = await date(creator, character.id, "2026-10-10T19:00:00Z", [
      { side: "a", text: "Last night was fun." },
      { side: "b", text: "It really was." },
    ]);
    const chain = await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }, { keepsakes: true });
    expect(kinds(chain)).toEqual(["date", "photo", "text:afterglow", "text:afterglow"]);
    const [p] = photos(chain);
    expect(p).toMatchObject({ episode_id: ep.id, src: `/api/og/date-photo/${ep.id}`, real: false, day: "2026-10-10" });
    // Side "a" is the owner's character (it booked the date): the sender is dealt by the date, and stays the same.
    expect(p.who).toBe(((photoSender(ep.id) === "a") === (character.id === lo) ? "lo" : "hi") as End);
    expect(p.alt).toMatch(/^A photo from the date: \S+ and \S+ at .+, Saturday, October 10\.$/);
    const template = (l: string) => new RegExp(`^${l.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace("\\{place\\}", ".+").replace("{place}", ".+")}$`);
    expect(Object.values(PHOTO_LINES).flat().some((l) => template(l).test(p.text))).toBe(true);
    expect(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }, { keepsakes: true })).toEqual(chain);
  });

  it("is only for a reader that asks: a prompt's chain, the agents' and the inbox list never have it", async () => {
    const { creator, userId, character } = await owner();
    await date(creator, character.id, "2026-10-10T19:00:00Z", [{ side: "a", text: "Hi." }]);
    expect(kinds(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }))).toEqual(["date", "text:afterglow"]);
    expect(kinds(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { usableBy: userId }, { keepsakes: true }))).toEqual(["date", "text:afterglow"]);
    expect(kinds((await loadChainsFor(t.db, character.id, { userId, owner: true })).get(HOUSE_PARTNER_ID)!)).toEqual(["date", "text:afterglow"]);
    // The phone's first page and its paging route do.
    const thread = await loadThread(t.db, userId, character.id, HOUSE_PARTNER_ID);
    expect(kinds(thread!.chain.items)).toEqual(["date", "photo", "text:afterglow"]);
    const [lo, hi] = pairKey(character.id, HOUSE_PARTNER_ID);
    const res = await getTexts(new Request(`${BASE_URL}/api/couples/${lo}/${hi}/texts`, { headers: { cookie: creator } }), { params: Promise.resolve({ a: lo, b: hi }) });
    expect(kinds((await res.json()).items)).toEqual(["date", "photo", "text:afterglow"]);
  });

  it("a real photo upgrades it in place: the newest approved pg one, and never one that isn't", async () => {
    const { creator, userId, character } = await owner();
    const ep = await date(creator, character.id, "2026-10-10T19:00:00Z", []);
    const before = photos(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }, { keepsakes: true }))[0];
    const pending = await realPhoto(ep.id, character.id, userId, { approve: false, at: "2026-10-10T20:00:00Z" });
    const suggestive = await realPhoto(ep.id, character.id, userId, { rating: "suggestive", at: "2026-10-10T20:05:00Z" });
    expect(photos(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }, { keepsakes: true }))[0]).toEqual(before);
    const first = await realPhoto(ep.id, character.id, userId, { at: "2026-10-10T20:10:00Z" });
    const second = await realPhoto(ep.id, character.id, userId, { at: "2026-10-10T20:20:00Z" });
    const after = photos(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }, { keepsakes: true }))[0];
    // The same item (its id, sender, line and alt text), a different picture.
    expect(after).toEqual({ ...before, src: `/api/assets/${second}`, real: true });
    expect([pending, suggestive, first]).not.toContain(after.src.split("/").pop());
  });

  it("the 📷 text that used to carry the photo isn't shown beside it; an older one's stays", async () => {
    const { creator, userId, character, lo, hi, me } = await owner();
    const ep = await date(creator, character.id, "2026-10-10T19:00:00Z", []);
    const older = await realPhoto(ep.id, character.id, userId, { at: "2026-10-10T20:10:00Z" });
    const newest = await realPhoto(ep.id, character.id, userId, { at: "2026-10-10T20:20:00Z" });
    for (const [seq, asset] of [older, newest].entries()) {
      await t.db.query(`insert into couple_texts (character_lo, character_hi, day, seq, who, text, via, photo, created_at) values ($1, $2, '2026-10-10', $3, $4, '📷', 'photo', $5, $6)`, [
        lo, hi, seq + 1, me, asset, `2026-10-10T20:3${seq}:00Z`,
      ]);
    }
    const chain = await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }, { keepsakes: true });
    expect(kinds(chain)).toEqual(["date", "photo", "text:between"]);
    expect(chain[2]).toMatchObject({ photo: `/api/assets/${older}` });
    // A reader that doesn't ask sees the texts as they were stored.
    expect(kinds(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }))).toEqual(["date", "text:between", "text:between"]);
  });

  it("follows its date: an unaired, an unlisted or a private date's photo is for its owners only", async () => {
    const { creator, userId, character } = await owner();
    const aired = await date(creator, character.id, "2026-10-10T19:00:00Z", [{ side: "a", text: "That was something." }]);
    const unlisted = await date(creator, character.id, "2026-10-11T19:00:00Z", [], { visibility: "unlisted" });
    const hidden = await date(creator, character.id, "2026-10-12T19:00:00Z", [], { visibility: "private" });
    const unaired = await date(creator, character.id, "2026-10-13T19:00:00Z", [{ side: "a", text: "Held until it airs." }], { air: false });
    await realPhoto(unaired.id, character.id, userId);

    const mine = await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }, { keepsakes: true });
    expect(photos(mine).map((p) => p.episode_id)).toEqual([aired.id, unlisted.id, hidden.id, unaired.id]);
    // Before it airs the morning after is held (it gives the ending away); the photo isn't, because it doesn't.
    expect(kinds(mine).slice(-3)).toEqual(["date", "photo", "afterglow_held"]);

    // Anyone else: the public layer holds the aired public date only, and of it the date and the photo, never a text.
    const anyone = publicKeepsakes(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, PUBLIC_VIEWER, { keepsakes: true }));
    expect(anyone.map((i) => `${i.kind}:${i.episode_id}`)).toEqual([`date:${aired.id}`, `photo:${aired.id}`]);
    expect(JSON.stringify(anyone)).not.toContain("That was something.");

    // Another owner's private date stays that owner's: the house partner's side has no owner, so try a stranger-owner layer.
    const stranger = await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId: crypto.randomUUID(), owner: true }, { keepsakes: true });
    expect(photos(stranger).map((p) => p.episode_id)).not.toContain(hidden.id);

    // Reported away: the date goes, and its photo with it.
    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) {
      await t.db.query(`insert into reports (episode_id, reporter_id) values ($1, $2)`, [aired.id, `reporter-${i}`]);
    }
    expect(publicKeepsakes(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, PUBLIC_VIEWER, { keepsakes: true }))).toEqual([]);
  });

  it("never says how the date went: the line, the alt text and the picture's address are the same for every ending", async () => {
    const { creator, userId, character } = await owner();
    const ep = await date(creator, character.id, "2026-10-10T19:00:00Z", []);
    const seen: string[] = [];
    for (const ending of ["second_date", "friends", "disaster"] as const) {
      await t.db.query(`update episodes set ending = $2, ending_detail = $3 where id = $1`, [ep.id, ending, ending === "disaster" ? "ghosted" : null]);
      const [p] = photos(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }, { keepsakes: true }));
      seen.push(JSON.stringify(p));
      for (const label of Object.values(ENDING_LABELS)) expect(JSON.stringify(p)).not.toContain(label);
    }
    expect(new Set(seen).size).toBe(1);
    // And no template has a word for an ending, a feeling about it or a next date in it.
    for (const line of ALL_LINES) expect(line).not.toMatch(/second date|another|again|friends?\b|disaster|went (?:well|badly)|spark|love|miss|sorry|best|worst|never/i);
  });

  it("the line is in the sender's tone, from their public sheet, and needs a place only when there is one", () => {
    expect(toneOf({ traits: ["warm", "kind"] })).toBe("warm");
    expect(toneOf({ traits: ["deadpan"], voice: "dry, teasing" })).toBe("wry");
    expect(toneOf({ traits: ["guarded"] })).toBe("reserved");
    expect(toneOf({ traits: ["cold", "aloof"] })).toBe("reserved");
    expect(toneOf({ traits: ["tall", "punctual"] })).toBe("plain");
    for (const tone of TONES) {
      const sheet = { traits: tone === "warm" ? ["warm"] : tone === "wry" ? ["witty"] : tone === "reserved" ? ["guarded"] : ["tall"] };
      for (let n = 0; n < 12; n++) {
        const withPlace = datePhotoLine({ id: `ep-${n}`, venue: "safari" }, sheet);
        expect(PHOTO_LINES[tone].map((l) => l.replace("{place}", "a safari jeep at dawn"))).toContain(withPlace);
        const without = datePhotoLine({ id: `ep-${n}`, venue: null }, sheet);
        expect(PHOTO_LINES[tone].filter((l) => !l.includes("{place}"))).toContain(without);
        expect(datePhotoLine({ id: `ep-${n}`, venue: null }, sheet)).toBe(without);
      }
      expect(realPhotoLines(sheet)[0]).toBe("Look at us.");
    }
  });

  it("DATE_PHOTO_IN_CHAIN=0 takes the photos out and leaves the thread as it was", async () => {
    expect(datePhotoInChain({})).toBe(true);
    expect(datePhotoInChain({ DATE_PHOTO_IN_CHAIN: "0" })).toBe(false);
    const { creator, userId, character } = await owner();
    await date(creator, character.id, "2026-10-10T19:00:00Z", [{ side: "a", text: "Hi." }]);
    expect(kinds(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }, { keepsakes: true, env: { DATE_PHOTO_IN_CHAIN: "0" } }))).toEqual(["date", "text:afterglow"]);
    vi.stubEnv("DATE_PHOTO_IN_CHAIN", "0");
    expect(kinds(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }, { keepsakes: true }))).toEqual(["date", "text:afterglow"]);
  });
});

describe("the photo and a gift on the phone (app/couples/[a]/[b])", () => {
  const characters: Record<End, CharacterRef> = {
    lo: { id: "c-lo", name: "Juniper Vale", house: true, hue: 20, portrait: null },
    hi: { id: "c-hi", name: "Sable Quist", house: true, hue: 200, portrait: null },
  };
  const items: ChainItem[] = [
    { kind: "date", id: "2026-11-16T00:22:57.000Z#000#d:ep-1", at: "2026-11-16T00:22:57.000Z", day: "2026-11-16", episode_id: "ep-1", number: 3, venue: "A safari jeep at dawn", ending_label: "A second date", aired: true },
    { kind: "photo", id: "2026-11-16T00:22:57.000Z#000#p:ep-1", at: "2026-11-16T00:22:57.000Z", day: "2026-11-16", who: "hi", episode_id: "ep-1", src: "/api/assets/photo-1", real: true, alt: "A photo from the date: Sable and Juniper at a safari jeep at dawn, Monday, November 16.", text: "Exhibit A." },
    { kind: "gift", id: "2026-11-16T00:40:00.000Z#500#gift:g-1", at: "2026-11-16T00:40:00.000Z", day: "2026-11-16", who: "lo", episode_id: "ep-1", name: "a postcard of a giraffe", note: "It stared at you first. I only noticed.", reaction: "amused", reply: "A bold choice. I respect it." },
  ];
  const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

  it("someone watching sees the date, its photo with the sender's line, the gift, its note and the reply, and no side is theirs", () => {
    const html = text(renderToStaticMarkup(PublicThread({ items: publicKeepsakes(items), characters, today: "2026-11-16", texted: false })));
    expect(html).toContain("Date 3 · A safari jeep at dawn");
    expect(html).toContain('src="/api/assets/photo-1"');
    expect(html).toContain('alt="A photo from the date: Sable and Juniper at a safari jeep at dawn, Monday, November 16."');
    expect(html).toContain('href="/episodes/ep-1"');
    expect(html).toContain("Exhibit A.");
    expect(html).toContain("Juniper left Sable a postcard of a giraffe");
    expect(html.indexOf("It stared at you first.")).toBeLessThan(html.indexOf("A bold choice. I respect it."));
    expect(html).not.toContain("phone-msg-me");
    // A house couple: nobody owns them, so there are no private texts to point at.
    expect(html).toContain("Only Juniper and Sable can text here");
    expect(html).not.toContain("private");
    const owned = text(renderToStaticMarkup(PublicThread({ items: publicKeepsakes(items), characters, today: "2026-11-16", texted: true })));
    expect(owned).toContain("Their texts are private");
    expect(owned).toContain('href="/create"');
  });

  it("the owner's phone puts the sender's photo on the sender's side, and the preview counts a photo and a gift among the newest", () => {
    const mine = text(renderToStaticMarkup(Thread({ items, me: "hi", characters, today: "2026-11-16" })));
    expect(mine).toMatch(/phone-msg-me[^"]*"><div class="phone-photo-msg">/);
    const preview = text(renderToStaticMarkup(ThreadPreview({ items, characters, mine: "hi", thread: "/messages/c-lo/c-hi" })));
    expect(preview).toContain('class="thread-preview-photo" src="/api/assets/photo-1"');
    expect(preview).toContain("Juniper left Sable a postcard of a giraffe.");
    expect(preview).not.toContain("No texts yet");
  });
});
