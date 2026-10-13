import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postCheckout } from "@/app/api/checkout/route";
import { CATALOG, catalogItem, ITEM_KINDS } from "@/lib/catalog";
import { ensureSchema } from "@/lib/db";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { ownedSkus } from "@/lib/payments";
import { checkFields } from "@/lib/safety";
import {
  api,
  BASE_URL,
  buy,
  episodeJson,
  FAKE_WEBHOOK_SECRET,
  fakeStripe,
  named,
  newUserCookie,
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
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", FAKE_WEBHOOK_SECRET);
});

const CHARACTER_ITEMS = CATALOG.filter((i) => i.kind === "house_character");
const FRAME_ITEMS = CATALOG.filter((i) => i.kind === "frame");

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

describe("buying never changes points or rank (exit criterion)", () => {
  it("buys every SKU and leaves every user's points balance and league rank unchanged", async () => {
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

    // The middle player and the last-placed player each buy every SKU: a change in either direction would show.
    expect(CHARACTER_ITEMS.length).toBeGreaterThanOrEqual(1);
    expect(FRAME_ITEMS.length).toBeGreaterThanOrEqual(1);
    for (const buyer of [kestrel, alder]) {
      for (const item of CATALOG) {
        await buy(item.sku, buyer);
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

describe("POST /api/checkout", () => {
  it("returns a Stripe Checkout url for every SKU and stores a pending order at the catalog price", async () => {
    for (const item of CATALOG) {
      const buyer = newUserCookie();
      const stripe = fakeStripe();
      // Smuggled price, currency and points fields are ignored: the server prices from the catalog.
      const res = await api.checkout(
        { sku: item.sku, attest: true, amount: 1, price_cents: 1, currency: "jpy", points: 1000 },
        buyer,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ url: stripe.sessions[0].url });
      expect(body.url).toMatch(/^https:\/\//);

      const { rows } = await t.db.query("select * from orders where user_id = $1", [userIdOf(buyer)]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sku: item.sku,
        kind: item.kind,
        amount_cents: item.price_cents,
        currency: "usd",
        status: "pending",
        stripe_session_id: stripe.sessions[0].id,
        paid_at: null,
      });

      // Stripe gets our order id, never the user's session cookie.
      expect(stripe.calls).toHaveLength(1);
      const [call] = stripe.calls;
      expect(call.orderId).toBe(rows[0].id);
      expect(call.item.sku).toBe(item.sku);
      expect(call.item.price_cents).toBe(item.price_cents);
      expect(call.successUrl).toBe(`${BASE_URL}/shop?checkout=success`);
      expect(call.cancelUrl).toBe(`${BASE_URL}/shop?checkout=cancelled`);
      expect(JSON.stringify(call)).not.toContain(userIdOf(buyer));
      expect(JSON.stringify(body)).not.toContain(userIdOf(buyer));
    }
  });

  it("sends Stripe back to the site the browser is on (its Origin), even when the server sees another host", async () => {
    // Off Vercel, Next builds req.url from the server's own host:port, not the public one.
    const checkoutFrom = (origin: string | null) => {
      const headers: Record<string, string> = { "content-type": "application/json", cookie: newUserCookie() };
      if (origin !== null) headers.origin = origin;
      return postCheckout(
        new Request("http://localhost:3000/api/checkout", {
          method: "POST",
          headers,
          body: JSON.stringify({ sku: "frame_rose", attest: true }),
        }),
      );
    };
    const stripe = fakeStripe();
    expect((await checkoutFrom("https://botchelor.example")).status).toBe(200);
    expect(stripe.calls[0].successUrl).toBe("https://botchelor.example/shop?checkout=success");
    expect(stripe.calls[0].cancelUrl).toBe("https://botchelor.example/shop?checkout=cancelled");
    // No Origin, or one that isn't an http(s) origin: fall back to the request URL.
    for (const origin of [null, "null", "javascript:alert(1)", "https://botchelor.example/path"]) {
      expect((await checkoutFrom(origin)).status).toBe(200);
      expect(stripe.calls.at(-1)?.successUrl).toBe("http://localhost:3000/shop?checkout=success");
    }
  });

  it("gives a first-time visitor a session cookie, so the order has an owner", async () => {
    fakeStripe();
    const res = await api.checkout({ sku: CATALOG[0].sku, attest: true });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    const userId = /bz_uid=([0-9a-f-]{36})/.exec(cookie)?.[1];
    expect(userId).toBeDefined();
    expect(await t.count("orders", `user_id = '${userId}'`)).toBe(1);
  });

  it.each([
    ["no attestation", { sku: "frame_rose" }],
    ["attest: false", { sku: "frame_rose", attest: false }],
    ["no sku", { attest: true }],
    ["an unknown sku", { sku: "frame_diamond", attest: true }],
  ])("returns 422 for %s, without calling Stripe or storing anything", async (_label, body) => {
    const stripe = fakeStripe();
    const res = await api.checkout(body, newUserCookie());
    expect(res.status).toBe(422);
    expect(stripe.calls).toHaveLength(0);
    expect(await t.count("orders")).toBe(0);
  });

  it("returns 503 payments_unavailable when no Stripe key is configured, storing nothing", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await api.checkout({ sku: CATALOG[0].sku, attest: true }, newUserCookie());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("payments_unavailable");
    expect(await t.count("orders")).toBe(0);
  });

  it("returns 502 when Stripe fails, and leaves no order behind", async () => {
    const stripe = fakeStripe({ fail: true });
    const res = await api.checkout({ sku: CATALOG[0].sku, attest: true }, newUserCookie());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("checkout_unavailable");
    expect(stripe.calls).toHaveLength(1);
    expect(await t.count("orders")).toBe(0);
  });

  it("returns 409 already_owned for an item the user already has, without calling Stripe", async () => {
    const buyer = newUserCookie();
    await buy("frame_gold", buyer);
    const stripe = fakeStripe();
    const res = await api.checkout({ sku: "frame_gold", attest: true }, buyer);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_owned");
    expect(stripe.calls).toHaveLength(0);
    // Someone else can still buy it.
    expect((await api.checkout({ sku: "frame_gold", attest: true }, newUserCookie())).status).toBe(200);
  });

  it("lets a user retry after an abandoned checkout (a pending order is not ownership)", async () => {
    const buyer = newUserCookie();
    fakeStripe();
    expect((await api.checkout({ sku: "frame_rose", attest: true }, buyer)).status).toBe(200);
    expect((await api.checkout({ sku: "frame_rose", attest: true }, buyer)).status).toBe(200);
    expect(await ownedSkus(t.db, userIdOf(buyer))).toEqual([]);
  });
});

describe("premium house characters", () => {
  const premium = PREMIUM_HOUSE_CHARACTERS[0];

  it("returns 402 premium_character_locked to a creator who hasn't bought it, before any model call", async () => {
    const creator = newUserCookie();
    const { res, model } = await dateWith(premium.id, creator);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "premium_character_locked", sku: premium.sku, shop_path: "/shop" });
    expect(model.calls).toHaveLength(0);
    expect(await t.count("episodes")).toBe(0);
  });

  it("dates its owner once bought, as a labeled house character, with its sheet sent to the showrunner", async () => {
    const creator = newUserCookie();
    await buy(premium.sku, creator);
    const { res, model } = await dateWith(premium.id, creator);
    expect(res.status).toBe(200);
    const episode = await res.json();
    expect(episode.characters[1]).toEqual({ id: premium.id, name: premium.name, house: true });
    expect(episode.ai_generated).toBe(true);
    expect(model.calls[0].map((m) => m.content).join("\n")).toContain(premium.bio);
  });

  it("is unlocked per user: another creator is still locked out", async () => {
    await buy(premium.sku, newUserCookie());
    const { res } = await dateWith(premium.id, newUserCookie());
    expect(res.status).toBe(402);
  });

  it("locks again once the order is marked refunded", async () => {
    const creator = newUserCookie();
    await buy(premium.sku, creator);
    await t.db.query("update orders set status = 'refunded' where user_id = $1", [userIdOf(creator)]);
    const { res } = await dateWith(premium.id, creator);
    expect(res.status).toBe(402);
  });

  it("is never picked for a blind date, even when it's the likelier draw", async () => {
    // Leave one free house character against every premium one: if premium were eligible, eight
    // fallbacks in a row would almost surely hit one.
    const [keep, ...drop] = HOUSE_CHARACTERS.map((c) => c.id);
    await t.db.query("delete from characters where id = any($1::text[])", [drop]);
    try {
      const creator = newUserCookie();
      const own = await (await api.createCharacter(validCharacter(), creator)).json();
      for (let i = 0; i < 8; i++) {
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

describe("profile frames", () => {
  it("shows the latest frame bought on league boards, for that member only, without moving anyone", async () => {
    const wren = await named(newUserCookie(), "Wren");
    const kestrel = await named(newUserCookie(), "Kestrel");
    const league = await newLeague(wren, [kestrel]);
    const before = await board(league.id);
    expect(before.every((e) => !("frame" in e))).toBe(true);

    await buy("frame_rose", kestrel);
    let after = await board(league.id);
    expect(after.find((e) => e.name === "Kestrel")?.frame).toBe("frame_rose");
    expect(after.find((e) => e.name === "Wren")).not.toHaveProperty("frame");

    await buy("frame_gold", kestrel);
    after = await board(league.id);
    expect(after.find((e) => e.name === "Kestrel")?.frame).toBe("frame_gold");
    expect(after.map(({ rank, name, points: p }) => ({ rank, name, points: p }))).toEqual(
      before.map(({ rank, name, points: p }) => ({ rank, name, points: p })),
    );
  });

  it("doesn't show a frame from an unpaid (pending) order", async () => {
    const wren = await named(newUserCookie(), "Wren");
    const league = await newLeague(wren, []);
    fakeStripe();
    expect((await api.checkout({ sku: "frame_rose", attest: true }, wren)).status).toBe(200);
    expect((await board(league.id))[0]).not.toHaveProperty("frame");
  });
});

describe("the catalog", () => {
  it("sells only premium house characters and cosmetic frames, each a one-time USD price", () => {
    expect(new Set(CATALOG.map((i) => i.sku)).size).toBe(CATALOG.length);
    for (const item of CATALOG) {
      expect(ITEM_KINDS).toContain(item.kind);
      expect(Number.isInteger(item.price_cents)).toBe(true);
      expect(item.price_cents).toBeGreaterThan(0);
      expect(catalogItem(item.sku)).toBe(item);
    }
    expect(catalogItem("points")).toBeUndefined();
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
