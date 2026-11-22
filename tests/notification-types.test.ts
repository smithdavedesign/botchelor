// Notification types (lib/notification-types.ts; David 2026-11-07: "add types to the notifications so you can filter by
// the type"): every kind folds into one of six types, and /notifications filters, counts and marks read by type.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/notifications/route";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { NOTIFICATION_TYPES, kindsOfType, notificationTypeOf, withoutRawIds } from "@/lib/notification-types";
import { ENDED_MATCH_BODY, countNotifications, countNotificationsByKind, listNotifications, markRead, notify, unreadCount } from "@/lib/notifications";
import { POST as mutesPost } from "@/app/api/notifications/mutes/route";
import { mutedTypes, setMuted } from "@/lib/notification-mutes";
import { jsonRequest, newUserCookie, startTestDb, userIdOf } from "./helpers";


let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

describe("the types (lib/notification-types.ts)", () => {
  it("splits the kinds into six types with none left over and none shared", () => {
    const all = NOTIFICATION_TYPES.flatMap((ty) => kindsOfType(ty));
    expect(new Set(all).size).toBe(all.length);
    for (const ty of NOTIFICATION_TYPES) expect(kindsOfType(ty).length).toBeGreaterThan(0);
    expect(notificationTypeOf("texted")).toBe("texts");
    expect(notificationTypeOf("own_date_turn")).toBe("agents");
    expect(notificationTypeOf("key_capped")).toBe("account");
    expect(notificationTypeOf("a_kind_from_long_ago")).toBe("show");
  });
});

describe("filtering by type (lib/notifications.ts)", () => {
  it("lists, counts and marks read one type, leaving the others alone", async () => {
    const u = "user-types";
    await notify(t.db, u, { kind: "texted", title: "Bo texted Cy", body: null, link: null });
    await notify(t.db, u, { kind: "matched", title: "A match", body: null, link: null });
    await notify(t.db, u, { kind: "situation_on", title: "Your pick won", body: null, link: null });
    const dates = kindsOfType("dates");
    expect((await listNotifications(t.db, u, 50, 0, { kinds: dates })).map((n) => n.kind)).toEqual(["matched"]);
    expect(await listNotifications(t.db, u)).toHaveLength(3);
    expect(await countNotifications(t.db, u, { kinds: dates })).toBe(1);
    const byKind = await countNotificationsByKind(t.db, u);
    expect(byKind.find((r) => r.kind === "texted")).toEqual({ kind: "texted", n: 1, unread: 1 });
    expect(await markRead(t.db, u, "all", { kinds: dates })).toBe(1);
    expect(await countNotifications(t.db, u, { unread: true })).toBe(2);
  });

  it("the API takes ?type= and labels every item with its type", async () => {
    const cookie = newUserCookie();
    const u = userIdOf(cookie);
    await notify(t.db, u, { kind: "texted", title: "Bo texted Cy", body: null, link: null });
    await notify(t.db, u, { kind: "key_failed", title: "Your key stopped working", body: null, link: null });
    const body = await (await GET(new Request("http://localhost:3000/api/notifications?type=account", { headers: { cookie } }))).json();
    expect(body.notifications.map((n: { kind: string; type: string }) => [n.kind, n.type])).toEqual([["key_failed", "account"]]);
  });
});

describe("muting a type (lib/notification-mutes.ts)", () => {
  it("a muted type still lands in the inbox, already read; unmuting brings the bell back", async () => {
    const cookie = newUserCookie();
    const u = userIdOf(cookie);
    const res = await mutesPost(jsonRequest("/api/notifications/mutes", { type: "texts", muted: true }, { cookie }));
    expect((await res.json()).muted).toEqual(["texts"]);
    await notify(t.db, u, { kind: "texted", title: "Bo texted Cy", body: null, link: null });
    await notify(t.db, u, { kind: "matched", title: "A match", body: null, link: null });
    expect(await countNotifications(t.db, u)).toBe(2);
    expect(await countNotifications(t.db, u, { unread: true })).toBe(1);
    expect(await mutedTypes(t.db, u)).toEqual(["texts"]);
    await setMuted(t.db, u, "texts", false);
    await notify(t.db, u, { kind: "texted", title: "Cy texted Bo", body: null, link: null });
    expect(await countNotifications(t.db, u, { unread: true })).toBe(2);
    expect((await mutesPost(jsonRequest("/api/notifications/mutes", { type: "nope", muted: true }, { cookie }))).status).toBe(422);
  });
});

// UX audit 2026-11-22: /notifications showed four near-identical "likes waiting" rows, a date's raw id read aloud, and
// Oct 31's "Book it" prompts with no sign of whether they could still be done.
describe("the inbox says each thing once, in words, and asks only for what can still be done", () => {
  it("takes a date's id out of what a person reads, and leaves the rest", () => {
    const id = "75e7bd34-4a64-4168-804d-6572a87b4795";
    expect(withoutRawIds(`Public. Watch it to see how it ended. Episode ${id}.`)).toBe("Public. Watch it to see how it ended.");
    expect(withoutRawIds(`Date ${id}. Nothing was shown or spent.`)).toBe("Nothing was shown or spent.");
    expect(withoutRawIds("Episode 3 of the season.")).toBe("Episode 3 of the season.");
  });

  it("lists and counts only the newest likes-waiting notice: it counts every like the older ones did", async () => {
    const u = `user-${randomUUID()}`;
    for (const [n, hoursAgo] of [[5, 72], [8, 48], [11, 1]] as const) {
      await notify(t.db, u, { kind: "likes_waiting", title: `💘 Vesper and 1 more: ${n} likes waiting`, body: null, link: "/swipe" });
      await t.db.query(`update notifications set created_at = now() - make_interval(hours => $2) where user_id = $1 and title like $3`, [u, hoursAgo, `%: ${n} likes%`]);
    }
    await notify(t.db, u, { kind: "texted", title: "Bo texted Cy", body: null, link: null });
    expect((await listNotifications(t.db, u)).map((n) => n.title)).toEqual(["Bo texted Cy", "💘 Vesper and 1 more: 11 likes waiting"]);
    expect(await countNotifications(t.db, u)).toBe(2);
    expect(await countNotifications(t.db, u, { unread: true, kinds: ["likes_waiting"] })).toBe(1);
    expect(await unreadCount(t.db, u)).toBe(2);
    expect((await countNotificationsByKind(t.db, u)).find((r) => r.kind === "likes_waiting")).toMatchObject({ n: 1, unread: 1 });
  });

  it("says a match has ended instead of asking to book it, and leaves a live match asking", async () => {
    const u = `user-${randomUUID()}`;
    const [lo, hi] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
    await t.db.query(`delete from matches where character_lo = $1 and character_hi = $2`, [lo, hi]);
    await t.db.query(`insert into matches (character_lo, character_hi) values ($1, $2)`, [lo, hi]);
    await notify(t.db, u, { kind: "date_agreed", title: "📅 They want to go on a date", body: "Book it from their chat (📅 Book date), and the show plays them both.", link: `/messages/${lo}/${hi}` });
    const live = (await listNotifications(t.db, u))[0];
    expect(live).toMatchObject({ read: false, body: expect.stringMatching(/^Book it/) });
    expect(live.ended).toBeUndefined();
    // One of them unmatched (lib/unmatch.ts keeps that, and deletes the match).
    await t.db.query(`insert into unmatches (character_lo, character_hi, by_character) values ($1, $2, $1) on conflict do nothing`, [lo, hi]);
    await t.db.query(`delete from matches where character_lo = $1 and character_hi = $2`, [lo, hi]);
    expect((await listNotifications(t.db, u))[0]).toMatchObject({ read: true, ended: true, body: ENDED_MATCH_BODY, link: `/messages/${lo}/${hi}` });
    expect(await unreadCount(t.db, u)).toBe(0);
    await t.db.query(`delete from unmatches where character_lo = $1 and character_hi = $2`, [lo, hi]);
  });

  it("calls a pair whose character was deleted ended too, but not a pair that never needed a match row", async () => {
    const u = `user-${randomUUID()}`;
    const [lo, hi] = [HOUSE_CHARACTERS[2].id, HOUSE_CHARACTERS[3].id].sort();
    await t.db.query(`delete from matches where character_lo = $1 and character_hi = $2`, [lo, hi]);
    // A house partner's date needs no match: the prompt still asks.
    await notify(t.db, u, { kind: "date_agreed", title: "📅 They want to go on a date", body: "Book it from their chat.", link: `/messages/${lo}/${hi}` });
    expect((await listNotifications(t.db, u))[0]).toMatchObject({ read: false, body: "Book it from their chat." });
    const gone = `gone-${randomUUID()}`;
    await notify(t.db, u, { kind: "matched", title: "💘 A match", body: "Say hi.", link: `/messages/${[lo, gone].sort().join("/")}` });
    const [first] = await listNotifications(t.db, u);
    expect(first).toMatchObject({ kind: "matched", ended: true, body: ENDED_MATCH_BODY });
  });
});
