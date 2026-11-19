/**
 * The past-PG door (lib/adult/past-pg.ts, lib/adult/past-pg-viewer.ts, app/create/PastPgDoor.tsx): a character refused
 * for going past PG gets "keep them PG" or After Dark instead of a dead end; a minor or a real person never does.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST as draftRoute } from "@/app/api/characters/draft/route";
import { POST as createCharacter } from "@/app/api/characters/route";
import PastPgDoor from "@/app/create/PastPgDoor";
import { requestInvite } from "@/lib/adult/invites";
import { isPastPg, PAST_PG_COPY, PAST_PG_SOURCE, pastPgDoorOn, pastPgDoorShows, type PastPgFacts } from "@/lib/adult/past-pg";
import { pastPgDoorFor } from "@/lib/adult/past-pg-viewer";
import { claimAdmin } from "@/lib/admins";
import { screenExpressText } from "@/lib/express-create";
import { setModelForTests } from "@/lib/model";
import { setPlaceForTests } from "@/lib/place";
import { checkFields, CHARACTER_REJECTION_MESSAGES } from "@/lib/safety";
import { jsonRequest, newUserCookie, scriptedModel, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

/** Past PG for the show's sheet check: an explicit word ("sexual") and a stock innuendo line ("innuendo"). */
const EXPLICIT = "A lighthouse keeper who writes erotic poetry by the lamp at night.";
const INNUENDO = "A lighthouse keeper who says netflix and chill to every sailor who visits.";

describe("lib/adult/past-pg: the rule, the switch and the copy (pure)", () => {
  const SHOWS: PastPgFacts = { on: true, available: true, inviteOnly: true, attested: true, mode: "open", entitled: false, asked: false, bot: false };

  it("shows only when every condition holds", () => {
    expect(pastPgDoorShows(SHOWS)).toBe(true);
    for (const off of [
      { on: false },
      { available: false },
      { attested: false },
      { mode: "blocked" as const },
      { entitled: true },
      { asked: true },
      { bot: true },
    ]) {
      expect(pastPgDoorShows({ ...SHOWS, ...off }), JSON.stringify(off)).toBe(false);
    }
    // A text-only place is an allowed place.
    expect(pastPgDoorShows({ ...SHOWS, mode: "text_only" })).toBe(true);
    // Once a payment processor is set up the page sells the subscription: having asked for an invite before doesn't matter.
    expect(pastPgDoorShows({ ...SHOWS, inviteOnly: false, asked: true })).toBe(true);
  });

  it("PAST_PG_DOOR=0 turns it off; unset, or anything else, leaves it on", () => {
    expect(pastPgDoorOn({})).toBe(true);
    expect(pastPgDoorOn({ PAST_PG_DOOR: "1" })).toBe(true);
    expect(pastPgDoorOn({ PAST_PG_DOOR: " 0 " })).toBe(false);
  });

  it("opens only for going past PG: never a minor, a real person or a language the check can't read", () => {
    expect(isPastPg("sexual")).toBe(true);
    expect(isPastPg("innuendo")).toBe(true);
    for (const reason of ["minor", "real_person", "unread", "language", "unsafe", null, undefined]) expect(isPastPg(reason), String(reason)).toBe(false);
  });

  it("says it plainly: PG or After Dark, nothing explicit", () => {
    const all = Object.values(PAST_PG_COPY).join(" ");
    expect(checkFields({ all }).ok).toBe(true);
    expect(all).not.toMatch(/sex|nsfw|nude|naked|explicit|uncensor|spic|steam|hot\b|xxx|porn|erotic|kink|lust|bed|strip/i);
    expect(PAST_PG_COPY.adLead).toContain("After Dark");
    expect(PAST_PG_SOURCE).toBe("past_pg");
  });
});

describe("app/create/PastPgDoor: two ways on", () => {
  const render = (door: { href: string; kind: "invite" | "join" }, place: "express" | "save" = "express") =>
    renderToStaticMarkup(createElement(PastPgDoor, { door, place })).replace(/&#x27;/g, "'");

  it("invite only: keep them PG, or ask for an After Dark invite", () => {
    const out = render({ href: "/after-dark/subscribe?source=past_pg", kind: "invite" });
    expect(out).toContain(PAST_PG_COPY.lead);
    expect(out).toMatch(/<button type="button" class="secondary small" data-track="past-pg-keep">Keep them PG<\/button>/);
    expect(out).toContain('<a href="/after-dark/subscribe?source=past_pg" data-track="past-pg-after-dark">ask for an invite</a>');
    expect(out).toContain('data-past-pg-door="express"');
    expect(out).not.toContain(PAST_PG_COPY.join);
  });

  it("with a payment processor: Join After Dark, to the same page", () => {
    const out = render({ href: "/after-dark/subscribe?source=past_pg", kind: "join" }, "save");
    expect(out).toContain('href="/after-dark/subscribe?source=past_pg"');
    expect(out).toContain(PAST_PG_COPY.join);
    expect(out).not.toContain(PAST_PG_COPY.inviteLink);
    expect(out).toContain('data-past-pg-door="save"');
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setPlaceForTests({ country: "CA", region: "ON" });
});
afterEach(() => {
  setPlaceForTests(null);
  setModelForTests(null);
  vi.unstubAllEnvs();
});

const BROWSER = new Headers({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
async function person(email = "ada@example.com") {
  const id = userIdOf(newUserCookie());
  await t.db.query(`insert into email_prefs (user_id, email, status, confirmed_at) values ($1, $2, 'on', now())`, [id, email]);
  return { id, cookie: signedInCookie(id), auth: { userId: id, authenticated: true } };
}

describe("who is offered After Dark (lib/adult/past-pg-viewer.ts)", () => {
  const INVITE = { href: "/after-dark/subscribe?source=past_pg", kind: "invite" };

  it("someone who has said they're 18 or older, where After Dark is allowed, signed in or not", async () => {
    const me = await person();
    expect(await pastPgDoorFor(t.db, me.auth, BROWSER, true)).toEqual(INVITE);
    expect(await pastPgDoorFor(t.db, null, BROWSER, true)).toEqual(INVITE);
    expect(await pastPgDoorFor(t.db, { userId: userIdOf(newUserCookie()), authenticated: false }, BROWSER, true)).toEqual(INVITE);
  });

  it("nobody who hasn't said they're 18 or older, no crawler, and nowhere After Dark is blocked or the place is unknown", async () => {
    const me = await person();
    expect(await pastPgDoorFor(t.db, me.auth, BROWSER, false)).toBeNull();
    expect(await pastPgDoorFor(t.db, me.auth, new Headers({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }), true)).toBeNull();
    for (const where of [{ country: "US", region: "TX" }, { country: "FR", region: null }, { country: null, region: null }]) {
      setPlaceForTests(where);
      expect(await pastPgDoorFor(t.db, me.auth, BROWSER, true), JSON.stringify(where)).toBeNull();
    }
  });

  it("PAST_PG_DOOR=0 turns it off, and so does After Dark being off", async () => {
    const me = await person();
    expect(await pastPgDoorFor(t.db, me.auth, BROWSER, true, { ...process.env, PAST_PG_DOOR: "0" })).toBeNull();
    expect(await pastPgDoorFor(t.db, me.auth, BROWSER, true, { ...process.env, ADULT_MODE: "" })).toBeNull();
  });

  it("not someone already in, nor while it's invite only someone who already asked; with a processor it sells to them", async () => {
    const admin = await person("boss@example.com");
    await claimAdmin(t.db, admin.id);
    expect(await pastPgDoorFor(t.db, admin.auth, BROWSER, true)).toBeNull();
    const member = await person("bo@example.com");
    await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [member.id]);
    expect(await pastPgDoorFor(t.db, member.auth, BROWSER, true)).toBeNull();
    const asked = await person("cy@example.com");
    await requestInvite(t.db, asked.id, { email: "cy@example.com", note: null, country: "CA", source: PAST_PG_SOURCE });
    expect(await pastPgDoorFor(t.db, asked.auth, BROWSER, true)).toBeNull();
    const ccbill = { CCBILL_ACCOUNT: "900000", CCBILL_SUBACCOUNT: "0001", CCBILL_FLEX_ID: "flex-1", CCBILL_SALT: "salt", CCBILL_WEBHOOK_KEY: "k".repeat(32) };
    expect(await pastPgDoorFor(t.db, asked.auth, BROWSER, true, { ...process.env, ...ccbill })).toEqual({ href: "/after-dark/subscribe?source=past_pg", kind: "join" });
  });
});

describe("the refusals say when they were for going past PG", () => {
  it("the one box's screen marks past PG, and only past PG", () => {
    expect(screenExpressText(EXPLICIT, "")).toMatchObject({ ok: false, reason: "unsafe", pastPg: true });
    expect(screenExpressText(INNUENDO, "")).toMatchObject({ ok: false, reason: "unsafe", pastPg: true });
    expect(screenExpressText("a shy 15 year old who loves cats", "")).not.toHaveProperty("pastPg");
    expect(screenExpressText("A singer who loves cats", "Taylor Swift")).not.toHaveProperty("pastPg");
    expect(screenExpressText("A lighthouse keeper who repairs old radios.", "")).toEqual({ ok: true });
  });

  it("POST /api/characters/draft carries past_pg on a past-PG refusal, before any model reads the words", async () => {
    const { calls } = scriptedModel([]);
    const send = (body: Record<string, unknown>) => draftRoute(jsonRequest("/api/characters/draft", body, { cookie: newUserCookie() }));
    const spicy = await send({ text: EXPLICIT });
    expect(spicy.status).toBe(422);
    expect(await spicy.json()).toMatchObject({ reason: "unsafe", past_pg: true });
    const minor = await send({ text: "a shy 15 year old who loves cats" });
    expect(minor.status).toBe(422);
    expect(await minor.json()).not.toHaveProperty("past_pg");
    const person = await send({ text: "A singer who loves cats", name: "Taylor Swift" });
    expect(await person.json()).not.toHaveProperty("past_pg");
    expect(calls).toHaveLength(0);
  });

  it("the save's refusal names a reason the builder reads as past PG", async () => {
    const res = await createCharacter(jsonRequest("/api/characters", validCharacter({ name: "Lamp Keeper", bio: EXPLICIT }), { cookie: newUserCookie() }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({ error: "content_rejected" });
    expect(isPastPg(body.reason)).toBe(true);
    expect(body.message).toBe(CHARACTER_REJECTION_MESSAGES[body.reason as "sexual" | "innuendo"]);
  });
});
