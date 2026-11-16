/**
 * The locked picture in a character's texts (lib/locked-picture.ts, lib/locked-picture-texts.ts,
 * lib/adult/locked-picture.ts, lib/locked-picture-tile.ts): what sets the text off, who is sent it and who never is,
 * once a date and once a week, the tile made of PG pixels only (no After Dark table is read to make it), where each tap
 * leads, events without content, the prompt's PG line, and the switch. No model is called anywhere here.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as adminPreview } from "@/app/api/admin/locked-picture/route";
import { GET as getTile } from "@/app/api/locked-picture/[id]/route";
import LockedPicture from "@/app/companion/[id]/LockedPicture";
import { claimAdmin } from "@/lib/admins";
import { doorKind, forgetSeenForTests, lockedDoors, rememberSeen, wayInHref, whoMayBeSent, type DoorFacts } from "@/lib/adult/locked-picture";
import { overnightNightPath } from "@/lib/adult/overnight";
import { loadCharacter } from "@/lib/character";
import { getThread, setCompanionModelForTests } from "@/lib/companion";
import { deleteMessage } from "@/lib/companion-message-delete";
import { companionMessages } from "@/lib/companion-prompt";
import { isTextTag } from "@/lib/companion-shared";
import { crisisIntent } from "@/lib/crisis";
import type { Db } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import {
  LOCKED_PICTURE_COPY,
  LOCKED_PICTURE_LINES,
  LOCKED_PICTURE_RULES,
  LOCKED_PICTURE_SOURCE,
  LOCKED_PICTURE_STAGES,
  lockedDoorWords,
  lockedPictureEpisode,
  lockedPictureLines,
  lockedPicturePromptLine,
  lockedPictureTag,
  lockedPictureTextsOn,
  lockedTilePath,
  steadyOrMore,
  steadyRoll,
  type LockedDoor,
} from "@/lib/locked-picture";
import { lockedPictureAired, lockedPictureForPrompt, lockedPictureTrigger } from "@/lib/locked-picture-texts";
import { rgbOfHsl } from "@/lib/locked-picture-tile";
import { setPlaceForTests } from "@/lib/place";
import { refreshAndAnnounce } from "@/lib/relationship-events";
import { refreshRelationship } from "@/lib/relationships";
import { STAGES } from "@/lib/relationship-stages";
import { checkFamilyTalk } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { clearSharedCache } from "@/lib/shared-cache";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const [H0, H1, H2] = HOUSE_CHARACTERS;
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();
let logged: string[] = [];

beforeEach(async () => {
  await t.reset();
  await t.db.query(`delete from notifications`);
  await t.db.query(`delete from notification_mutes`);
  // What a reset leaves behind that this suite seeds by hand.
  for (const table of ["accounts", "admins", "adult_entitlements", "adult_viewer_places", "adult_switches", "adult_invites", "companion_messages", "companion_threads"]) await t.db.query(`delete from ${table}`);
  clearSharedCache();
  forgetSeenForTests();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  logged = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void logged.push(String(line)));
  setSeasonCastForTests([H0.id, H1.id, H2.id]);
  setPlaceForTests({ country: "CA", region: "ON" });
  setCompanionModelForTests({
    async complete() {
      throw new Error("no model may be called for a locked picture");
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  setSeasonCastForTests(null);
  setPlaceForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ------------------------------------------------------ seeding ------------------------------------------------------ */

let n = 0;
async function character(name: string, owner: string, o: { visibility?: string; anime?: boolean } = {}) {
  const id = `lp-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, extras)
     values ($1, $2, false, $3, 30, 'Bakes bread and argues with the radio.', '["kind"]'::jsonb, 'someone kind', 'liars', $4, $5::jsonb)`,
    [id, owner, name, o.visibility ?? "public", JSON.stringify(o.anime ? { looks: { style: "anime" } } : {})],
  );
  return id;
}
type DateOpts = { ending?: string; overnight?: boolean; visibility?: string; aired?: boolean; stepIn?: boolean; daysAgo?: number; id?: string };
async function date(a: string, b: string, o: DateOpts = {}) {
  const id = o.id ?? `lp-ep-${++n}`;
  const at = new Date(NOW.getTime() - (o.daysAgo ?? 0) * DAY - 60_000);
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, created_at, revealed_at, visibility, setup, transcript)
     values ($1, 'system', $2, $3, 'a bar', '[]'::jsonb, '[]'::jsonb, 'TWIST-WORDS', 'FINALE-WORDS', $4, $5, $6, $7, $8::jsonb, '[]'::jsonb)`,
    [
      id, a, b, o.ending ?? "second_date", at.toISOString(), o.aired === false ? null : at.toISOString(), o.visibility ?? "public",
      JSON.stringify({ venue: "rooftop_bar", ...(o.overnight ? { overnight: true } : {}), ...(o.stepIn ? { met_via: "step_in" } : {}) }),
    ],
  );
  return id;
}
/** A signed-in person: an account, last seen 18+ in `seen` (null: never seen). */
async function person(id: string, seen: "open" | "text_only" | "blocked" | null = "open", seenDaysAgo = 0) {
  await t.db.query(`insert into accounts (user_id, google_sub, email, after_dark_seen_mode, after_dark_seen_at) values ($1, $2, $3, $4, $5)`, [
    id, `g-${id}`, `${id}@example.test`, seen, seen ? new Date(NOW.getTime() - seenDaysAgo * DAY).toISOString() : null,
  ]);
  return id;
}
const optIn = (thread: string, user: string, characterId: string, extra: { muted?: boolean; paused?: boolean } = {}) =>
  t.db.query(`insert into companion_threads (id, user_id, character_id, muted_proactive, paused_at) values ($1, $2, $3, $4, $5)`, [thread, user, characterId, extra.muted === true, extra.paused ? NOW.toISOString() : null]);
/** After Dark open to them (a beta pass), last seen by After Dark in an open place, with these characters switched in. */
async function entitle(user: string, switchIn: string[] = [], provider = "beta") {
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at, provider, period_end) values ($1, 'active', now(), $2, now() + interval '30 days')`, [user, provider]);
  await t.db.query(`insert into adult_viewer_places (user_id, mode, country, region, seen_at) values ($1, 'open', 'CA', 'ON', now())`, [user]);
  for (const c of switchIn) await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [user, c]);
}
const texts = async (thread: string) =>
  (await t.db.query<{ text: string; action: string; role: string; via: string; media_url: string | null }>(`select text, action, role, via, media_url from companion_messages where thread_id = $1 order by created_at, id`, [thread])).rows;
const lockedTexts = async (thread: string) => (await texts(thread)).filter((m) => m.role === "character" && lockedPictureEpisode(m.action));
const events = () => logged.flatMap((l) => (l.includes('"locked_picture_sent"') ? [JSON.parse(l) as Record<string, unknown>] : []));
/** An episode id the steady trigger's seeded roll says yes (or no) to. */
const rolled = (yes: boolean): string => {
  for (let i = 0; i < 500; i++) if (steadyRoll(`lp-roll-${i}`) === yes) return `lp-roll-${i}`;
  throw new Error("no such id");
};

/** A person's character that left an overnight date with a house character together; their thread has texts on. */
async function overnightCouple(user = "owner-1", seen: Parameters<typeof person>[1] = "open") {
  await person(user, seen);
  const mine = await character("Cass Vega", user);
  const ep = await date(mine, H0.id, { overnight: true });
  await optIn(`th-${user}`, user, mine);
  return { user, mine, ep, thread: `th-${user}` };
}

/* ---------------------------------------------------- pure pieces ---------------------------------------------------- */

describe("the switch, the tag and the words (pure)", () => {
  it("LOCKED_PICTURE_TEXTS: on unless it is 0", () => {
    expect(lockedPictureTextsOn({})).toBe(true);
    expect(lockedPictureTextsOn({ LOCKED_PICTURE_TEXTS: "1" })).toBe(true);
    expect(lockedPictureTextsOn({ LOCKED_PICTURE_TEXTS: "0" })).toBe(false);
    expect(lockedPictureTextsOn({ LOCKED_PICTURE_TEXTS: " 0 " })).toBe(false);
  });

  it("the tag is a text tag, names its date, and no other tag reads as one", () => {
    const tag = lockedPictureTag("ep_1-A");
    expect(isTextTag(tag)).toBe(true);
    expect(lockedPictureEpisode(tag)).toBe("ep_1-A");
    for (const other of ["overnight:ep1", "after_date:ep1", "locked_picture:", "locked_picture:a b", null, undefined]) expect(lockedPictureEpisode(other)).toBeNull();
  });

  it("every line is PG, says nothing of what happened or what the picture shows, and never names After Dark", () => {
    const explicit = /\b(sex|naked|nude|bed|kiss|undress|strip|body|skin|lingerie|explicit|nsfw|hot|steamy)\b/i;
    for (const trigger of ["overnight", "steady"] as const) {
      expect(LOCKED_PICTURE_LINES[trigger].length).toBeGreaterThanOrEqual(3);
      for (const [i] of LOCKED_PICTURE_LINES[trigger].entries()) {
        const lines = LOCKED_PICTURE_LINES[trigger][i].map((l) => l.replaceAll("{p}", "Nell"));
        expect(lines).toHaveLength(2);
        for (const line of lines) {
          expect(checkFamilyTalk(line).ok, line).toBe(true);
          expect(crisisIntent(line), line).toBeFalsy();
          expect(line).not.toMatch(explicit);
          expect(line).not.toMatch(/after dark|subscri|plan/i);
        }
        expect(lines.join(" ")).toMatch(/picture/);
      }
    }
    // A steady couple's date wasn't an overnight date: its words never say it was.
    expect(LOCKED_PICTURE_LINES.steady.flat().join(" ")).not.toMatch(/overnight|last night/i);
  });

  it("a character and a date always get the same variant, with the partner's first name", () => {
    const a = lockedPictureLines("overnight", "Nell Okafor", "ep1:c1");
    expect(a).toEqual(lockedPictureLines("overnight", "Nell Okafor", "ep1:c1"));
    expect(a.join(" ")).toContain("Nell");
    expect(a.join(" ")).not.toContain("Okafor");
    expect(a.join(" ")).not.toContain("{p}");
    const seen = new Set(Array.from({ length: 40 }, (_, i) => lockedPictureLines("steady", "Nell", `ep${i}:c`)[0]));
    expect(seen.size).toBe(LOCKED_PICTURE_LINES.steady.length);
  });

  it("the steady roll is one date in five, and the same answer every time for a date", () => {
    const ids = Array.from({ length: 4000 }, (_, i) => `episode-${i}`);
    const yes = ids.filter(steadyRoll).length;
    expect(yes / ids.length).toBeGreaterThan(0.16);
    expect(yes / ids.length).toBeLessThan(0.24);
    expect(ids.map(steadyRoll)).toEqual(ids.map(steadyRoll));
    expect(LOCKED_PICTURE_RULES.steadyOneIn).toBe(5);
  });

  it("going steady or more, as the couple is shown: steady stages and keeping it casual, nothing else", () => {
    expect([...LOCKED_PICTURE_STAGES].sort()).toEqual(["casual", "engaged", "going_steady", "married", "moved_in", "official"]);
    for (const s of STAGES) expect(steadyOrMore(s)).toBe(LOCKED_PICTURE_STAGES.includes(s));
    expect(steadyOrMore(null)).toBe(false);
  });

  it("what sets it off: leaving an overnight date together, or a steady couple's date that ended in another, on the roll", () => {
    const base = { overnight: false, ending: "second_date", stage: "going_steady" as const, roll: true, overnightOn: true };
    expect(lockedPictureTrigger({ ...base, overnight: true, stage: null, roll: false })).toBe("overnight");
    expect(lockedPictureTrigger({ ...base, overnight: true, ending: "friends" })).toBeNull();
    expect(lockedPictureTrigger({ ...base, overnight: true, ending: "disaster" })).toBeNull();
    // OVERNIGHT_DATES=0: an overnight date is told as nothing special, so no text about one either.
    expect(lockedPictureTrigger({ ...base, overnight: true, overnightOn: false })).toBeNull();
    expect(lockedPictureTrigger(base)).toBe("steady");
    expect(lockedPictureTrigger({ ...base, stage: "casual" })).toBe("steady");
    expect(lockedPictureTrigger({ ...base, roll: false })).toBeNull();
    for (const ending of ["friends", "disaster", null]) expect(lockedPictureTrigger({ ...base, ending })).toBeNull();
    for (const stage of ["sparks", "dating", "friends", "exes", "bad_blood", "broke_up", "back_together", null] as const) expect(lockedPictureTrigger({ ...base, stage })).toBeNull();
  });

  it("the tile's words: a lock, never the picture; nothing about the show's own subscription", () => {
    const open = lockedDoorWords({ state: "open", href: "/x" });
    expect(open.button).toBe("Open in After Dark");
    const invite = lockedDoorWords({ state: "way_in", href: "/x", invite_only: true, asked: false });
    expect(invite.button).toBe("Ask for an invite");
    expect(invite.line).toMatch(/18\+/);
    expect(invite.line).toMatch(/optional/);
    expect(invite.line).toMatch(/separate/);
    expect(invite.line).toMatch(/invite only/);
    expect(lockedDoorWords({ state: "way_in", href: "/x", invite_only: true, asked: true }).button).toBe("See your invite request");
    const sub = lockedDoorWords({ state: "way_in", href: "/x", invite_only: false, asked: false });
    expect(sub.button).toBe("See After Dark");
    expect(sub.line).not.toMatch(/invite only/);
    expect(LOCKED_PICTURE_COPY.label).toBe("In After Dark · adults only");
    for (const words of [open, invite, sub]) {
      expect(words.line).toMatch(/only the lock/);
      expect(`${words.button} ${words.line}`).not.toMatch(/companion plan|stripe/i);
    }
    expect(Object.values(LOCKED_PICTURE_COPY).join(" ")).not.toMatch(/this is the picture|blurred picture of|preview of/i);
  });

  it("the prompt's line is PG, says where the picture is, never describes it and names no product", async () => {
    for (const line of [lockedPicturePromptLine("Nell Okafor"), lockedPicturePromptLine(null)]) {
      expect(checkFamilyTalk(line).ok).toBe(true);
      expect(line).toMatch(/behind the lock/);
      expect(line).toMatch(/never describe/);
      expect(line).not.toMatch(/after dark/i);
    }
    expect(lockedPicturePromptLine("Nell Okafor")).toContain("with Nell,");
    const base = { character: (await loadCharacter(t.db, H0.id))!, turns: [], facts: [], summary: null, length: "normal" as const, avoid: [], now: NOW };
    const prompt = companionMessages({ ...base, lockedPicture: lockedPicturePromptLine("Nell") })[0].content;
    expect(prompt).toContain(`A picture you mentioned: ${lockedPicturePromptLine("Nell")}`);
    expect(companionMessages(base)[0].content).not.toContain("A picture you mentioned");
    expect(companionMessages({ ...base, lockedPicture: null })[0].content).not.toContain("A picture you mentioned");
  });
});

describe("what the tile is for a person (lib/adult/locked-picture.ts doorKind, pure)", () => {
  const ok: DoorFacts = { on: true, bridgeOn: true, available: true, signedIn: true, attested: true, mode: "open", entitled: "full", locked: false, invite: null, bot: false };
  it("After Dark open to them, with pictures, where pictures are allowed: the couple's night", () => {
    expect(doorKind(ok)).toBe("open");
    // The bridge's switch is about people who aren't in: it never closes the door on someone who is.
    expect(doorKind({ ...ok, bridgeOn: false })).toBe("open");
  });
  it("an adult it isn't open to: the way in", () => {
    expect(doorKind({ ...ok, entitled: "no" })).toBe("way_in");
    expect(doorKind({ ...ok, entitled: "no", invite: "pending" })).toBe("way_in");
    expect(doorKind({ ...ok, entitled: "no", invite: "approved" })).toBe("way_in");
    // A free taste is the scenes only: there is no picture of theirs to open, so they are shown the way to one.
    expect(doorKind({ ...ok, entitled: "taste" })).toBe("way_in");
  });
  it("nothing at all: off, After Dark off, a guest, no 18+ answer, a crawler, a blocked or text-only place, a locked device, a declined request, the bridge off", () => {
    const never: Partial<DoorFacts>[] = [
      { on: false },
      { available: false },
      { signedIn: false },
      { attested: false },
      { bot: true },
      { mode: "blocked" },
      { mode: "text_only" },
      { locked: true },
      { entitled: "no", mode: "blocked" },
      { entitled: "no", mode: "text_only" },
      { entitled: "no", attested: false },
      { entitled: "no", signedIn: false },
      { entitled: "no", invite: "declined" },
      { entitled: "no", bridgeOn: false },
      { entitled: "taste", bridgeOn: false },
    ];
    for (const change of never) expect(doorKind({ ...ok, ...change }), JSON.stringify(change)).toBeNull();
  });
});

/* ---------------------------------------------------- who is sent it ---------------------------------------------------- */

describe("who is sent the text (lib/locked-picture-texts.ts lockedPictureAired)", () => {
  it("an adult After Dark isn't open to, seen where its pictures are allowed: two PG bubbles, the AI notice, the notice to them, and a contentless event", async () => {
    const c = await overnightCouple();
    expect(await lockedPictureAired(t.db, c.ep, { now: NOW })).toEqual({ trigger: "overnight", sent: 1 });
    const all = await texts(c.thread);
    expect(all[0]).toMatchObject({ role: "system" });
    expect(all[0].text).toMatch(/is an AI character, not a real person/);
    const mine = await lockedTexts(c.thread);
    expect(mine.map((m) => m.text)).toEqual(lockedPictureLines("overnight", H0.name, `${c.ep}:${c.mine}`));
    // Ordinary text messages: no picture, no address of one, nothing of After Dark is stored with them.
    for (const m of mine) expect(m).toMatchObject({ via: "text", media_url: null, action: lockedPictureTag(c.ep) });
    const notices = (await t.db.query<{ kind: string; body: string; link: string }>(`select kind, body, link from notifications where user_id = $1`, [c.user])).rows;
    expect(notices).toEqual([{ kind: "character_texted_you", body: mine[0].text, link: `/companion/${c.thread}` }]);
    const sent = events();
    expect(sent).toHaveLength(1);
    expect(Object.keys(sent[0]).sort()).toEqual(["at", "door", "event", "log", "owner", "trigger"]);
    expect(sent[0]).toMatchObject({ trigger: "overnight", door: "way_in", owner: true });
    expect(JSON.stringify(sent[0])).not.toMatch(/Cass|Nell|picture is|owner-1|lp-/);
  });

  it("an adult After Dark is open to, whose character is in their After Dark: sent, and the event says the door opens", async () => {
    const c = await overnightCouple();
    await entitle(c.user, [c.mine]);
    expect((await lockedPictureAired(t.db, c.ep, { now: NOW })).sent).toBe(1);
    expect(events()[0]).toMatchObject({ door: "open" });
  });

  it("After Dark open to them, but their own character isn't in it: nothing (that yes is theirs, and this doesn't ask for it)", async () => {
    const c = await overnightCouple();
    await entitle(c.user, []);
    expect((await lockedPictureAired(t.db, c.ep, { now: NOW })).sent).toBe(0);
  });

  it("never: a blocked place, a text-only place, never seen 18+, seen too long ago, a guest", async () => {
    for (const [user, seen, daysAgo] of [
      ["in-blocked", "blocked", 0],
      ["in-text-only", "text_only", 0],
      ["never-seen", null, 0],
      ["seen-long-ago", "open", LOCKED_PICTURE_RULES.seenWithinDays + 1],
    ] as const) {
      await person(user, seen, daysAgo);
      const mine = await character("Cass Vega", user);
      const ep = await date(mine, H0.id, { overnight: true });
      await optIn(`th-${user}`, user, mine);
      expect(await lockedPictureAired(t.db, ep, { now: NOW }), user).toEqual({ trigger: "overnight", sent: 0 });
      expect(await lockedTexts(`th-${user}`)).toHaveLength(0);
    }
    // A guest: an identity with a thread and no account.
    const mine = await character("Cass Vega", "guest-1");
    const ep = await date(mine, H0.id, { overnight: true });
    await optIn("th-guest", "guest-1", mine);
    expect((await lockedPictureAired(t.db, ep, { now: NOW })).sent).toBe(0);
  });

  it("never: a paused thread, texts off, texts muted as a notification type, a quiet owner", async () => {
    await person("p-paused");
    const a = await character("Ana Vale", "p-paused");
    await optIn("th-paused", "p-paused", a, { paused: true });
    await person("p-off");
    const b = await character("Bo Vale", "p-off");
    await optIn("th-off", "p-off", b, { muted: true });
    await person("p-muted");
    const c = await character("Cy Vale", "p-muted");
    await optIn("th-muted", "p-muted", c);
    await t.db.query(`insert into notification_mutes (user_id, type) values ('p-muted', 'texts')`);
    for (const mine of [a, b, c]) expect((await lockedPictureAired(t.db, await date(mine, H0.id, { overnight: true }), { now: NOW })).sent).toBe(0);
    const q = await overnightCouple("p-quiet");
    expect((await lockedPictureAired(t.db, q.ep, { now: NOW, quiet: ["p-quiet"] })).sent).toBe(0);
    expect((await lockedPictureAired(t.db, q.ep, { now: NOW })).sent).toBe(1);
  });

  it("never: our own accounts, someone the owner declined, a free taste, and (not in After Dark) while the bridge is off", async () => {
    const ours = await overnightCouple("admin-1");
    await claimAdmin(t.db, "admin-1");
    expect((await lockedPictureAired(t.db, ours.ep, { now: NOW })).sent).toBe(0);

    const declined = await overnightCouple("p-declined");
    await t.db.query(`insert into adult_invites (user_id, email, status) values ('p-declined', 'd@example.test', 'declined')`);
    expect((await lockedPictureAired(t.db, declined.ep, { now: NOW })).sent).toBe(0);

    const taste = await overnightCouple("p-taste");
    await entitle("p-taste", [taste.mine], "taste");
    expect((await lockedPictureAired(t.db, taste.ep, { now: NOW })).sent).toBe(0);

    const out = await overnightCouple("p-out");
    const inn = await overnightCouple("p-in");
    await entitle("p-in", [inn.mine]);
    vi.stubEnv("AD_BRIDGE", "0");
    expect((await lockedPictureAired(t.db, out.ep, { now: NOW })).sent).toBe(0);
    expect((await lockedPictureAired(t.db, inn.ep, { now: NOW })).sent).toBe(1);
  });

  it("never about a night that could not open for them: another person's character, or one drawn in anime", async () => {
    await person("p-a");
    await person("p-b");
    const a = await character("Ana Vale", "p-a");
    const b = await character("Bo Vale", "p-b");
    await optIn("th-a", "p-a", a);
    await optIn("th-b", "p-b", b);
    expect((await lockedPictureAired(t.db, await date(a, b, { overnight: true }), { now: NOW })).sent).toBe(0);
    await person("p-anime");
    const drawn = await character("Kiko Vale", "p-anime", { anime: true });
    await optIn("th-anime", "p-anime", drawn);
    expect((await lockedPictureAired(t.db, await date(drawn, H0.id, { overnight: true }), { now: NOW })).sent).toBe(0);
    // Both theirs: it could.
    const a2 = await character("Ada Vale", "p-a");
    expect((await lockedPictureAired(t.db, await date(a, a2, { overnight: true }), { now: NOW })).sent).toBe(1);
  });

  it("someone texting a cast member hears it only for a public date between public characters; an owner hears of their own unlisted one", async () => {
    await person("fan-1");
    await optIn("th-fan", "fan-1", H0.id);
    const unlisted = await date(H0.id, H1.id, { overnight: true, visibility: "unlisted" });
    expect((await lockedPictureAired(t.db, unlisted, { now: NOW })).sent).toBe(0);
    const open = await date(H0.id, H1.id, { overnight: true });
    expect((await lockedPictureAired(t.db, open, { now: NOW })).sent).toBe(1);
    expect((await lockedTexts("th-fan")).map((m) => m.text).join(" ")).toContain(H1.name.split(" ")[0]);
    expect(events()[0]).toMatchObject({ owner: false, door: "way_in" });

    const mine = await overnightCouple("owner-2");
    await t.db.query(`update episodes set visibility = 'unlisted' where id = $1`, [mine.ep]);
    expect((await lockedPictureAired(t.db, mine.ep, { now: NOW })).sent).toBe(1);
  });

  it("once a date, however often it is asked", async () => {
    const c = await overnightCouple();
    expect((await lockedPictureAired(t.db, c.ep, { now: NOW })).sent).toBe(1);
    expect((await lockedPictureAired(t.db, c.ep, { now: NOW })).sent).toBe(0);
    expect((await lockedPictureAired(t.db, c.ep, { now: new Date(NOW.getTime() + 30 * DAY) })).sent).toBe(0);
    expect(await lockedTexts(c.thread)).toHaveLength(2);
  });

  it("at most one a thread a week: a second date inside the week sends nothing, one after it does", async () => {
    const c = await overnightCouple();
    expect((await lockedPictureAired(t.db, c.ep, { now: NOW })).sent).toBe(1);
    const second = await date(c.mine, H0.id, { overnight: true });
    expect((await lockedPictureAired(t.db, second, { now: new Date(NOW.getTime() + 6 * DAY) })).sent).toBe(0);
    // Still seen lately a week on, as someone who reads their texts is.
    await t.db.query(`update accounts set after_dark_seen_at = $2 where user_id = $1`, [c.user, new Date(NOW.getTime() + 8 * DAY).toISOString()]);
    expect((await lockedPictureAired(t.db, second, { now: new Date(NOW.getTime() + 8 * DAY) })).sent).toBe(1);
  });

  it("one text a person a date: someone both sides text hears it from their own character", async () => {
    const c = await overnightCouple();
    await optIn("th-other-side", c.user, H0.id);
    expect((await lockedPictureAired(t.db, c.ep, { now: NOW })).sent).toBe(1);
    expect(await lockedTexts(c.thread)).toHaveLength(2);
    expect(await lockedTexts("th-other-side")).toHaveLength(0);
  });

  it("not an overnight date that ended any other way, a private date, a date someone stepped into, or one that never aired", async () => {
    await person("owner-1");
    const mine = await character("Cass Vega", "owner-1");
    await optIn("th-1", "owner-1", mine);
    for (const o of [{ overnight: true, ending: "friends" }, { overnight: true, ending: "disaster" }, { overnight: true, visibility: "private" }, { overnight: true, stepIn: true }, { overnight: true, aired: false }] as DateOpts[]) {
      expect(await lockedPictureAired(t.db, await date(mine, H0.id, o), { now: NOW }), JSON.stringify(o)).toEqual({ trigger: null, sent: 0 });
    }
    expect(await lockedTexts("th-1")).toHaveLength(0);
  });

  it("a steady couple: only a date that ended in another date, only going steady or more as shown, only on the roll", async () => {
    await person("owner-1");
    const mine = await character("Cass Vega", "owner-1");
    await optIn("th-1", "owner-1", mine);
    // Three second dates in a row: dating, not steady. The roll would say yes; the stage says no.
    for (let i = 0; i < 2; i++) await date(mine, H0.id, { daysAgo: 9 - i });
    const dating = await date(mine, H0.id, { id: rolled(true), daysAgo: 6 });
    await refreshRelationship(t.db, mine, H0.id);
    expect(await lockedPictureAired(t.db, dating, { now: NOW })).toEqual({ trigger: null, sent: 0 });
    // A fourth: going steady. The roll says no for this date: nothing.
    const unlucky = await date(mine, H0.id, { id: rolled(false), daysAgo: 4 });
    await refreshRelationship(t.db, mine, H0.id);
    expect(await lockedPictureAired(t.db, unlucky, { now: NOW })).toEqual({ trigger: null, sent: 0 });
    // A fifth, on the roll: the text, with the steady words.
    await t.db.query(`delete from episodes where id = $1`, [dating]);
    const lucky = await date(mine, H0.id, { id: rolled(true), daysAgo: 2 });
    await refreshRelationship(t.db, mine, H0.id);
    expect(await lockedPictureAired(t.db, lucky, { now: NOW })).toEqual({ trigger: "steady", sent: 1 });
    expect((await lockedTexts("th-1")).map((m) => m.text)).toEqual(lockedPictureLines("steady", H0.name, `${lucky}:${mine}`));
    expect(events()[0]).toMatchObject({ trigger: "steady" });
  });

  it("a steady couple's date that ended badly sends nothing, whatever the roll", async () => {
    await person("owner-1");
    const mine = await character("Cass Vega", "owner-1");
    await optIn("th-1", "owner-1", mine);
    for (let i = 0; i < 4; i++) await date(mine, H0.id, { daysAgo: 9 - i });
    const bad = await date(mine, H0.id, { id: rolled(true), ending: "disaster", daysAgo: 1 });
    await refreshRelationship(t.db, mine, H0.id);
    expect(await lockedPictureAired(t.db, bad, { now: NOW })).toEqual({ trigger: null, sent: 0 });
  });

  it("the airing itself sends it (lib/relationship-events.ts), and changes no ending, stage or points", async () => {
    const c = await overnightCouple();
    const before = (await t.db.query(`select id, ending, points from episodes order by id`).catch(() => t.db.query(`select id, ending from episodes order by id`))).rows;
    await refreshAndAnnounce(t.db, c.mine, H0.id, { episodeId: c.ep });
    expect(await lockedTexts(c.thread)).toHaveLength(2);
    const after = (await t.db.query(`select id, ending, points from episodes order by id`).catch(() => t.db.query(`select id, ending from episodes order by id`))).rows;
    expect(after).toEqual(before);
    // Told once more (a re-airing), nothing new.
    await refreshAndAnnounce(t.db, c.mine, H0.id, { episodeId: c.ep });
    expect(await lockedTexts(c.thread)).toHaveLength(2);
  });

  it("LOCKED_PICTURE_TEXTS=0: nothing is sent, the ones in a thread read as plain texts, and the prompt carries no line", async () => {
    const c = await overnightCouple();
    expect((await lockedPictureAired(t.db, c.ep, { now: NOW })).sent).toBe(1);
    const on = await getThread(t.db, c.user, c.thread);
    if (!on.ok) throw new Error("no thread");
    // The tile's mark rides the LAST bubble of the text, and only that one.
    expect(on.view.messages.filter((m) => m.locked).map((m) => m.text)).toEqual([lockedPictureLines("overnight", H0.name, `${c.ep}:${c.mine}`)[1]]);
    expect(on.view.messages.find((m) => m.locked)?.locked).toEqual({ episode: c.ep });
    // The tag is bookkeeping: it is never shown as something the character did.
    expect(on.view.messages.every((m) => m.action === null)).toBe(true);
    expect(await lockedPictureForPrompt(t.db, c.thread, c.mine, NOW)).toBe(lockedPicturePromptLine(H0.name));

    vi.stubEnv("LOCKED_PICTURE_TEXTS", "0");
    const off = await getThread(t.db, c.user, c.thread);
    if (!off.ok) throw new Error("no thread");
    expect(off.view.messages.some((m) => m.locked)).toBe(false);
    expect(off.view.messages.filter((m) => m.role === "character").map((m) => m.text)).toEqual(lockedPictureLines("overnight", H0.name, `${c.ep}:${c.mine}`));
    expect(await lockedPictureForPrompt(t.db, c.thread, c.mine, NOW)).toBeNull();
    const other = await overnightCouple("owner-9");
    expect(await lockedPictureAired(t.db, other.ep, { now: NOW })).toEqual({ trigger: null, sent: 0 });
    expect(await lockedDoors(t.db, { userId: c.user, authenticated: true }, new Headers(), { get: () => undefined }, true, [{ episodeId: c.ep }])).toEqual({});
    const signedIn = await person(randomUUID());
    const tile = () => getTile(new Request(`${BASE_URL}${lockedTilePath(H0.id)}`, { headers: { cookie: signedInCookie(signedIn) } }), { params: Promise.resolve({ id: H0.id }) });
    expect((await tile()).status).toBe(404);
    vi.stubEnv("LOCKED_PICTURE_TEXTS", "1");
    expect((await tile()).status).toBe(200);
  });

  it("the prompt's line lasts while the text is recent, and is only for the thread that got it", async () => {
    const c = await overnightCouple();
    await lockedPictureAired(t.db, c.ep, { now: NOW });
    expect(await lockedPictureForPrompt(t.db, c.thread, c.mine, new Date(NOW.getTime() + (LOCKED_PICTURE_RULES.promptDays - 1) * DAY))).not.toBeNull();
    expect(await lockedPictureForPrompt(t.db, c.thread, c.mine, new Date(NOW.getTime() + (LOCKED_PICTURE_RULES.promptDays + 1) * DAY))).toBeNull();
    await optIn("th-elsewhere", "someone-else", c.mine);
    expect(await lockedPictureForPrompt(t.db, "th-elsewhere", c.mine, NOW)).toBeNull();
  });

  it("a text the person deleted is not sent again, shows no tile, and leaves the prompt no line", async () => {
    const c = await overnightCouple();
    await lockedPictureAired(t.db, c.ep, { now: NOW });
    const ids = (await t.db.query<{ id: string }>(`select id from companion_messages where thread_id = $1 and action = $2 order by created_at`, [c.thread, lockedPictureTag(c.ep)])).rows.map((r) => r.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(await deleteMessage(t.db, c.user, c.thread, id)).toMatchObject({ ok: true });
    const view = await getThread(t.db, c.user, c.thread);
    if (!view.ok) throw new Error("no thread");
    expect(view.view.messages.some((m) => m.locked)).toBe(false);
    expect(await lockedPictureForPrompt(t.db, c.thread, c.mine, NOW)).toBeNull();
    expect((await lockedPictureAired(t.db, c.ep, { now: NOW })).sent).toBe(0);
  });

  it("the admin's preview writes only to that admin's own threads, and to nobody without an admin account", async () => {
    const [admin, fan] = [randomUUID(), randomUUID()];
    const c = await overnightCouple(admin);
    await claimAdmin(t.db, admin);
    await entitle(admin, [c.mine]);
    await person(fan);
    await optIn("th-fan", fan, H0.id);
    await t.db.query(`update episodes set setup = '{"venue":"rooftop_bar"}'::jsonb where id = $1`, [c.ep]);
    const call = (cookie: string) => adminPreview(new Request(`${BASE_URL}/api/admin/locked-picture?character=${c.mine}`, { method: "POST", headers: { cookie } }));
    expect((await call(signedInCookie(fan))).status).toBe(403);
    expect((await call("")).status).toBe(403);
    const res = await call(signedInCookie(admin));
    expect(res.status).toBe(200);
    // An ordinary date that ended in another, whatever the couple's stage and the roll: for the preview only.
    expect(await res.json()).toMatchObject({ episode_id: c.ep, locked_picture: { trigger: "steady", sent: 1 } });
    expect(await lockedTexts(c.thread)).toHaveLength(2);
    expect(await lockedTexts("th-fan")).toHaveLength(0);
    // The same date, aired for real: no stage, no text.
    await t.db.query(`delete from companion_messages`);
    expect(await lockedPictureAired(t.db, c.ep, { now: NOW })).toEqual({ trigger: null, sent: 0 });
  });
});

/* ------------------------------------------------------ the tile ------------------------------------------------------ */

/** Every statement the database is asked while `run` runs. */
async function statements(run: () => Promise<unknown>): Promise<string[]> {
  const asked: string[] = [];
  const db = t.db as Db & { query: Db["query"] };
  const real = db.query.bind(db);
  const spy = vi.spyOn(db, "query").mockImplementation(((sql: string, params?: unknown[]) => {
    asked.push(sql);
    return real(sql, params);
  }) as never);
  try {
    await run();
  } finally {
    spy.mockRestore();
  }
  return asked;
}

describe("the tile: PG pixels only (app/api/locked-picture/[id], lib/locked-picture-tile.ts)", () => {
  const ask = (id: string, cookie: string, agent = "Mozilla/5.0") => getTile(new Request(`${BASE_URL}${lockedTilePath(id)}`, { headers: { cookie, "user-agent": agent } }), { params: Promise.resolve({ id }) });

  it("a signed-in person gets a small blurred JPEG made from the character's own PG portrait, kept in their browser only", async () => {
    const res = await ask(H0.id, signedInCookie(await person(randomUUID())));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const { default: sharp } = await import("sharp");
    const bytes = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 256, 320]);
    // Blurred beyond detail: neighbouring pixels barely differ anywhere (a real portrait's edges differ by dozens).
    const { data, info } = await sharp(bytes).greyscale().raw().toBuffer({ resolveWithObject: true });
    let sharpest = 0;
    for (let y = 0; y < info.height; y++) for (let x = 1; x < info.width; x++) sharpest = Math.max(sharpest, Math.abs(data[y * info.width + x] - data[y * info.width + x - 1]));
    expect(sharpest).toBeLessThan(24);
    expect(bytes.length).toBeLessThan(12_000);
  });

  it("a character with no portrait gets its avatar's colours, blurred", async () => {
    const owner = await person(randomUUID());
    const mine = await character("Cass Vega", owner);
    const res = await ask(mine, signedInCookie(owner));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(rgbOfHsl("hsl(0 100% 50%)")).toEqual([255, 0, 0]);
    expect(rgbOfHsl("hsl(120 100% 25%)")).toEqual([0, 128, 0]);
    expect(rgbOfHsl("nonsense")).toEqual([90, 60, 100]);
  });

  it("nobody signed out, no guest, no crawler; a private character's only for its owner; nothing for a character that isn't there", async () => {
    const [owner, other] = [await person(randomUUID()), await person(randomUUID())];
    expect((await ask(H0.id, "")).status).toBe(404);
    expect((await ask(H0.id, `bz_uid=${randomUUID()}`)).status).toBe(404);
    expect((await ask(H0.id, signedInCookie(owner))).status).toBe(200);
    expect((await ask(H0.id, signedInCookie(owner), "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).status).toBe(404);
    const hidden = await character("Cass Vega", owner, { visibility: "private" });
    expect((await ask(hidden, signedInCookie(other))).status).toBe(404);
    expect((await ask(hidden, signedInCookie(owner))).status).toBe(200);
    expect((await ask("no-such-character", signedInCookie(owner))).status).toBe(404);
  });

  it("making it reads no After Dark table, even for someone whose After Dark is full of pictures", async () => {
    const c = await overnightCouple(randomUUID());
    await entitle(c.user, [c.mine]);
    const asked = await statements(async () => {
      expect((await ask(c.mine, signedInCookie(c.user))).status).toBe(200);
      expect((await ask(H0.id, signedInCookie(c.user))).status).toBe(200);
    });
    expect(asked.length).toBeGreaterThan(0);
    for (const sql of asked) expect(sql).not.toMatch(/adult_|media_teasers|content_rating\s*=\s*'(nsfw|suggestive)'/);
    // The only pictures it may read are approved portraits rated pg.
    for (const sql of asked.filter((s) => /character_assets/.test(s) && /kind = 'portrait'/.test(s))) expect(sql).toMatch(/content_rating = 'pg'/);
  });

  it("the tile's code imports nothing of After Dark's", () => {
    for (const file of ["lib/locked-picture-tile.ts", "lib/locked-picture.ts", "app/api/locked-picture/[id]/route.ts", "app/companion/[id]/LockedPicture.tsx"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const imports = [...source.matchAll(/from\s+"([^"]+)"|import\("([^"]+)"\)/g)].map((m) => m[1] ?? m[2]);
      expect(imports.filter((i) => /adult/.test(i)), file).toEqual([]);
      expect(source, file).not.toMatch(/adult_images|adult_scenes|adult_nights|adult_media/);
    }
  });

  it("the sender never reads an After Dark table itself: it asks After Dark's own code who may be told", async () => {
    const source = readFileSync(join(process.cwd(), "lib/locked-picture-texts.ts"), "utf8");
    expect(source).not.toMatch(/\badult_[a-z_]+\b/);
    expect([...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).filter((i) => /adult/.test(i))).toEqual([]);
    // And After Dark's side of it reads no After Dark CONTENT: who is entitled and where, never a scene, night or picture.
    const adult = readFileSync(join(process.cwd(), "lib/adult/locked-picture.ts"), "utf8");
    expect(adult).not.toMatch(/adult_(images|scenes|nights|steps|memories|facts|beats|reels|shorts)\b/);
    // The door's switch (public_door, in After Dark's settings) is never read or written here.
    expect(adult).not.toMatch(/rollout|getAdultSettings|saveAdultSettings/);
  });
});

/* ------------------------------------------------------ the taps ------------------------------------------------------ */

describe("where the tap leads (lib/adult/locked-picture.ts lockedDoors)", () => {
  const jar = { get: () => undefined };
  const browser = () => new Headers({ "user-agent": "Mozilla/5.0" });
  const doorsFor = (user: string, ep: string, o: { attested?: boolean; headers?: Headers; signedIn?: boolean; asVisitor?: boolean; remember?: boolean } = {}) =>
    lockedDoors(t.db, { userId: user, authenticated: o.signedIn !== false }, o.headers ?? browser(), jar, o.attested !== false, [{ episodeId: ep }], { asVisitor: o.asVisitor, remember: o.remember });

  it("not in After Dark: the bridge's own way in, carrying where they came from; invite only today", async () => {
    const c = await overnightCouple();
    const doors = await doorsFor(c.user, c.ep);
    expect(doors).toEqual({ [c.ep]: { state: "way_in", href: `/after-dark/subscribe?source=${LOCKED_PICTURE_SOURCE}`, invite_only: true, asked: false } });
    expect(wayInHref({})).toBe("/after-dark/subscribe?source=locked_picture");
    // With After Dark on its own host, the same page there.
    expect(wayInHref({ AFTER_DARK_ORIGIN: "https://ad.example.test" })).toContain("https://ad.example.test");
    expect(decodeURIComponent(wayInHref({ AFTER_DARK_ORIGIN: "https://ad.example.test" }))).toContain("/after-dark/subscribe?source=locked_picture");
    await t.db.query(`insert into adult_invites (user_id, email, status) values ($1, 'a@example.test', 'pending')`, [c.user]);
    expect((await doorsFor(c.user, c.ep))[c.ep]).toMatchObject({ state: "way_in", asked: true });
    await t.db.query(`update adult_invites set status = 'declined' where user_id = $1`, [c.user]);
    expect(await doorsFor(c.user, c.ep)).toEqual({});
  });

  it("in After Dark, an overnight date of theirs: the overnight continuation's own entry", async () => {
    const c = await overnightCouple();
    await entitle(c.user, [c.mine]);
    expect(await doorsFor(c.user, c.ep)).toEqual({ [c.ep]: { state: "open", href: overnightNightPath(c.ep) } });
  });

  it("in After Dark, a steady couple's date: the pair's night; with one of them not in their After Dark, its front page", async () => {
    await person("owner-1");
    const mine = await character("Cass Vega", "owner-1");
    const ep = await date(mine, H0.id);
    await entitle("owner-1", [mine]);
    const [lo, hi] = [mine, H0.id].sort();
    expect(await doorsFor("owner-1", ep)).toEqual({ [ep]: { state: "open", href: `/after-dark/${lo}/${hi}` } });
    await t.db.query(`delete from adult_switches`);
    expect(await doorsFor("owner-1", ep)).toEqual({ [ep]: { state: "open", href: "/after-dark" } });
  });

  it("no tile at all: a blocked place, a text-only place, no 18+ answer, a guest, a crawler", async () => {
    const c = await overnightCouple();
    await entitle(c.user, [c.mine]);
    expect(await doorsFor(c.user, c.ep, { attested: false })).toEqual({});
    expect(await doorsFor(c.user, c.ep, { signedIn: false })).toEqual({});
    expect(await doorsFor(c.user, c.ep, { headers: new Headers({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }) })).toEqual({});
    setPlaceForTests({ country: "US", region: "TX" });
    expect(await doorsFor(c.user, c.ep)).toEqual({});
    setPlaceForTests({ country: "GB", region: null });
    expect(await doorsFor(c.user, c.ep)).toEqual({});
    const out = await overnightCouple("owner-2");
    expect(await doorsFor(out.user, out.ep)).toEqual({});
    setPlaceForTests({ country: "CA", region: "ON" });
    expect(Object.keys(await doorsFor(out.user, out.ep))).toEqual([out.ep]);
  });

  it("an admin can look at the tile as someone After Dark isn't open to; nobody else can ask for that", async () => {
    const c = await overnightCouple("admin-1");
    await claimAdmin(t.db, "admin-1");
    expect((await doorsFor("admin-1", c.ep))[c.ep].state).toBe("open");
    expect((await doorsFor("admin-1", c.ep, { asVisitor: true }))[c.ep]).toMatchObject({ state: "way_in", href: "/after-dark/subscribe?source=locked_picture" });
    const other = await overnightCouple("owner-2");
    await entitle(other.user, [other.mine]);
    expect((await doorsFor(other.user, other.ep, { asVisitor: true }))[other.ep].state).toBe("open");
  });

  it("opening a thread notes, for the texts' job, only what the rules said here: the mode, for a signed-in adult", async () => {
    await person("owner-1", null);
    const seen = async (user: string) => (await t.db.query<{ after_dark_seen_mode: string | null; after_dark_seen_at: string | null }>(`select after_dark_seen_mode, after_dark_seen_at from accounts where user_id = $1`, [user])).rows[0];
    // Without the 18+ answer nothing is noted.
    await lockedDoors(t.db, { userId: "owner-1", authenticated: true }, browser(), jar, false, [], { remember: true });
    expect((await seen("owner-1")).after_dark_seen_mode).toBeNull();
    await lockedDoors(t.db, { userId: "owner-1", authenticated: true }, browser(), jar, true, [], { remember: true });
    expect((await seen("owner-1")).after_dark_seen_mode).toBe("open");
    expect((await seen("owner-1")).after_dark_seen_at).not.toBeNull();
    // Somewhere After Dark is blocked, the note says so, and a text is no longer sent.
    forgetSeenForTests();
    setPlaceForTests({ country: "US", region: "TX" });
    await lockedDoors(t.db, { userId: "owner-1", authenticated: true }, browser(), jar, true, [], { remember: true });
    expect((await seen("owner-1")).after_dark_seen_mode).toBe("blocked");
    // The columns hold a mode and a time: never a country or a state.
    const cols = (await t.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'accounts' and column_name like 'after_dark%'`)).rows.map((r) => r.column_name).sort();
    expect(cols).toEqual(["after_dark_seen_at", "after_dark_seen_mode"]);
    // A guest has no account row: nothing is written anywhere.
    await rememberSeen(t.db, "guest-1", "open");
    expect((await t.db.query(`select 1 from accounts where user_id = 'guest-1'`)).rows).toHaveLength(0);
  });

  it("who may be sent it is asked of After Dark's rules as they stand, never guessed", async () => {
    const c = await overnightCouple();
    const pair: [string, string] = [c.mine, H0.id];
    expect([...(await whoMayBeSent(t.db, [c.user, "nobody"], pair, NOW))]).toEqual([[c.user, "way_in"]]);
    await entitle(c.user, [c.mine]);
    expect([...(await whoMayBeSent(t.db, [c.user], pair, NOW))]).toEqual([[c.user, "open"]]);
    // Last seen by After Dark where pictures aren't allowed: After Dark's own rule for work without a request.
    await t.db.query(`update adult_viewer_places set mode = 'text_only', country = 'GB', region = null where user_id = $1`, [c.user]);
    expect((await whoMayBeSent(t.db, [c.user], pair, NOW)).size).toBe(0);
    // After Dark switched off altogether: nobody.
    vi.stubEnv("ADULT_MODE", "");
    expect((await whoMayBeSent(t.db, [c.user], pair, NOW)).size).toBe(0);
  });
});

describe("the tile in the thread (app/companion/[id]/LockedPicture.tsx)", () => {
  const render = (door: LockedDoor) => renderToStaticMarkup(createElement(LockedPicture, { characterId: "c-1", door }));
  it("entitled: one link to After Dark, the lock's label, and the plain line; the event names carry a state and nothing else", () => {
    const html = render({ state: "open", href: "https://ad.example.test/after-dark/overnight/ep-1" });
    expect(html).toContain('href="https://ad.example.test/after-dark/overnight/ep-1"');
    expect(html).toContain('data-track="ad-locked-picture"');
    expect(html).toContain('data-track-state="open"');
    expect(html).toContain("In After Dark · adults only");
    expect(html).toContain("Open in After Dark");
    expect(html).toContain("This tile is only the lock.");
    expect(html).toContain('src="/api/locked-picture/c-1"');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html.match(/<img /g)).toHaveLength(1);
  });
  it("not entitled: the way in, with what After Dark is, and nothing that says the blur is the picture", () => {
    const html = render({ state: "way_in", href: "/after-dark/subscribe?source=locked_picture", invite_only: true, asked: false });
    expect(html).toContain('href="/after-dark/subscribe?source=locked_picture"');
    expect(html).toContain('data-track-state="way_in"');
    expect(html).toContain("Ask for an invite");
    expect(html).toContain("18+, optional and separate from the show");
    expect(html).toContain("only the lock, not the picture");
    expect(html).not.toMatch(/companion plan/i);
    // The only image is the show's own tile route: never an After Dark address.
    expect([...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1])).toEqual(["/api/locked-picture/c-1"]);
  });
});
