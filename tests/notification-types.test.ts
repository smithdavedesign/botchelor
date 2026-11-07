// Notification types (lib/notification-types.ts; David 2026-11-07: "add types to the notifications so you can filter by
// the type"): every kind folds into one of six types, and /notifications filters, counts and marks read by type.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/notifications/route";
import { NOTIFICATION_TYPES, kindsOfType, notificationTypeOf } from "@/lib/notification-types";
import { countNotifications, countNotificationsByKind, listNotifications, markRead, notify } from "@/lib/notifications";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";


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
