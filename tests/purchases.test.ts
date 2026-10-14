import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG, catalogItem, ITEM_KINDS, ON_SALE } from "@/lib/catalog";
import { ensureSchema } from "@/lib/db";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { ownedSkus } from "@/lib/payments";
import { checkFields } from "@/lib/safety";
import {
  api,
  buy,
  episodeJson,
  FAKE_PAYMENT_LINK,
  grantByHand,
  named,
  newUserCookie,
  openPayments,
  scriptedModel,
  setupEpisode,
  startTestDb,
  userIdOf,
  validCharacter,
} from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  openPayments(vi.stubEnv);
});

const CHARACTER_ITEMS = CATALOG.filter((i) => i.kind === "house_character");
const FRAME_ITEMS = CATALOG.filter((i) => i.kind === "frame");
const OFF_SALE = CATALOG.filter((i) => !ON_SALE.includes(i));
const PACK = ON_SALE[0];

type Entry = { rank: number; name: string; points: number; me: boolean; frame?: string };

async function newLeague(owner: string, members: string[]) {
  const league = await (await api.createLeague({ name: "Rooftop Regulars" }, owner)).json();
  for (const member of members) expect((await api.joinLeague(league.id, member)).status).toBe(201);
  return league as { id: string };
}

async function board(leagueId: string): Promise<Entry[]> {
  return (await (await api.getLeague(leagueId)).json()).leaderboard;
}

const points = async (cookie: string): Promise<number> => (await (await api.me(cookie)).json()).points;

/** Two aired episodes ("friends", then "disaster"); each user picks [first, second]. */
async function playTwoEpisodes(picks: [string, [string, string]][]) {
  const a = await setupEpisode("friends");
  const b = await setupEpisode("disaster");
  for (const [cookie, [pickA, pickB]] of picks) {
    expect((await api.predict({ episode_id: a.episode.id, pick: pickA }, cookie)).status).toBe(201);
    expect((await api.predict({ episode_id: b.episode.id, pick: pickB }, cookie)).status).toBe(201);
  }
  expect((await api.reveal(a.episode.id, a.creator)).status).toBe(200);
  expect((await api.reveal(b.episode.id, b.creator)).status).toBe(200);
}

async function dateWith(partnerId: string, creator: string) {
  const own = await (await api.createCharacter(validCharacter(), creator)).json();
  const model = scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: own.id, partner_id: partnerId }, creator);
  return { res, model };
}

const ordersOf = async (cookie: string) =>
  (await t.db.query("select * from orders where user_id = $1 order by created_at", [userIdOf(cookie)])).rows;

describe("buying never changes points or rank (exit criterion)", () => {
  // M3 bought every SKU through Stripe Checkout. Since the owner's Payment Link note, one link sells one
  // thing, so every SKU on sale is bought through it and every other one is granted the way a purchase is
  // restored by hand. Either way the same check runs after each one.
  it("buys every SKU (on sale: through the Payment Link; off sale: by hand) and leaves every user's points balance and league rank unchanged", async () => {
    const wren = await named(newUserCookie(), "Wren");
    const kestrel = await named(newUserCookie(), "Kestrel");
    const alder = await named(newUserCookie(), "Alder");
    const league = await newLeague(kestrel, [wren, alder]);
    await playTwoEpisodes([
      [wren, ["friends", "disaster"]], // 20
      [kestrel, ["friends", "second_date"]], // 10
      [alder, ["disaster", "friends"]], // 0
    ]);

    const snapshot = async () => ({
      points: [await points(wren), await points(kestrel), await points(alder)],
      board: (await board(league.id)).map(({ rank, name, points: p }) => ({ rank, name, points: p })),
    });
    const before = await snapshot();
    expect(before).toEqual({
      points: [20, 10, 0],
      board: [
        { rank: 1, name: "Wren", points: 20 },
        { rank: 2, name: "Kestrel", points: 10 },
        { rank: 3, name: "Alder", points: 0 },
      ],
    });

    // The middle player and the last-placed player each get every SKU: a change in either direction would show.
    expect(ON_SALE.length).toBeGreaterThanOrEqual(1);
    expect(CHARACTER_ITEMS.length).toBeGreaterThanOrEqual(1);
    expect(FRAME_ITEMS.length).toBeGreaterThanOrEqual(1);
    for (const buyer of [kestrel, alder]) {
      for (const item of CATALOG) {
        if (ON_SALE.includes(item)) await buy(item.sku, buyer);
        else await grantByHand(t.db, buyer, item.sku);
        expect(await ownedSkus(t.db, userIdOf(buyer))).toContain(item.sku);
        expect(await snapshot()).toEqual(before);
      }
    }
    expect(await t.count("orders", "status = 'paid'")).toBe(CATALOG.length * 2);

    // Using what was bought changes nothing either: a date with each premium character.
    for (const item of CHARACTER_ITEMS) {
      const { res } = await dateWith(item.character_id!, kestrel);
      expect(res.status).toBe(200);
    }
    expect(await snapshot()).toEqual(before);
  });
});

describe("POST /api/checkout (Stripe Payment Link)", () => {
  it("answers with the Payment Link carrying the new order's id as client_reference_id, and stores a pending order at the list price", async () => {
    for (const item of ON_SALE) {
      const buyer = newUserCookie();
      // Smuggled price, currency, episode and points fields are ignored: the server prices from the catalog.
      const res = await api.checkout(
        { sku: item.sku, attest: true, amount: 1, price_cents: 1, currency: "jpy", episodes: 1000, points: 1000 },
        buyer,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Object.keys(body)).toEqual(["url"]);

      const rows = await ordersOf(buyer);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sku: item.sku,
        kind: item.kind,
        amount_cents: item.price_cents,
        currency: "usd",
        status: "pending",
        episodes: item.episodes ?? null,
        stripe_session_id: null,
        paid_at: null,
      });

      // The owner's link, plus our random order id; never the user's session cookie.
      const url = new URL(body.url);
      expect(`${url.origin}${url.pathname}`).toBe(FAKE_PAYMENT_LINK);
      expect([...url.searchParams]).toEqual([["client_reference_id", rows[0].id]]);
      expect(body.url).not.toContain(userIdOf(buyer));
    }
  });

  it("keeps a query already on the link, and sets exactly one client_reference_id", async () => {
    vi.stubEnv("STRIPE_PAYMENT_LINK", `${FAKE_PAYMENT_LINK}?locale=en&client_reference_id=stale`);
    const buyer = newUserCookie();
    const res = await api.checkout({ sku: PACK.sku, attest: true }, buyer);
    expect(res.status).toBe(200);
    const url = new URL((await res.json()).url);
    expect(url.searchParams.get("locale")).toBe("en");
    expect(url.searchParams.getAll("client_reference_id")).toEqual([(await ordersOf(buyer))[0].id]);
  });

  it("never calls Stripe (or anything else) over the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      expect((await api.checkout({ sku: PACK.sku, attest: true }, newUserCookie())).status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("gives a first-time visitor a session cookie, so the order has an owner", async () => {
    const res = await api.checkout({ sku: PACK.sku, attest: true });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    const userId = /bz_uid=([0-9a-f-]{36})/.exec(cookie)?.[1];
    expect(userId).toBeDefined();
    expect(await t.count("orders", `user_id = '${userId}'`)).toBe(1);
  });

  it.each([
    ["no attestation", { sku: "pack_5" }],
    ["attest: false", { sku: "pack_5", attest: false }],
    ["no sku", { attest: true }],
    ["an unknown sku", { sku: "frame_diamond", attest: true }],
    ...OFF_SALE.map((i): [string, Record<string, unknown>] => [`${i.sku}, which is off sale`, { sku: i.sku, attest: true }]),
  ])("returns 422 for %s, storing nothing", async (_label, body) => {
    const res = await api.checkout(body, newUserCookie());
    expect(res.status).toBe(422);
    expect(await t.count("orders")).toBe(0);
  });

  it.each([
    ["unset", ""],
    ["plain http", "http://buy.stripe.com/test_botchelorSamplePack"],
    ["not a URL", "buy.stripe.com/test_botchelorSamplePack"],
    ["a javascript: URL", "javascript:alert(1)"],
  ])("returns 503 payments_unavailable when the Payment Link is %s, storing nothing", async (_label, link) => {
    vi.stubEnv("STRIPE_PAYMENT_LINK", link);
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PAYMENT_LINK", "");
    const res = await api.checkout({ sku: PACK.sku, attest: true }, newUserCookie());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("payments_unavailable");
    expect(await t.count("orders")).toBe(0);
  });

  it("lets a user buy the pack again, and retry after an abandoned checkout (a pending order is not ownership)", async () => {
    const buyer = newUserCookie();
    expect((await api.checkout({ sku: PACK.sku, attest: true }, buyer)).status).toBe(200);
    expect((await api.checkout({ sku: PACK.sku, attest: true }, buyer)).status).toBe(200);
    expect(await ownedSkus(t.db, userIdOf(buyer))).toEqual([]);
    await buy(PACK.sku, buyer);
    expect((await api.checkout({ sku: PACK.sku, attest: true }, buyer)).status).toBe(200);
    expect(await t.count("orders", `user_id = '${userIdOf(buyer)}'`)).toBe(4);
  });
});

describe("premium house characters (off sale; an owned one still dates)", () => {
  const premium = PREMIUM_HOUSE_CHARACTERS[0];

  it("returns 402 premium_character_locked to a creator who doesn't own it, before any model call", async () => {
    const creator = newUserCookie();
    const { res, model } = await dateWith(premium.id, creator);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "premium_character_locked", sku: premium.sku, shop_path: "/shop" });
    expect(model.calls).toHaveLength(0);
    expect(await t.count("episodes")).toBe(0);
  });

  it("dates its owner, as a labeled house character, with its sheet sent to the showrunner", async () => {
    const creator = newUserCookie();
    await grantByHand(t.db, creator, premium.sku);
    const { res, model } = await dateWith(premium.id, creator);
    expect(res.status).toBe(200);
    const episode = await res.json();
    expect(episode.characters[1]).toEqual({ id: premium.id, name: premium.name, house: true, hue: null });
    expect(episode.ai_generated).toBe(true);
    expect(model.calls[0].map((m) => m.content).join("\n")).toContain(premium.bio);
  });

  it("is unlocked per user: another creator is still locked out", async () => {
    await grantByHand(t.db, newUserCookie(), premium.sku);
    const { res } = await dateWith(premium.id, newUserCookie());
    expect(res.status).toBe(402);
  });

  it("locks again once the order is marked refunded", async () => {
    const creator = newUserCookie();
    await grantByHand(t.db, creator, premium.sku);
    await t.db.query("update orders set status = 'refunded' where user_id = $1", [userIdOf(creator)]);
    const { res } = await dateWith(premium.id, creator);
    expect(res.status).toBe(402);
  });

  it("is never picked for a blind date, even when it's the likelier draw", async () => {
    // Leave one free house character against every premium one: if premium were eligible, eight
    // fallbacks in a row would almost surely hit one. The creator's free dates are reset between draws
    // (M4 caps them per week; this test is about who gets drawn, not how often).
    const [keep, ...drop] = HOUSE_CHARACTERS.map((c) => c.id);
    await t.db.query("delete from characters where id = any($1::text[])", [drop]);
    try {
      const creator = newUserCookie();
      const own = await (await api.createCharacter(validCharacter(), creator)).json();
      for (let i = 0; i < 8; i++) {
        await t.db.query("delete from free_episode_usage where user_id = $1", [userIdOf(creator)]);
        scriptedModel([episodeJson()]);
        const res = await api.createEpisode({ character_id: own.id, blind: true }, creator);
        expect(res.status).toBe(200);
        expect((await res.json()).characters[1].id).toBe(keep);
      }
    } finally {
      await t.db.query("delete from episodes");
      await ensureSchema(t.db);
    }
  });
});

describe("profile frames (off sale; an owned one still shows)", () => {
  it("shows the latest frame owned on league boards, for that member only, without moving anyone", async () => {
    const wren = await named(newUserCookie(), "Wren");
    const kestrel = await named(newUserCookie(), "Kestrel");
    const league = await newLeague(wren, [kestrel]);
    const before = await board(league.id);
    expect(before.every((e) => !("frame" in e))).toBe(true);

    await grantByHand(t.db, kestrel, "frame_rose");
    let after = await board(league.id);
    expect(after.find((e) => e.name === "Kestrel")?.frame).toBe("frame_rose");
    expect(after.find((e) => e.name === "Wren")).not.toHaveProperty("frame");

    await grantByHand(t.db, kestrel, "frame_gold");
    after = await board(league.id);
    expect(after.find((e) => e.name === "Kestrel")?.frame).toBe("frame_gold");
    expect(after.map(({ rank, name, points: p }) => ({ rank, name, points: p }))).toEqual(
      before.map(({ rank, name, points: p }) => ({ rank, name, points: p })),
    );
  });

  it("doesn't show a frame from an unpaid (pending) order", async () => {
    const wren = await named(newUserCookie(), "Wren");
    const league = await newLeague(wren, []);
    await t.db.query(
      `insert into orders (id, user_id, sku, kind, amount_cents, currency, status)
       values ('o-pending-frame', $1, 'frame_rose', 'frame', 200, 'usd', 'pending')`,
      [userIdOf(wren)],
    );
    expect((await board(league.id))[0]).not.toHaveProperty("frame");
  });
});

describe("the catalog", () => {
  it("lists premium house characters, cosmetic frames and episode packs, each a one-time USD price", () => {
    expect(new Set(CATALOG.map((i) => i.sku)).size).toBe(CATALOG.length);
    for (const item of CATALOG) {
      expect(ITEM_KINDS).toContain(item.kind);
      expect(Number.isInteger(item.price_cents)).toBe(true);
      expect(item.price_cents).toBeGreaterThan(0);
      expect(catalogItem(item.sku)).toBe(item);
    }
    expect(catalogItem("points")).toBeUndefined();
  });

  it("sells exactly one thing, through the one Payment Link: the 5-date episode pack", () => {
    expect(ON_SALE.map((i) => [i.sku, i.kind, i.episodes])).toEqual([["pack_5", "episode_pack", 5]]);
    for (const item of ON_SALE) expect(CATALOG).toContain(item);
  });

  it("prices premium house characters between $3 and $8, as the roadmap says", () => {
    for (const item of CHARACTER_ITEMS) {
      expect(item.price_cents).toBeGreaterThanOrEqual(300);
      expect(item.price_cents).toBeLessThanOrEqual(800);
    }
  });

  it("has one premium sheet per character item, each an adult that passes the content filter", () => {
    expect(CHARACTER_ITEMS.map((i) => i.character_id).sort()).toEqual(PREMIUM_HOUSE_CHARACTERS.map((c) => c.id).sort());
    for (const c of PREMIUM_HOUSE_CHARACTERS) {
      expect(c.age).toBeGreaterThanOrEqual(18);
      expect(catalogItem(c.sku)?.character_id).toBe(c.id);
      expect(HOUSE_CHARACTERS.map((h) => h.id)).not.toContain(c.id);
      expect(checkFields({ name: c.name, bio: c.bio, traits: c.traits, want: c.want, dealbreaker: c.dealbreaker })).toEqual({
        ok: true,
      });
    }
  });
});
