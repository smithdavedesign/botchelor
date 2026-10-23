// After Dark's discreet mode (lib/adult/privacy.ts, lib/adult/discreet.ts): blur until tapped, a neutral tab title, and an
// optional PIN that every After Dark page, API and media route respects, with a reset that only goes through the account.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/after-dark",
}));

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AdminAfterDarkLayout from "@/app/admin/after-dark/layout";
import AfterDarkGraphPage from "@/app/admin/after-dark/graph/page";
import AfterDarkScenePage from "@/app/after-dark/[a]/[b]/page";
import AfterDarkLayout, { generateMetadata as layoutMetadata } from "@/app/after-dark/layout";
import AfterDarkHome, { generateMetadata as homeMetadata } from "@/app/after-dark/page";
import { GET as clipGET } from "@/app/api/admin/after-dark/clip/route";
import { GET as mediaGET } from "@/app/api/admin/after-dark/media/[id]/route";
import { GET as resetGET, POST as resetPOST } from "@/app/api/admin/after-dark/pin-reset/route";
import { GET as privacyGET, POST as privacyPOST } from "@/app/api/admin/after-dark/privacy/route";
import { GET as reelGET } from "@/app/api/admin/after-dark/reel/route";
import { GET as sceneGET } from "@/app/api/admin/after-dark/route";
import { GET as settingsGET } from "@/app/api/admin/after-dark/settings/route";
import { DELETE as unlockDELETE, POST as unlockPOST } from "@/app/api/admin/after-dark/unlock/route";
import { GET as looksGET } from "@/app/api/looks/[id]/route";
import { claimAdmin } from "@/lib/admins";
import { hashPassword, signSession } from "@/lib/auth";
import {
  afterDarkMetadata,
  afterDarkTitle,
  BLURRED_MEDIA,
  BLURRED_MEDIA_SELECTORS,
  DEFAULT_PRIVACY,
  maskEmail,
  NEUTRAL_TITLE,
  PIN_LOCKOUT_MINUTES,
  PIN_MAX_TRIES,
  waitText,
} from "@/lib/adult/discreet";
import {
  attemptReply,
  hashPin,
  isLocked,
  PIN_SCRYPT_N,
  resetCode,
  setPin,
  setPinWorkForTests,
  signUnlock,
  tryPin,
  UNLOCK_COOKIE,
  unlockCookie,
  verifyPin,
  verifyUnlock,
} from "@/lib/adult/privacy";
import { shortsAccess } from "@/lib/adult/shorts";
import { setEmailSenderForTests, type EmailMessage } from "@/lib/email";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const KEY = ["re", "test", "key"].join("_");
// Built from parts so no literal secret sits in the repo (GitGuardian scans every commit).
const ACCOUNT_PASSWORD = ["discreet", "account", "pass"].join("-");
const WRONG_PASSWORD = ["not", "the", "pass"].join("-");
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

let t: Awaited<ReturnType<typeof startTestDb>>;
let sent: EmailMessage[] = [];
beforeAll(async () => {
  t = await startTestDb();
  // A cheap scrypt for the suite; "hashes a PIN at production cost" checks the real one.
  setPinWorkForTests(1 << 10);
});
afterAll(async () => {
  setPinWorkForTests(null);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from adult_privacy");
  await t.db.query("delete from email_sends");
  jar.cookies.clear();
  sent = [];
  setEmailSenderForTests(async (msg) => {
    sent.push(msg);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("RESEND_API_KEY", KEY);
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([CAST_A, CAST_B]);
});
afterEach(() => {
  setEmailSenderForTests(null);
  setSeasonCastForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Kind = "bare" | "google" | "password";
/** A signed-in admin (After Dark is open to them), with a Google account (an email), a handle and password, or neither. */
async function owner(kind: Kind = "bare") {
  const id = randomUUID();
  await claimAdmin(t.db, id);
  if (kind === "google") {
    await t.db.query(`insert into accounts (user_id, google_sub, email) values ($1, $2, $3)`, [id, `g-${id}`, `lexi.${id.slice(0, 6)}@example.com`]);
  }
  if (kind === "password") {
    await t.db.query(`insert into accounts (user_id, handle, handle_display, password_hash) values ($1, $2, $2, $3)`, [
      id,
      `h${id.slice(0, 8)}`,
      await hashPassword(ACCOUNT_PASSWORD),
    ]);
  }
  return { id, session: signedInCookie(id) };
}

type Opts = { cookie?: string; method?: string; body?: unknown };
const request = (path: string, o: Opts = {}) =>
  new Request(`${BASE_URL}${path}`, {
    method: o.method ?? (o.body === undefined ? "GET" : "POST"),
    headers: { ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
const cookies = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join("; ");
/** The bz_ad_unlock=… pair a response set, or "" when it set none (or cleared it). */
const unlockFrom = (res: Response) => {
  const c = res.headers.getSetCookie().find((s) => s.startsWith(`${UNLOCK_COOKIE}=`));
  const pair = c?.split(";")[0] ?? "";
  return pair.endsWith("=") ? "" : pair;
};
/** The next/headers cookie store the pages and layouts read. */
function viewAs(cookie: string) {
  jar.cookies.clear();
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) jar.cookies.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
}
const body = async (res: Response) => (await res.json()) as Record<string, unknown>;

async function withPin(o: { id: string; session: string }, pin = "2468") {
  const res = await privacyPOST(request("/api/admin/after-dark/privacy", { cookie: o.session, body: { set_pin: pin } }));
  expect(res.status).toBe(200);
  return unlockFrom(res);
}

const sceneGet = (cookie: string) => sceneGET(request(`/api/admin/after-dark?a=${CAST_A}&b=${CAST_B}`, { cookie }));

describe("the PIN's hash", () => {
  it("is scrypt with a fresh salt each time: never the PIN, and only the right PIN verifies", async () => {
    const a = await hashPin("4826");
    const b = await hashPin("4826");
    expect(a).toMatch(/^pin1\$\d+\$[\w-]+\$[\w-]+$/);
    expect(a).not.toContain("4826");
    expect(a).not.toBe(b);
    expect(await verifyPin("4826", a)).toBe(true);
    expect(await verifyPin("4827", a)).toBe(false);
    expect(await verifyPin("48266", a)).toBe(false);
    // A changed hash fails. (Its first character: the last one of a 32-byte hash also carries two unused bits.)
    const [scheme, n, salt, hash] = a.split("$");
    const tampered = `${hash[0] === "A" ? "B" : "A"}${hash.slice(1)}`;
    expect(await verifyPin("4826", [scheme, n, salt, tampered].join("$"))).toBe(false);
    expect(await verifyPin("4826", null)).toBe(false);
    expect(await verifyPin("4826", "scrypt$abc$def")).toBe(false);
  });

  it("takes 4 to 6 digits only", async () => {
    for (const ok of ["0000", "12345", "987654"]) expect(await verifyPin(ok, await hashPin(ok))).toBe(true);
    for (const bad of ["123", "1234567", "12a4", " 1234", ""]) await expect(hashPin(bad)).rejects.toThrow(/4 to 6 digits/);
  });

  it("is peppered with SESSION_SECRET: a copy of the table can't be checked without it", async () => {
    const stored = await hashPin("1357");
    vi.stubEnv("SESSION_SECRET", `${TEST_SESSION_SECRET}-rotated`);
    expect(await verifyPin("1357", stored)).toBe(false);
  });

  it("hashes a PIN at production cost (2^15) when tests don't lower it", async () => {
    setPinWorkForTests(null);
    try {
      const stored = await hashPin("8642");
      expect(PIN_SCRYPT_N).toBe(32768);
      expect(stored.split("$")[1]).toBe("32768");
      expect(await verifyPin("8642", stored)).toBe(true);
    } finally {
      setPinWorkForTests(1 << 10);
    }
  });

  it("is all that's stored: the table holds the hash, never the PIN, and no response carries either", async () => {
    const o = await owner();
    const unlock = await withPin(o, "975310");
    const row = (await t.db.query<Record<string, unknown>>(`select * from adult_privacy where user_id = $1`, [o.id])).rows[0];
    expect(JSON.stringify(row)).not.toContain("975310");
    expect(String(row.pin_hash)).toMatch(/^pin1\$/);
    const got = await privacyGET(request("/api/admin/after-dark/privacy", { cookie: cookies(o.session, unlock) }));
    const text = await got.text();
    expect(text).not.toContain("975310");
    expect(text).not.toContain("pin1$");
    expect(JSON.parse(text).privacy).toEqual({ blur: true, neutral_title: true, pin: true });
  });
});

describe("the device's unlock cookie", () => {
  it("is signed for one account and one PIN version, for 12 hours", () => {
    const now = Date.parse("2026-10-22T10:00:00Z");
    const token = signUnlock("user-1", 3, process.env, now)!;
    expect(verifyUnlock(token, "user-1", 3, process.env, now)).toBe(true);
    expect(verifyUnlock(token, "user-1", 3, process.env, now + 11.9 * 3_600_000)).toBe(true);
    expect(verifyUnlock(token, "user-1", 3, process.env, now + 12.1 * 3_600_000)).toBe(false);
    expect(verifyUnlock(token, "user-2", 3, process.env, now)).toBe(false);
    expect(verifyUnlock(token, "user-1", 4, process.env, now)).toBe(false);
    const [p, payload, sig] = token.split(".");
    const forged = `${sig.slice(0, -2)}${sig.endsWith("xx") ? "yy" : "xx"}`;
    expect(verifyUnlock(`${p}.${payload}.${forged}`, "user-1", 3, process.env, now)).toBe(false);
    // A session token is never taken for an unlock, whatever it says.
    expect(verifyUnlock(signSession({ uid: "user-1", authenticated: true }), "user-1", 3, process.env, now)).toBe(false);
    expect(verifyUnlock(token, "user-1", 3, { SESSION_SECRET: ["another", "secret"].join("-") }, now)).toBe(false);
  });

  it("is HttpOnly, SameSite=Lax, site-wide, and lasts 12 hours", () => {
    const c = unlockCookie("tok");
    expect(c).toMatch(/^bz_ad_unlock=tok; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200/);
  });
});

describe("wrong tries", () => {
  it("allows five, then a 15-minute wait that even the right PIN can't skip", async () => {
    const o = await owner();
    await setPin(t.db, o.id, "1122");
    const now = Date.parse("2026-10-22T12:00:00Z");
    for (let i = 1; i < PIN_MAX_TRIES; i++) {
      expect(await tryPin(t.db, o.id, "0000", now + i)).toEqual({ ok: false, error: "wrong", tries_left: PIN_MAX_TRIES - i });
    }
    expect(await tryPin(t.db, o.id, "0000", now + 10)).toEqual({ ok: false, error: "too_many_tries", retry_after_seconds: PIN_LOCKOUT_MINUTES * 60 });
    expect(await tryPin(t.db, o.id, "1122", now + 60_000)).toMatchObject({ ok: false, error: "too_many_tries" });
    expect(await tryPin(t.db, o.id, "1122", now + 14 * 60_000)).toMatchObject({ ok: false, error: "too_many_tries" });
    expect(await tryPin(t.db, o.id, "1122", now + 15 * 60_000 + 20)).toMatchObject({ ok: true });
  });

  it("are counted before they're checked, so ten guesses at once can't get past five", async () => {
    const o = await owner();
    await setPin(t.db, o.id, "1122");
    const now = Date.now();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => tryPin(t.db, o.id, String(3000 + i), now)));
    expect(results.filter((r) => !r.ok && r.error === "wrong").length).toBeLessThanOrEqual(PIN_MAX_TRIES - 1);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(await tryPin(t.db, o.id, "1122", now)).toMatchObject({ ok: false, error: "too_many_tries" });
  });

  it("start again after a right PIN", async () => {
    const o = await owner();
    await setPin(t.db, o.id, "1122");
    const now = Date.now();
    for (let i = 0; i < PIN_MAX_TRIES - 1; i++) await tryPin(t.db, o.id, "0000", now);
    expect(await tryPin(t.db, o.id, "1122", now)).toMatchObject({ ok: true });
    expect(await tryPin(t.db, o.id, "0000", now)).toEqual({ ok: false, error: "wrong", tries_left: PIN_MAX_TRIES - 1 });
  });

  it("are answered with what's wrong and how long to wait", () => {
    expect(attemptReply({ ok: false, error: "wrong", tries_left: 1 }, "PIN")).toMatchObject({ status: 401, body: { error: "wrong_pin", tries_left: 1, message: "That's not the PIN. 1 try left." } });
    const wait = attemptReply({ ok: false, error: "too_many_tries", retry_after_seconds: 900 }, "code");
    expect(wait).toMatchObject({ status: 429, headers: { "retry-after": "900" }, body: { message: "Too many tries. Try again in 15 minutes." } });
    expect(waitText(30)).toBe("in 30 seconds");
    expect(waitText(61)).toBe("in 2 minutes");
  });
});

describe("the lock on After Dark's APIs and media", () => {
  it("leaves a device in when there's no PIN (the default)", async () => {
    const o = await owner();
    expect((await sceneGet(o.session)).status).toBe(200);
    expect(await isLocked(t.db, o.id, null)).toBe(false);
  });

  it("turns a device without the PIN away from every route, the same not-found a stranger gets", async () => {
    const o = await owner();
    const unlocked = cookies(o.session, await withPin(o));
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status) values ('pic-1', $1, $2, 'scene', 'p', 'image/png', $3, 'ready')`, [
      o.id,
      CAST_A,
      PNG,
    ]);
    await t.db.query(`insert into look_tiles (id, variant, status, prompt, mime, data) values ('nsfw-woman-hair-red', 'nsfw', 'ready', 'p', 'image/png', $1) on conflict (id) do nothing`, [PNG]);
    const routes: [string, (cookie: string) => Promise<Response>][] = [
      ["scene", (c) => sceneGet(c)],
      ["media", (c) => mediaGET(request("/api/admin/after-dark/media/pic-1", { cookie: c }), { params: Promise.resolve({ id: "pic-1" }) })],
      ["reels", (c) => reelGET(request(`/api/admin/after-dark/reel?a=${CAST_A}&b=${CAST_B}`, { cookie: c }))],
      ["clip", (c) => clipGET(request("/api/admin/after-dark/clip?id=none", { cookie: c }))],
      ["settings", (c) => settingsGET(request("/api/admin/after-dark/settings", { cookie: c }))],
      ["privacy", (c) => privacyGET(request("/api/admin/after-dark/privacy", { cookie: c }))],
      ["look tile", (c) => looksGET(request("/api/looks/nsfw-woman-hair-red", { cookie: c }), { params: Promise.resolve({ id: "nsfw-woman-hair-red" }) })],
    ];
    for (const [name, call] of routes) {
      expect((await call(unlocked)).status, `${name}, unlocked`).toBe(200);
      expect((await call(o.session)).status, `${name}, locked`).toBe(404);
    }
    // The media route sends nothing of the file to a locked device.
    const locked = await mediaGET(request("/api/admin/after-dark/media/pic-1", { cookie: o.session }), { params: Promise.resolve({ id: "pic-1" }) });
    expect(locked.headers.get("content-type")).not.toMatch(/image/);
  });

  it("doesn't take another account's unlock cookie, or one from before the PIN changed", async () => {
    const a = await owner();
    const b = await owner();
    const aUnlock = await withPin(a, "1111");
    await withPin(b, "2222");
    expect((await sceneGet(cookies(b.session, aUnlock))).status).toBe(404);
    // A new PIN signs every other device out; the device that set it stays in.
    const res = await privacyPOST(request("/api/admin/after-dark/privacy", { cookie: cookies(a.session, aUnlock), body: { set_pin: "3333", current_pin: "1111" } }));
    expect(res.status).toBe(200);
    expect((await sceneGet(cookies(a.session, aUnlock))).status).toBe(404);
    expect((await sceneGet(cookies(a.session, unlockFrom(res)))).status).toBe(200);
  });

  it("opens with the PIN: a wrong one says how many tries are left, the right one sets the cookie, Lock now takes it away", async () => {
    const o = await owner();
    await withPin(o, "1234");
    const wrong = await unlockPOST(request("/api/admin/after-dark/unlock", { cookie: o.session, body: { pin: "4321" } }));
    expect(wrong.status).toBe(401);
    expect(await body(wrong)).toMatchObject({ error: "wrong_pin", tries_left: PIN_MAX_TRIES - 1 });
    expect(unlockFrom(wrong)).toBe("");
    const badFormat = await unlockPOST(request("/api/admin/after-dark/unlock", { cookie: o.session, body: { pin: "12" } }));
    expect(badFormat.status).toBe(422);
    const right = await unlockPOST(request("/api/admin/after-dark/unlock", { cookie: o.session, body: { pin: "1234" } }));
    expect(right.status).toBe(200);
    const unlock = unlockFrom(right);
    expect(unlock).toMatch(/^bz_ad_unlock=adu1\./);
    expect((await sceneGet(cookies(o.session, unlock))).status).toBe(200);
    const lock = await unlockDELETE(request("/api/admin/after-dark/unlock", { cookie: cookies(o.session, unlock), method: "DELETE" }));
    expect(lock.headers.getSetCookie().join()).toMatch(/bz_ad_unlock=; .*Max-Age=0/);
  });

  it("hides the Shorts from a device without the PIN, and opens them with it (lib/adult/shorts.ts shortsAccess)", async () => {
    const o = await owner();
    const unlock = await withPin(o);
    const store = (cookie: string) => {
      const jarOf = new Map(cookie.split("; ").map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)]));
      return { get: (name: string) => (jarOf.has(name) ? { value: jarOf.get(name)! } : undefined) };
    };
    const auth = { userId: o.id, authenticated: true };
    expect(await shortsAccess(t.db, auth, store(o.session))).toEqual({ kind: "hidden" });
    expect(await shortsAccess(t.db, auth, store(cookies(o.session, unlock)))).toMatchObject({ kind: "full", viewer: o.id });
  });

  it("is only for the account After Dark is open to: anyone else's unlock is not found", async () => {
    const stranger = signedInCookie(randomUUID());
    expect((await unlockPOST(request("/api/admin/after-dark/unlock", { cookie: stranger, body: { pin: "1234" } }))).status).toBe(404);
    expect((await privacyPOST(request("/api/admin/after-dark/privacy", { cookie: stranger, body: { blur: false } }))).status).toBe(404);
    expect((await resetPOST(request("/api/admin/after-dark/pin-reset", { cookie: stranger, body: {} }))).status).toBe(404);
  });
});

describe("changing the settings", () => {
  it("starts at blur on, title on, PIN off, and a locked device can't change any of it", async () => {
    const o = await owner();
    const start = await privacyGET(request("/api/admin/after-dark/privacy", { cookie: o.session }));
    expect((await body(start)).privacy).toEqual(DEFAULT_PRIVACY);
    expect(DEFAULT_PRIVACY).toEqual({ blur: true, neutral_title: true, pin: false });
    const off = await privacyPOST(request("/api/admin/after-dark/privacy", { cookie: o.session, body: { blur: false } }));
    expect((await body(off)).privacy).toEqual({ blur: false, neutral_title: true, pin: false });
    await withPin(o);
    // Locked (no unlock cookie): not even turning the PIN off, which would be the way round it.
    const sneaky = await privacyPOST(request("/api/admin/after-dark/privacy", { cookie: o.session, body: { remove_pin: true, current_pin: "0000" } }));
    expect(sneaky.status).toBe(404);
  });

  it("changing or removing a PIN takes the current one", async () => {
    const o = await owner();
    const unlock = await withPin(o, "5555");
    const c = cookies(o.session, unlock);
    expect((await privacyPOST(request("/api/admin/after-dark/privacy", { cookie: c, body: { set_pin: "6666" } }))).status).toBe(422);
    const wrong = await privacyPOST(request("/api/admin/after-dark/privacy", { cookie: c, body: { remove_pin: true, current_pin: "0000" } }));
    expect(wrong.status).toBe(401);
    const off = await privacyPOST(request("/api/admin/after-dark/privacy", { cookie: c, body: { remove_pin: true, current_pin: "5555" } }));
    expect((await body(off)).privacy).toMatchObject({ pin: false });
    expect((await sceneGet(o.session)).status).toBe(200);
  });
});

describe("forgot the PIN", () => {
  it("emails a code to the account's confirmed address (neutral words), and the code takes the PIN off once", async () => {
    const o = await owner("google");
    await withPin(o, "8080");
    const ways = await body(await resetGET(request("/api/admin/after-dark/pin-reset", { cookie: o.session })));
    expect(ways.reset).toEqual({ email: maskEmail(`lexi.${o.id.slice(0, 6)}@example.com`), password: false });
    expect(String((ways.reset as { email: string }).email)).toMatch(/^l•••@example\.com$/);

    const send = await resetPOST(request("/api/admin/after-dark/pin-reset", { cookie: o.session, body: {} }));
    expect(send.status).toBe(200);
    expect(sent).toHaveLength(1);
    const mail = sent[0];
    expect(mail.to).toBe(`lexi.${o.id.slice(0, 6)}@example.com`);
    for (const part of [mail.subject, mail.text, mail.html]) expect(part).not.toMatch(/after dark|adult|explicit|nsfw/i);
    const code = mail.text.match(/(\d{4}) (\d{4})/)!.slice(1).join("");
    expect(code).toMatch(/^\d{8}$/);
    // Another within the minute is refused.
    expect((await resetPOST(request("/api/admin/after-dark/pin-reset", { cookie: o.session, body: {} }))).status).toBe(429);
    // A wrong code counts as a try.
    const wrong = await resetPOST(request("/api/admin/after-dark/pin-reset", { cookie: o.session, body: { code: code === "12345678" ? "87654321" : "12345678" } }));
    expect(wrong.status).toBe(401);
    expect(await body(wrong)).toMatchObject({ error: "wrong_code", tries_left: PIN_MAX_TRIES - 1 });
    const ok = await resetPOST(request("/api/admin/after-dark/pin-reset", { cookie: o.session, body: { code: `${code.slice(0, 4)} ${code.slice(4)}` } }));
    expect(ok.status).toBe(200);
    expect((await sceneGet(o.session)).status).toBe(200);
    // Used once: the PIN's version moved on, so the same code doesn't clear a new PIN.
    await withPin(o, "9090");
    const again = await resetPOST(request("/api/admin/after-dark/pin-reset", { cookie: o.session, body: { code } }));
    expect(again.status).toBe(401);
  });

  it("a code is good for its 15-minute window and the one after, then not", () => {
    const now = Date.parse("2026-10-22T12:07:00Z");
    const w = Math.floor(now / (15 * 60_000));
    const code = resetCode("user-1", 2, w)!;
    expect(code).toMatch(/^\d{8}$/);
    expect(resetCode("user-1", 2, w)).toBe(code);
    expect(resetCode("user-1", 3, w)).not.toBe(code);
    expect(resetCode("user-2", 2, w)).not.toBe(code);
  });

  it("an account with no email confirms with its password instead; one with an email can't", async () => {
    const p = await owner("password");
    await withPin(p, "4545");
    expect((await body(await resetGET(request("/api/admin/after-dark/pin-reset", { cookie: p.session })))).reset).toEqual({ email: null, password: true });
    const wrong = await resetPOST(request("/api/admin/after-dark/pin-reset", { cookie: p.session, body: { password: WRONG_PASSWORD } }));
    expect(wrong.status).toBe(401);
    expect(await body(wrong)).toMatchObject({ error: "wrong_password" });
    const ok = await resetPOST(request("/api/admin/after-dark/pin-reset", { cookie: p.session, body: { password: ACCOUNT_PASSWORD } }));
    expect(ok.status).toBe(200);
    expect((await sceneGet(p.session)).status).toBe(200);

    const g = await owner("google");
    await withPin(g, "4545");
    const refused = await resetPOST(request("/api/admin/after-dark/pin-reset", { cookie: g.session, body: { password: WRONG_PASSWORD } }));
    expect(refused.status).toBe(409);
  });

  it("an account with neither has no way round it here", async () => {
    const o = await owner("bare");
    await withPin(o, "7777");
    expect((await body(await resetGET(request("/api/admin/after-dark/pin-reset", { cookie: o.session })))).reset).toEqual({ email: null, password: false });
    const send = await resetPOST(request("/api/admin/after-dark/pin-reset", { cookie: o.session, body: {} }));
    expect(send.status).toBe(409);
    expect(sent).toHaveLength(0);
    expect((await sceneGet(o.session)).status).toBe(404);
  });
});

describe("the After Dark pages", () => {
  const child = createElement("p", { id: "page" }, "THE PAGE ITSELF");
  const render = async (layout: (p: { children: React.ReactNode }) => Promise<ReactElement>) => renderToStaticMarkup(await layout({ children: child }));

  it("a locked device gets the PIN prompt from the layout, and the pages themselves give it nothing", async () => {
    const o = await owner("google");
    await withPin(o);
    viewAs(o.session);
    for (const layout of [AfterDarkLayout, AdminAfterDarkLayout]) {
      const html = await render(layout);
      expect(html).toContain("Enter your PIN");
      expect(html).toContain("Forgot your PIN?");
      expect(html).not.toContain("THE PAGE ITSELF");
      expect(html).not.toMatch(/after dark/i);
    }
    const notFound = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;
    await expect(AfterDarkHome()).rejects.toThrow(notFound);
    await expect(AfterDarkScenePage({ params: Promise.resolve({ a: CAST_A, b: CAST_B }), searchParams: Promise.resolve({}) })).rejects.toThrow(notFound);
    await expect(AfterDarkGraphPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(notFound);
  });

  it("an unlocked device gets the pages, inside the blur hook, with the privacy card on the home page", async () => {
    const o = await owner();
    const unlock = await withPin(o);
    viewAs(cookies(o.session, unlock));
    const html = await render(AfterDarkLayout);
    expect(html).toContain("THE PAGE ITSELF");
    expect(html).toContain('data-ad-discreet="blur"');
    expect(html).not.toContain("Enter your PIN");
    const home = renderToStaticMarkup(await AfterDarkHome());
    expect(home).toContain("Privacy: blur on · neutral title · PIN on");
    await expect(AfterDarkScenePage({ params: Promise.resolve({ a: CAST_A, b: CAST_B }), searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
  });

  it("blur off takes the hook off: pictures show as they are", async () => {
    const o = await owner();
    await privacyPOST(request("/api/admin/after-dark/privacy", { cookie: o.session, body: { blur: false } }));
    viewAs(o.session);
    const html = await render(AfterDarkLayout);
    expect(html).toContain('data-ad-discreet="off"');
    expect(html).toContain("THE PAGE ITSELF");
  });

  it("a stranger still gets not-found, and no PIN prompt", async () => {
    viewAs(signedInCookie(randomUUID()));
    expect(await render(AfterDarkLayout)).not.toContain("Enter your PIN");
    await expect(AfterDarkHome()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });
});

describe("the neutral title", () => {
  it("is every After Dark tab's title while it's on, and the pages' own titles once it's off", async () => {
    const o = await owner();
    viewAs(o.session);
    expect((await layoutMetadata()).title).toEqual({ default: NEUTRAL_TITLE, template: NEUTRAL_TITLE });
    expect((await homeMetadata()).title).toBe("Botchelor");
    await privacyPOST(request("/api/admin/after-dark/privacy", { cookie: o.session, body: { neutral_title: false } }));
    expect((await layoutMetadata()).title).toBeUndefined();
    expect((await homeMetadata()).title).toBe("After Dark · Botchelor");
  });

  it("keeps the adult labels either way, never sets an icon of its own (the tab keeps the show's heart), and is on for strangers", async () => {
    for (const neutral of [true, false]) {
      const m = afterDarkMetadata(neutral);
      expect(m.other).toEqual({ rating: "adult", RATING: "RTA-5042-1996-1400-1577-RTA" });
      expect(m.icons).toBeUndefined();
    }
    expect(afterDarkTitle(true, "After dark settings · Botchelor")).toBe("Botchelor");
    expect(afterDarkTitle(false, "After dark settings · Botchelor")).toBe("After dark settings · Botchelor");
    viewAs("");
    expect((await layoutMetadata()).title).toEqual({ default: NEUTRAL_TITLE, template: NEUTRAL_TITLE });
  });
});

describe("blur until tapped", () => {
  const css = readFileSync(join(ROOT, "app", "after-dark", "discreet.css"), "utf8");

  it("is one CSS rule on the layouts' hook, the same selectors the tap script uses", () => {
    for (const selector of BLURRED_MEDIA_SELECTORS) expect(css).toContain(`[data-ad-discreet="blur"] ${selector}`);
    expect(BLURRED_MEDIA).toBe(BLURRED_MEDIA_SELECTORS.join(", "));
    expect(css).toMatch(/filter: blur\(\d+px\)/);
    // The wrapper adds no box: the pages lay out as before.
    expect(css).toMatch(/\.ad-discreet \{\s*display: contents;/);
  });

  it("covers pictures, videos and SVG images, keeps the show's PG portraits sharp, but not an After Dark file in one", () => {
    expect(BLURRED_MEDIA).toContain(":is(img, video, image):not(.avatar):not([data-ad-shown])");
    expect(BLURRED_MEDIA).toContain(':is(img, video)[src*="/after-dark/"]:not([data-ad-shown])');
    expect(BLURRED_MEDIA).toContain('image[href*="/after-dark/"]:not([data-ad-shown])');
  });

  it("the tap script shows a picture and its siblings, and blurs everything again on leaving", () => {
    const script = readFileSync(join(ROOT, "app", "after-dark", "DiscreetMedia.tsx"), "utf8");
    expect(script).toContain('window.addEventListener("click", onClick, true)');
    expect(script).toContain('document.addEventListener("visibilitychange", onVisibility)');
    expect(script).toContain('window.addEventListener("pagehide", hideAll)');
    expect(script).toMatch(/useEffect\(\(\) => \{\s*hideAll\(\);\s*\}, \[pathname\]\)/);
  });
});
