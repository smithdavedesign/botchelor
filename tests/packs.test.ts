import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { episodeAllowance, releaseEpisode, reserveEpisode } from "@/lib/allowance";
import { CATALOG, catalogItem, ON_SALE, type CatalogItem } from "@/lib/catalog";
import { listMyCharacters } from "@/lib/game";
import { setModelForTests } from "@/lib/model";
import { refundOrder } from "@/lib/payments";
import { FREE_EPISODES_PER_SEASON as FREE } from "@/lib/rules";
import { seasonAt } from "@/lib/seasons";
import {
  api,
  buy,
  episodeJson,
  FAKE_PAYMENT_LINK,
  FAKE_PAYMENT_LINK_ID,
  grantByHand,
  HOUSE_PARTNER_ID,
  named,
  newUserCookie,
  openPayments,
  OTHER_WEBHOOK_SECRET,
  scriptedModel,
  setupEpisode,
  setupPairedEpisode,
  startCheckout,
  startTestDb,
  stripeSignature,
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

const PACKS = ON_SALE.filter((i) => i.kind === "episode_pack");
const PACK = catalogItem("pack_5")!;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Creator = { cookie: string; characterId: string };

async function newCreator(): Promise<Creator> {
  const cookie = newUserCookie();
  const res = await api.createCharacter(validCharacter(), cookie);
  expect(res.status).toBe(201);
  return { cookie, characterId: (await res.json()).id };
}

const dateRequest = (creator: Creator, blind = false) =>
  api.createEpisode(
    blind ? { character_id: creator.characterId, blind: true } : { character_id: creator.characterId, partner_id: HOUSE_PARTNER_ID },
    creator.cookie,
  );

/** Asks for `n` dates (house partner unless `blind`), each with a valid scripted episode; returns the statuses. */
async function sendOnDates(creator: Creator, n: number, blind = false): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) {
    scriptedModel([episodeJson()]);
    statuses.push((await dateRequest(creator, blind)).status);
  }
  return statuses;
}

/** Sends dates until one is refused; returns how many went through and the refusal. */
async function spendUntilRefused(creator: Creator, cap = 200) {
  for (let made = 0; made < cap; made++) {
    scriptedModel([episodeJson()]);
    const res = await dateRequest(creator);
    if (res.status !== 200) return { made, refused: res };
  }
  throw new Error(`still accepting dates after ${cap}`);
}

const allowanceOf = (cookie: string, now?: Date) => episodeAllowance(t.db, userIdOf(cookie), now);
const episodesBy = (cookie: string) => t.count("episodes", `creator_id = '${userIdOf(cookie)}'`);

describe("episode packs add episodes, not points (exit criterion)", () => {
  it("has a pack on sale to test", () => {
    expect(PACKS.length).toBeGreaterThanOrEqual(1);
  });

  it.each(PACKS.map((p): [string, CatalogItem] => [p.sku, p]))(
    "buying %s through the Payment Link adds exactly its N episodes to the creator and changes no spectator's score",
    async (_sku, pack) => {
      const n = pack.episodes!;
      // Three spectators on a league board with 20, 10 and 0 points.
      const wren = await named(newUserCookie(), "Wren");
      const kestrel = await named(newUserCookie(), "Kestrel");
      const alder = await named(newUserCookie(), "Alder");
      const league = (await (await api.createLeague({ name: "Rooftop Regulars" }, kestrel)).json()).id;
      for (const member of [wren, alder]) expect((await api.joinLeague(league, member)).status).toBe(201);
      const a = await setupEpisode("friends");
      const b = await setupEpisode("disaster");
      for (const [cookie, pickA, pickB] of [
        [wren, "friends", "disaster"],
        [kestrel, "friends", "second_date"],
        [alder, "disaster", "friends"],
      ]) {
        expect((await api.predict({ episode_id: a.episode.id, pick: pickA }, cookie)).status).toBe(201);
        expect((await api.predict({ episode_id: b.episode.id, pick: pickB }, cookie)).status).toBe(201);
      }
      expect((await api.reveal(a.episode.id, a.creator)).status).toBe(200);
      expect((await api.reveal(b.episode.id, b.creator)).status).toBe(200);

      const creator = await newCreator();
      const everyone = [wren, kestrel, alder, creator.cookie, a.creator, b.creator];
      const scores = async () => ({
        points: await Promise.all(everyone.map(async (c) => (await (await api.me(c)).json()).points)),
        board: (await (await api.getLeague(league)).json()).leaderboard.map(
          ({ rank, name, points }: { rank: number; name: string; points: number }) => ({ rank, name, points }),
        ),
      });
      const before = await scores();
      expect(before.points.slice(0, 3)).toEqual([20, 10, 0]);
      expect(before.board).toEqual([
        { rank: 1, name: "Wren", points: 20 },
        { rank: 2, name: "Kestrel", points: 10 },
        { rank: 3, name: "Alder", points: 0 },
      ]);

      // The creator has used all but one of this week's free dates.
      const used = FREE - 1;
      expect(await sendOnDates(creator, used)).toEqual(Array(used).fill(200));
      const unbought = await allowanceOf(creator.cookie);
      expect(unbought).toMatchObject({ free_left: 1, pack_left: 0, left: 1 });

      // The shop's Buy button: a pending order, and the owner's Payment Link carrying its id.
      const { orderId, url, paidEvent } = await startCheckout(pack.sku, creator.cookie);
      expect(url).toBe(`${FAKE_PAYMENT_LINK}?client_reference_id=${orderId}`);
      expect(await allowanceOf(creator.cookie)).toEqual(unbought); // nothing until Stripe says it's paid
      // The buyer pays on Stripe; Stripe sends the signed checkout.session.completed for that link.
      const payload = paidEvent({ payment_link: FAKE_PAYMENT_LINK_ID });
      expect((await api.stripeWebhook(payload, await stripeSignature(payload))).status).toBe(200);

      const bought = await allowanceOf(creator.cookie);
      expect(bought.left - unbought.left).toBe(n);
      expect(bought).toMatchObject({ free_left: 1, pack_left: n, left: 1 + n });
      expect(await scores()).toEqual(before);

      // They are real dates: exactly that many more go through, then the next is refused.
      const { made, refused } = await spendUntilRefused(creator);
      expect(made).toBe(1 + n);
      expect(refused.status).toBe(429);
      expect(await episodesBy(creator.cookie)).toBe(FREE + n);
      expect(await allowanceOf(creator.cookie)).toMatchObject({ free_left: 0, pack_left: 0, left: 0 });
      expect(await scores()).toEqual(before);
    },
  );
});

describe("the weekly free allowance", () => {
  it(`gives each creator ${FREE} free dates a season, then refuses the next with 429 before any model call`, async () => {
    const creator = await newCreator();
    expect(await sendOnDates(creator, FREE)).toEqual(Array(FREE).fill(200));

    const model = scriptedModel([episodeJson()]);
    const res = await dateRequest(creator);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      error: "episode_limit_reached",
      resets_at: seasonAt(new Date()).ends_at,
      shop_path: "/shop",
    });
    expect(model.calls).toHaveLength(0);
    expect(await t.count("episodes")).toBe(FREE);

    // Another creator still has a full week.
    const other = await newCreator();
    expect(await sendOnDates(other, 1)).toEqual([200]);
  });

  it("counts blind dates too", async () => {
    const creator = await newCreator();
    expect(await sendOnDates(creator, FREE, true)).toEqual(Array(FREE).fill(200));
    expect((await dateRequest(creator)).status).toBe(429);
  });

  it("doesn't spend a date when the showrunner fails (502)", async () => {
    const creator = await newCreator();
    await sendOnDates(creator, FREE - 1);
    scriptedModel(["not json", "still not json"]);
    expect((await dateRequest(creator)).status).toBe(502);
    expect(await allowanceOf(creator.cookie)).toMatchObject({ free_left: 1 });
    expect(await sendOnDates(creator, 2)).toEqual([200, 429]);
  });

  it("doesn't spend a date when the match is gone by the time the episode is written (409)", async () => {
    const { host, partner, episode, hostCharacter } = await setupPairedEpisode();
    setModelForTests({
      async complete() {
        expect((await api.block(episode.id, partner)).status).toBe(201); // lands mid-generation
        return episodeJson();
      },
    });
    const res = await api.createEpisode({ character_id: hostCharacter.id, blind: true }, host);
    expect(res.status).toBe(409);
    expect(await allowanceOf(host)).toMatchObject({ free_left: FREE - 1 }); // only the setup date was spent
  });

  it("gives the date back when saving fails unexpectedly (500)", async () => {
    const creator = await newCreator();
    setModelForTests({
      async complete() {
        // The character disappears mid-generation, so the episode insert fails its foreign key.
        await t.db.query("delete from characters where id = $1", [creator.characterId]);
        return episodeJson();
      },
    });
    expect((await dateRequest(creator)).status).toBe(500);
    expect(await t.count("episodes")).toBe(0);
    expect(await allowanceOf(creator.cookie)).toMatchObject({ free_left: FREE });
  });

  it("doesn't reserve a date for requests refused before the model call (404, 422, 402)", async () => {
    const creator = await newCreator();
    const model = scriptedModel([]);
    expect((await api.createEpisode({ character_id: "nope", partner_id: HOUSE_PARTNER_ID }, creator.cookie)).status).toBe(404);
    expect((await api.createEpisode({ character_id: creator.characterId, partner_id: "nope" }, creator.cookie)).status).toBe(422);
    expect((await api.createEpisode({ character_id: creator.characterId, partner_id: "house-vesper" }, creator.cookie)).status).toBe(402);
    expect(model.calls).toHaveLength(0);
    expect(await allowanceOf(creator.cookie)).toMatchObject({ free_left: FREE, left: FREE });
    expect(await t.count("free_episode_usage")).toBe(0);
  });

  it("starts a visitor with no session on a full week and no pack dates", async () => {
    expect(await episodeAllowance(t.db, null)).toEqual({
      season_id: seasonAt(new Date()).id,
      resets_at: seasonAt(new Date()).ends_at,
      free_per_season: FREE,
      free_left: FREE,
      pack_left: 0,
      left: FREE,
    });
  });
});

describe("reserving dates across seasons", () => {
  it("resets the free dates when the next season starts, and carries pack dates over, spending free ones first", async () => {
    const cookie = newUserCookie();
    const user = userIdOf(cookie);
    const now = new Date();
    const thisWeek = seasonAt(now);
    const nextWeek = seasonAt(new Date(now.getTime() + WEEK_MS));

    for (let i = 0; i < FREE; i++) expect(await reserveEpisode(t.db, user, now)).toEqual({ source: "free", season_id: thisWeek.id });
    expect(await reserveEpisode(t.db, user, now)).toBeNull();

    await buy(PACK.sku, cookie);
    expect(await reserveEpisode(t.db, user, now)).toEqual({ source: "pack" });
    expect(await episodeAllowance(t.db, user, now)).toMatchObject({ free_left: 0, pack_left: 4 });

    // Next week: the free dates again, and the 4 pack dates are still there, untouched until the free ones run out.
    const later = new Date(nextWeek.starts_at);
    expect(await episodeAllowance(t.db, user, later)).toMatchObject({
      season_id: nextWeek.id,
      resets_at: nextWeek.ends_at,
      free_left: FREE,
      pack_left: 4,
      left: FREE + 4,
    });
    expect(await reserveEpisode(t.db, user, later)).toEqual({ source: "free", season_id: nextWeek.id });
    expect(await episodeAllowance(t.db, user, later)).toMatchObject({ free_left: FREE - 1, pack_left: 4 });
  });

  it("gives back exactly the date it reserved", async () => {
    const cookie = newUserCookie();
    const user = userIdOf(cookie);
    await buy(PACK.sku, cookie);
    const free = await reserveEpisode(t.db, user);
    await releaseEpisode(t.db, user, free!);
    expect(await episodeAllowance(t.db, user)).toMatchObject({ free_left: FREE, pack_left: 5 });

    for (let i = 0; i < FREE; i++) await reserveEpisode(t.db, user);
    const pack = await reserveEpisode(t.db, user);
    expect(pack).toEqual({ source: "pack" });
    expect(await episodeAllowance(t.db, user)).toMatchObject({ free_left: 0, pack_left: 4 });
    await releaseEpisode(t.db, user, pack!);
    expect(await episodeAllowance(t.db, user)).toMatchObject({ free_left: 0, pack_left: 5 });
    // Releasing more than was reserved never goes below zero.
    await releaseEpisode(t.db, user, pack!);
    expect(await episodeAllowance(t.db, user)).toMatchObject({ pack_left: 5 });
  });

  it("gives a date back to the season it was taken from, even after that season has ended", async () => {
    const user = userIdOf(newUserCookie());
    const lastMs = new Date(seasonAt(new Date()).starts_at).getTime() - 1; // last millisecond of last week
    const reservation = await reserveEpisode(t.db, user, new Date(lastMs));
    expect(reservation).toEqual({ source: "free", season_id: seasonAt(new Date(lastMs)).id });
    expect(await episodeAllowance(t.db, user, new Date(lastMs))).toMatchObject({ free_left: FREE - 1 });
    await releaseEpisode(t.db, user, reservation!); // released now, in the new week
    expect(await episodeAllowance(t.db, user, new Date(lastMs))).toMatchObject({ free_left: FREE });
    expect(await episodeAllowance(t.db, user)).toMatchObject({ free_left: FREE });
  });

  it("never lets parallel reservations past the limit", async () => {
    const cookie = newUserCookie();
    const user = userIdOf(cookie);
    await buy(PACK.sku, cookie);
    await buy(PACK.sku, cookie);
    const results = await Promise.all(Array.from({ length: FREE + 15 }, () => reserveEpisode(t.db, user)));
    expect(results.filter((r) => r?.source === "free")).toHaveLength(FREE);
    expect(results.filter((r) => r?.source === "pack")).toHaveLength(10);
    expect(results.filter((r) => r === null)).toHaveLength(5);
  });
});

describe("sending an existing character on another date", () => {
  it("lists only the creator's own characters, newest first, and each can date again until the dates run out", async () => {
    const creator = await newCreator();
    const second = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), creator.cookie)).json();
    await newCreator(); // someone else's character never shows up
    await t.db.query("update characters set created_at = now() - interval '1 hour' where id = $1", [creator.characterId]);

    expect(await listMyCharacters(t.db, userIdOf(creator.cookie))).toEqual([
      { id: second.id, name: "Otto Fenn", house: false },
      { id: creator.characterId, name: "Mira Quell", house: false },
    ]);
    expect(await listMyCharacters(t.db, userIdOf(newUserCookie()))).toEqual([]);

    // The same character goes on date after date; each one spends a date.
    expect(await sendOnDates(creator, 3)).toEqual([200, 200, 200]);
    expect(await allowanceOf(creator.cookie)).toMatchObject({ free_left: FREE - 3 });
  });
});

describe("buying episode packs", () => {
  // The roadmap said packs cost $5–$10. REVENUE.md, written later about getting the first dollar, sets the
  // one pack at "5 more dates, $4", the price of the Payment Link David was asked to make. It stays inside
  // the $3–$8 every other paid item already used.
  it("sells one pack, 5 dates for a $4 list price, and gives no other item an episode count", () => {
    expect(PACKS).toEqual([PACK]);
    expect(PACK).toMatchObject({ sku: "pack_5", kind: "episode_pack", episodes: 5, price_cents: 400 });
    expect(PACK.character_id).toBeUndefined();
    for (const item of CATALOG.filter((i) => i.kind !== "episode_pack")) expect(item.episodes).toBeUndefined();
    for (const item of CATALOG) {
      expect(item.price_cents).toBeGreaterThanOrEqual(200);
      expect(item.price_cents).toBeLessThanOrEqual(800);
    }
  });

  it("stores the catalog's episode count on the order, ignoring a smuggled one", async () => {
    const buyer = newUserCookie();
    const res = await api.checkout({ sku: PACK.sku, attest: true, episodes: 1000, points: 1000 }, buyer);
    expect(res.status).toBe(200);
    const { rows } = await t.db.query("select sku, kind, episodes, amount_cents, status from orders where user_id = $1", [
      userIdOf(buyer),
    ]);
    expect(rows).toEqual([{ sku: "pack_5", kind: "episode_pack", episodes: 5, amount_cents: 400, status: "pending" }]);
  });

  it("stacks repeat purchases of the pack (no 409)", async () => {
    const buyer = newUserCookie();
    await buy(PACK.sku, buyer);
    await buy(PACK.sku, buyer);
    await buy(PACK.sku, buyer);
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 15, left: FREE + 15 });
    expect(await t.count("orders", "status = 'paid'")).toBe(3);
  });

  it("adds nothing for an unpaid checkout or a webhook with a bad signature", async () => {
    const buyer = newUserCookie();
    const { paidEvent } = await startCheckout(PACK.sku, buyer);
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 0 });
    const payload = paidEvent();
    expect((await api.stripeWebhook(payload, await stripeSignature(payload, OTHER_WEBHOOK_SECRET))).status).toBe(400);
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 0, left: FREE });
    // The correctly signed delivery adds the pack.
    expect((await api.stripeWebhook(payload, await stripeSignature(payload))).status).toBe(200);
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 5 });
  });

  it("refunds a used pack so that buying one again still adds exactly its N dates (refundOrder)", async () => {
    const buyer = newUserCookie();
    const user = userIdOf(buyer);
    const orderId = await buy(PACK.sku, buyer);
    for (let i = 0; i < FREE + 2; i++) await reserveEpisode(t.db, user);
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 3 });

    expect(await refundOrder(t.db, orderId)).toBe(true);
    expect(await refundOrder(t.db, orderId)).toBe(false); // already refunded: nothing more happens
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 0, left: 0 });

    await buy(PACK.sku, buyer);
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 5, left: 5 });
  });

  it("keeps the dates of the packs that weren't refunded", async () => {
    const buyer = newUserCookie();
    const user = userIdOf(buyer);
    await buy(PACK.sku, buyer);
    const second = await buy(PACK.sku, buyer);
    for (let i = 0; i < FREE + 7; i++) await reserveEpisode(t.db, user);
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 3 });
    expect(await refundOrder(t.db, second)).toBe(true);
    // 7 used, 5 still paid for: the used count is capped at 5, so nothing is left and nothing is owed.
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 0 });
    await buy(PACK.sku, buyer);
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 5 });
  });

  it("refunds a frame or a premium character without touching anyone's dates", async () => {
    const buyer = newUserCookie();
    const user = userIdOf(buyer);
    await buy(PACK.sku, buyer);
    const frame = await grantByHand(t.db, buyer, "frame_rose");
    for (let i = 0; i < FREE + 2; i++) await reserveEpisode(t.db, user);
    expect(await refundOrder(t.db, frame)).toBe(true);
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 3 });
    expect(await t.count("orders", `id = '${frame}' and status = 'refunded'`)).toBe(1);
  });

  it("stops counting a refunded pack's dates, and never shows fewer than zero left", async () => {
    const buyer = newUserCookie();
    const user = userIdOf(buyer);
    await buy(PACK.sku, buyer);
    for (let i = 0; i < FREE + 2; i++) await reserveEpisode(t.db, user);
    expect(await allowanceOf(buyer)).toMatchObject({ pack_left: 3 });
    await t.db.query("update orders set status = 'refunded' where user_id = $1", [user]);
    expect(await allowanceOf(buyer)).toMatchObject({ free_left: 0, pack_left: 0, left: 0 });
    expect(await reserveEpisode(t.db, user)).toBeNull();
  });
});
