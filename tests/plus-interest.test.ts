// Money at the free-dates wall (2026-11-14): the 429 that refuses a date carries what's on sale and where else to go, and
// the "Botchelor Plus" intent tile records interest (lib/plus-interest.ts) without selling or charging anything. The row
// is in the account export, goes on delete, and its email (if left) lives only on the Sunday letter's list.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as plusRoute } from "@/app/api/plus-interest/route";
import { deleteAccount, exportAccount } from "@/lib/account";
import { setEmailSenderForTests, type EmailMessage } from "@/lib/email";
import { plusInterestCount, recordPlusInterest } from "@/lib/plus-interest";
import { FREE_EPISODES_PER_SEASON as FREE } from "@/lib/rules";
import { spendView } from "@/lib/spend";
import { api, episodeJson, FAKE_LINKS, HOUSE_PARTNER_ID, newUserCookie, openPayments, scriptedModel, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
let sent: EmailMessage[] = [];
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  sent = [];
  setEmailSenderForTests(async (msg) => {
    sent.push(msg);
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setEmailSenderForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const BASE = "http://localhost:3000";
let ip = 0;
/** A tap from a browser (its own address unless given), with the visitor's cookie. */
const tap = (body: unknown, opts: { cookie?: string; ip?: string; ua?: string } = {}) =>
  plusRoute(
    new Request(`${BASE}/api/plus-interest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": opts.ip ?? `203.0.113.${(++ip % 250) + 1}`,
        "user-agent": opts.ua ?? "Mozilla/5.0 (Macintosh)",
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
const rows = async () => (await t.db.query<{ user_id: string; place: string; with_email: boolean }>("select user_id, place, with_email from plus_interest order by place")).rows;
const letterOn = () => {
  vi.stubEnv("RESEND_API_KEY", ["re", "test", "key"].join("_"));
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("SITE_URL", "https://botchelor.com");
};

describe("the out-of-dates wall sells (POST /api/episodes 429)", () => {
  async function creatorAtTheWall() {
    const cookie = newUserCookie();
    const res = await api.createCharacter(validCharacter(), cookie);
    expect(res.status).toBe(201);
    const characterId = (await res.json()).id as string;
    for (let i = 0; i < FREE; i++) {
      scriptedModel([episodeJson()]);
      expect((await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, cookie)).status).toBe(200);
    }
    return { cookie, characterId };
  }
  const refusal = async (c: { cookie: string; characterId: string }) => {
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: c.characterId, partner_id: HOUSE_PARTNER_ID }, c.cookie);
    expect(res.status).toBe(429);
    return (await res.json()) as Record<string, unknown>;
  };

  it("lists the packs that can be bought now, the shop, and no thread or plan when there is none", async () => {
    openPayments(vi.stubEnv);
    vi.stubEnv("COMPANION_OPEN", "");
    const body = await refusal(await creatorAtTheWall());
    expect(body).toMatchObject({ error: "episode_limit_reached", shop: "/shop", shop_path: "/shop", newsletter: false });
    expect(body.packs).toEqual([
      { sku: "pack_5", name: "5 more dates", price_cents: 400, episodes: 5 },
      { sku: "pack_15", name: "15 more dates", price_cents: 1000, episodes: 15 },
    ]);
    expect(body).not.toHaveProperty("thread");
    expect(body).not.toHaveProperty("plan");
  });

  it("lists only the packs whose link is set (none while purchases aren't open)", async () => {
    vi.stubEnv("STRIPE_PAYMENT_LINK", "");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PAYMENT_LINK", "");
    vi.stubEnv("STRIPE_LINK_PACK_15", FAKE_LINKS.pack_15.url);
    const body = await refusal(await creatorAtTheWall());
    expect((body.packs as { sku: string }[]).map((p) => p.sku)).toEqual(["pack_15"]);
    vi.stubEnv("STRIPE_LINK_PACK_15", "");
    expect((await refusal(await creatorAtTheWall())).packs).toEqual([]);
  });

  it("points at the person's own companion thread with that character, and the plan while it's open", async () => {
    openPayments(vi.stubEnv);
    const c = await creatorAtTheWall();
    const threadId = randomUUID();
    await t.db.query("insert into companion_threads (id, user_id, character_id) values ($1, $2, $3)", [threadId, userIdOf(c.cookie), c.characterId]);
    // Someone else's thread with the same character is not theirs.
    await t.db.query("insert into companion_threads (id, user_id, character_id) values ($1, $2, $3)", [randomUUID(), "someone-else", c.characterId]);
    vi.stubEnv("COMPANION_OPEN", "1");
    vi.stubEnv("COMPANION_PLAN_LINK", "https://buy.stripe.com/test_companionPlan");
    expect(await refusal(c)).toMatchObject({ thread: `/companion/${threadId}`, plan: "/companion/plan" });
  });
});

describe("POST /api/plus-interest", () => {
  it("records one row per person and place, keeps the visitor's cookie, and counts people not taps", async () => {
    const cookie = newUserCookie();
    const first = await tap({ place: "shop" }, { cookie });
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ ok: true, with_email: false });
    expect((await tap({ place: "shop" }, { cookie })).status).toBe(201);
    expect((await tap({ place: "out_of_dates" }, { cookie })).status).toBe(201);
    expect(await rows()).toEqual([
      { user_id: userIdOf(cookie), place: "out_of_dates", with_email: false },
      { user_id: userIdOf(cookie), place: "shop", with_email: false },
    ]);
    expect(await plusInterestCount(t.db)).toEqual({ people: 1, with_email: 0, taps: 2 });

    // A visitor with no cookie yet gets one, so a second tap is the same person.
    const fresh = await tap({ place: "shop" });
    expect(fresh.status).toBe(201);
    expect(fresh.headers.get("set-cookie")).toMatch(/bz_(uid|sess)=/);
    expect((await plusInterestCount(t.db)).people).toBe(2);
    expect(sent).toEqual([]);
  });

  it("refuses an unknown place, a bot, and too many taps from one connection", async () => {
    expect((await tap({ place: "footer" })).status).toBe(422);
    expect((await tap({ place: "shop" }, { ua: "Mozilla/5.0 (compatible; Googlebot/2.1)" })).status).toBe(403);
    for (let i = 0; i < 10; i++) expect((await tap({ place: "shop" }, { ip: "198.51.100.7" })).status).toBe(201);
    expect((await tap({ place: "shop" }, { ip: "198.51.100.7" })).status).toBe(429);
    expect(await t.count("plus_interest")).toBe(10);
  });

  it("puts an email on the Sunday letter's list (pending, confirmation sent), never in the row, and needs the 18+ box", async () => {
    letterOn();
    const cookie = newUserCookie();
    expect((await tap({ place: "shop", email: "fan@example.com" }, { cookie })).status).toBe(422);
    expect(await t.count("plus_interest")).toBe(0);

    const res = await tap({ place: "shop", email: " Fan@Example.com ", attest: true }, { cookie });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, with_email: true });
    expect(await rows()).toEqual([{ user_id: userIdOf(cookie), place: "shop", with_email: true }]);
    const list = await t.db.query<{ email: string; status: string }>("select email, status from newsletter_subscribers");
    expect(list.rows).toEqual([{ email: "fan@example.com", status: "pending" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("fan@example.com");
    // The address is nowhere in the row's table.
    expect(JSON.stringify(await rows())).not.toContain("example.com");
    expect(await plusInterestCount(t.db)).toEqual({ people: 1, with_email: 1, taps: 1 });

    // A blank email is no email.
    expect((await tap({ place: "out_of_dates", email: "" }, { cookie })).status).toBe(201);
    expect((await rows()).find((r) => r.place === "out_of_dates")?.with_email).toBe(false);
  });

  it("answers 503 for an email while the letter is off, so the tap can be sent again without one", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const res = await tap({ place: "shop", email: "fan@example.com", attest: true });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("newsletter_off");
    expect(await t.count("plus_interest")).toBe(0);
  });
});

describe("the row's coverage (docs/data-plan.md)", () => {
  it("is in the account export, goes on delete, and shows on the spend view", async () => {
    const cookie = newUserCookie();
    const user = userIdOf(cookie);
    await recordPlusInterest(t.db, user, "shop", false);
    await recordPlusInterest(t.db, user, "out_of_dates", true);
    await recordPlusInterest(t.db, "someone-else", "shop", false);
    const out = await exportAccount(t.db, user);
    expect(out.plus_interest).toEqual([expect.objectContaining({ place: "shop", with_email: false }), expect.objectContaining({ place: "out_of_dates", with_email: true })]);

    const view = await spendView(t.db, "2026-11", {}, async () => new Response("{}", { status: 404 }));
    expect(view.plus_interest).toEqual({ people: 2, with_email: 1, taps: 3 });

    await deleteAccount(t.db, user);
    expect(await rows()).toEqual([{ user_id: "someone-else", place: "shop", with_email: false }]);
  });
});
