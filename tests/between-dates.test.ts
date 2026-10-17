import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as clearNotificationsRoute, GET as getNotifications, POST as markNotifications } from "@/app/api/notifications/route";
import { POST as pushSubscribe } from "@/app/api/push/route";
import { POST as postSecondDate } from "@/app/api/episodes/[id]/second-date/route";
import { activeNudge, alsoSeeing, coupleTexts, couplesToText, dailyTextCap, sendDailyTexts, setNudge } from "@/lib/between-dates";
import type { SideOutcome } from "@/lib/engine";
import { handleMcpMessage } from "@/lib/mcp";
import type { Model } from "@/lib/model";
import { listNotifications, notify } from "@/lib/notifications";
import { isPushEndpoint, pushToUser, saveSubscription, setPushSenderForTests } from "@/lib/push";
import { pairKey } from "@/lib/relationships";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
/** A model that answers with these texts in turn (a string), or fails (an Error). */
const textModel = (outputs: (string | Error)[]): Model & { calls: number } => {
  const m = {
    calls: 0,
    async complete() {
      const next = outputs[m.calls++] ?? "nothing";
      if (next instanceof Error) throw next;
      return JSON.stringify({ text: next });
    },
  };
  return m;
};

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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setPushSenderForTests(null);
});

/** An owner's character on an aired public date with the house partner, ending as scripted. */
async function airedCouple(ending: "second_date" | "friends" | "disaster" = "second_date", wants: [boolean, boolean] = [true, true]) {
  const creator = newUserCookie();
  const character = await (await api.createCharacter(validCharacter(), creator)).json();
  scriptOutcome({ ending, sides: [side(wants[0]), side(wants[1])] });
  scriptedModel([episodeJson()]);
  const episode = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
  await api.reveal(episode.id, creator);
  return { creator, owner: userIdOf(creator), character, episode };
}

describe("a text a day", () => {
  it("couples on good terms with an active owner text once a day; the owner hears about it", async () => {
    const { owner, character } = await airedCouple("second_date");
    const now = new Date();
    expect((await couplesToText(t.db, now, 10)).map((c) => [c.lo, c.hi])).toEqual([pairKey(character.id, HOUSE_PARTNER_ID)]);

    const model = textModel(["Still thinking about the karaoke booth.", "Same. Round two?"]);
    const r = await sendDailyTexts(t.db, model, now);
    expect(r).toEqual({ couples: 1, texts: 2, failed: 0 });
    const texts = await coupleTexts(t.db, character.id, HOUSE_PARTNER_ID);
    expect(texts.map((x) => x.text)).toEqual(["Still thinking about the karaoke booth.", "Same. Round two?"]);
    expect(new Set(texts.map((x) => x.who)).size).toBe(2); // one each

    const inbox = await listNotifications(t.db, owner);
    expect(inbox[0]).toMatchObject({ kind: "texted", body: "Same. Round two?" });
    expect(inbox[0].link).toMatch(/^\/couples\//);

    // Once a day.
    expect(await couplesToText(t.db, now, 10)).toEqual([]);
    expect((await sendDailyTexts(t.db, textModel(["again"]), now)).couples).toBe(0);
  });

  it("not for exes or bad blood, and nothing without a reply keeps only what was sent", async () => {
    await airedCouple("disaster", [false, false]);
    expect(await couplesToText(t.db, new Date(), 10)).toEqual([]);

    const { character } = await airedCouple("friends", [true, false]);
    const r = await sendDailyTexts(t.db, textModel(["Fun night, friend.", new Error("down"), new Error("down")]), new Date());
    expect(r).toEqual({ couples: 1, texts: 1, failed: 0 });
    expect((await coupleTexts(t.db, character.id, HOUSE_PARTNER_ID)).length).toBe(1);
  });

  it("a couple whose first text can't be written is skipped, and a text that fails the content filter is retried", async () => {
    const { character } = await airedCouple("second_date");
    expect(await sendDailyTexts(t.db, textModel([new Error("down"), new Error("down")]), new Date())).toEqual({ couples: 0, texts: 0, failed: 1 });
    const retried = await sendDailyTexts(t.db, textModel(["my 15 year old cousin says hi", "Clean second try.", "Reply."]), new Date());
    expect(retried.texts).toBe(2);
    expect((await coupleTexts(t.db, character.id, HOUSE_PARTNER_ID)).map((x) => x.text)).toEqual(["Clean second try.", "Reply."]);
  });

  it("the daily cap is configurable and bounded", () => {
    expect(dailyTextCap({})).toBe(10);
    expect(dailyTextCap({ DAILY_TEXT_COUPLES: "0" })).toBe(0);
    expect(dailyTextCap({ DAILY_TEXT_COUPLES: "999" })).toBe(50);
  });

  it("owners read the texts over MCP; anyone else doesn't", async () => {
    const { owner, character } = await airedCouple("second_date");
    await sendDailyTexts(t.db, textModel(["Hey you.", "Hey yourself."]), new Date());
    const rpc = (args: Record<string, unknown>) =>
      handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_relationships", arguments: args } }, {}) as Promise<Any>;
    const mine = (await rpc({ character_id: character.id, agent_id: owner })).result.structuredContent;
    expect(mine.relationships[0].texts.map((x: Any) => x.text)).toEqual(["Hey you.", "Hey yourself."]);
    const theirs = (await rpc({ character_id: character.id })).result.structuredContent;
    expect(theirs.relationships[0].texts).toBeUndefined();
  });
});

describe("nudges", () => {
  it("an owner's note about someone their character dated goes into their next date, then it's used", async () => {
    const { creator, owner, character } = await airedCouple("second_date");
    expect(await setNudge(t.db, owner, character.id, HOUSE_PARTNER_ID, "  Bring up   the boat. ")).toEqual({ ok: true, note: "Bring up the boat." });
    expect(await activeNudge(t.db, character.id, HOUSE_PARTNER_ID)).toBe("Bring up the boat.");

    scriptOutcome({ ending: "friends", sides: [side(true), side(false)] });
    scriptedModel([episodeJson()]);
    const next = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    const setup = (await t.db.query<Any>(`select setup from episodes where id = $1`, [next.id])).rows[0].setup;
    expect(setup.nudge_a).toBe("Bring up the boat.");
    expect(await activeNudge(t.db, character.id, HOUSE_PARTNER_ID)).toBeNull(); // used
  });

  it("only for your own character, only about someone it has dated, and clean", async () => {
    const { owner, character } = await airedCouple("second_date");
    expect((await setNudge(t.db, "someone-else", character.id, HOUSE_PARTNER_ID, "hi")).ok).toBe(false);
    expect(await setNudge(t.db, owner, character.id, "house-juniper", "hi")).toMatchObject({ ok: false, status: 404 });
    expect(await setNudge(t.db, owner, character.id, HOUSE_PARTNER_ID, "x".repeat(141))).toMatchObject({ ok: false, status: 422 });
    expect(await setNudge(t.db, owner, character.id, HOUSE_PARTNER_ID, "mention your 12 year old niece")).toMatchObject({ ok: false, error: "content_rejected" });
  });
});

describe("drama: seeing more than one person", () => {
  it("a character with another warm public relationship knows it, and its next date carries it", async () => {
    const { creator, character } = await airedCouple("second_date");
    // A second warm relationship, with another house character.
    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptedModel([episodeJson()]);
    const other = await (await api.createEpisode({ character_id: character.id, partner_id: "house-juniper" }, creator)).json();
    await api.reveal(other.id, creator);
    expect(await alsoSeeing(t.db, character.id, HOUSE_PARTNER_ID)).toEqual(["Juniper Vale"]);
    expect(await alsoSeeing(t.db, character.id, null)).toHaveLength(2);
  });
});

describe("notifications", () => {
  it("the other creator hears a second-date yes, and a stage-up reaches the owner when the date airs", async () => {
    const { owner } = await airedCouple("second_date");
    const inbox = await listNotifications(t.db, owner);
    expect(inbox.map((n) => n.kind)).toContain("stage_up");
    expect(inbox.find((n) => n.kind === "stage_up")!.title).toMatch(/Sparks/);
  });

  it("a yes that needs the other creator notifies them", async () => {
    const host = newUserCookie();
    const partner = newUserCookie();
    await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), partner)).json();
    const hostCharacter = await (await api.createCharacter(validCharacter(), host)).json();
    scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
    scriptedModel([episodeJson()]);
    const ep = await (await api.createEpisode({ character_id: hostCharacter.id, blind: true }, host)).json();
    const res = await postSecondDate(
      new Request(`${BASE_URL}/api/episodes/${ep.id}/second-date`, { method: "POST", headers: { cookie: host, "content-type": "application/json" }, body: "{}" }),
      { params: Promise.resolve({ id: ep.id }) },
    );
    expect(res.status).toBe(202);
    const theirs = await listNotifications(t.db, userIdOf(partner));
    expect(theirs[0]).toMatchObject({ kind: "second_date_yes", link: `/episodes/${ep.id}` });
  });

  it("the inbox API lists and marks read", async () => {
    const me = newUserCookie();
    await notify(t.db, userIdOf(me), { kind: "texted", title: "💬 Hi", body: "there" });
    const list = await (await getNotifications(new Request(`${BASE_URL}/api/notifications`, { headers: { cookie: me } }))).json();
    expect(list.unread).toBe(1);
    await markNotifications(new Request(`${BASE_URL}/api/notifications`, { method: "POST", headers: { cookie: me, "content-type": "application/json" }, body: JSON.stringify({ all: true }) }));
    expect((await (await getNotifications(new Request(`${BASE_URL}/api/notifications`, { headers: { cookie: me } }))).json()).unread).toBe(0);
  });

  it("the inbox API clears one notification or all of yours, never anyone else's", async () => {
    const me = newUserCookie();
    const someone = newUserCookie();
    for (const title of ["💬 One", "💬 Two", "💬 Three"]) await notify(t.db, userIdOf(me), { kind: "texted", title });
    await notify(t.db, userIdOf(someone), { kind: "texted", title: "💬 Theirs" });
    const del = (cookie: string, body: unknown) =>
      clearNotificationsRoute(new Request(`${BASE_URL}/api/notifications`, { method: "DELETE", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));

    const mine = await listNotifications(t.db, userIdOf(me));
    const theirs = await listNotifications(t.db, userIdOf(someone));
    // Clearing someone else's id from my session does nothing.
    expect((await (await del(me, { ids: [theirs[0].id] })).json()).cleared).toBe(0);

    const one = await (await del(me, { ids: [mine[0].id] })).json();
    expect(one).toMatchObject({ cleared: 1, unread: 2 });
    expect((await listNotifications(t.db, userIdOf(me))).map((n) => n.title)).not.toContain(mine[0].title);

    expect((await (await del(me, { all: true })).json())).toMatchObject({ cleared: 2, unread: 0 });
    expect(await listNotifications(t.db, userIdOf(me))).toEqual([]);
    expect(await listNotifications(t.db, userIdOf(someone))).toHaveLength(1);
    expect((await del(me, {})).status).toBe(422);
  });

  it("push goes to a subscribed browser when keys are set; a gone subscription is dropped; only real push services", async () => {
    const me = userIdOf(newUserCookie());
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc123";
    await saveSubscription(t.db, me, { endpoint, keys: { p256dh: "BKey", auth: "auth" } });
    const sent: string[] = [];
    setPushSenderForTests(async (_sub, payload) => {
      sent.push(payload);
      return { statusCode: 201 };
    });
    expect(await pushToUser(t.db, me, { title: "t", body: "b", url: "/x" }, {})).toBe(0); // no keys: off
    const env = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: ["pri", "vate"].join("") };
    expect(await pushToUser(t.db, me, { title: "t", body: "b", url: "/x" }, env)).toBe(1);
    expect(JSON.parse(sent[0])).toEqual({ title: "t", body: "b", url: "/x" });

    setPushSenderForTests(async () => {
      throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    expect(await pushToUser(t.db, me, { title: "t", body: "b", url: "/x" }, env)).toBe(0);
    expect((await t.db.query(`select 1 from push_subscriptions where endpoint = $1`, [endpoint])).rows).toHaveLength(0);

    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/x")).toBe(true);
    expect(isPushEndpoint("https://evil.example/push")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", ["pri", "vate"].join(""));
    const bad = await pushSubscribe(
      new Request(`${BASE_URL}/api/push`, { method: "POST", headers: { cookie: newUserCookie(), "content-type": "application/json" }, body: JSON.stringify({ endpoint: "https://evil.example/x", keys: { p256dh: "a", auth: "b" } }) }),
    );
    expect(bad.status).toBe(422);
  });
});
