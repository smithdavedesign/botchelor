import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG, ON_SALE } from "@/lib/catalog";
import { api, newUserCookie, openPayments, setupEpisode, startTestDb, validCharacter } from "./helpers";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APP_DIR = join(ROOT, "app");
const LIB_DIR = join(ROOT, "lib");
const SCRIPTS_DIR = join(ROOT, "scripts");
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Anything that would take money or move value between users.
const MONEY_PATH = /pay|checkout|purchase|buy|billing|stripe|invoice|price|wallet|credit|coin|cash|withdraw|redeem|subscri|donat|tip(s)?(\/|$)/i;
const TRANSFER_PATH = /points|transfer|send|gift|redeem|withdraw|balance|award|grant/i;
const PAYMENT_SDK = /from\s+["'](stripe|@stripe\/[^"']+|paypal[^"']*|@paypal\/[^"']+|braintree|square|@lemonsqueezy\/[^"']+|@paddle\/[^"']+)["']/;
// Cash-out: anything that would pay value back out to a user.
const CASH_OUT_PATH = /cash|withdraw|payout|redeem|refund|transfer|exchange|convert/i;
// M3 adds exactly these two money routes (buying a cosmetic or a premium house character), and no others.
const PAYMENT_ROUTES = ["POST /api/checkout", "POST /api/webhooks/stripe"];
// The owner's note (M4): the app pays through a Stripe Payment Link and holds no Stripe API key.
const STRIPE_API = /api\.stripe\.com|STRIPE_SECRET_KEY|checkout\/sessions|checkout\.sessions|sk_(test|live)_/;

type Route = { path: string; file: string; methods: string[] };

async function discoverRoutes(): Promise<Route[]> {
  const files = readdirSync(APP_DIR, { recursive: true, encoding: "utf8" }).filter((f) =>
    /(^|[\\/])route\.(ts|tsx|js|mjs)$/.test(f),
  );
  return Promise.all(
    files.map(async (f) => {
      const file = join(APP_DIR, f);
      const mod: Record<string, unknown> = await import(file);
      return {
        file,
        path: "/" + dirname(f).split(sep).join("/"),
        methods: HTTP_METHODS.filter((m) => typeof mod[m] === "function"),
      };
    }),
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))
    .map((f) => join(dir, f));
}

describe("route listing: no payment or points-transfer endpoint (exit criterion)", () => {
  it("finds the M1 routes, so the checks below are not vacuous", async () => {
    const listed = (await discoverRoutes()).flatMap((r) => r.methods.map((m) => `${m} ${r.path}`));
    expect(listed).toEqual(
      expect.arrayContaining([
        "POST /api/characters",
        "POST /api/episodes",
        "POST /api/episodes/[id]/reveal",
        "POST /api/predictions",
        "GET /api/me",
      ]),
    );
  });

  it("finds the M2 routes, so the checks below also cover them", async () => {
    const listed = (await discoverRoutes()).flatMap((r) => r.methods.map((m) => `${m} ${r.path}`));
    expect(listed).toEqual(
      expect.arrayContaining([
        "GET /api/episodes",
        "GET /api/episodes/[id]",
        "POST /api/reveal",
        "POST /api/reports",
        "POST /api/blocks",
        "DELETE /api/blocks",
        "POST /api/profile",
        "POST /api/leagues",
        "GET /api/leagues/[id]",
        "POST /api/leagues/[id]/join",
      ]),
    );
  });

  it("finds the M3 routes, so the checks below also cover them", async () => {
    const listed = (await discoverRoutes()).flatMap((r) => r.methods.map((m) => `${m} ${r.path}`));
    expect(listed).toEqual(expect.arrayContaining([...PAYMENT_ROUTES, "POST /api/waitlist"]));
  });

  it("serves league boards read-only: no write route under a league except join", async () => {
    for (const route of await discoverRoutes()) {
      if (!route.path.startsWith("/api/leagues/")) continue;
      const writes = route.methods.filter((m) => MUTATING.has(m));
      if (route.path === "/api/leagues/[id]/join") expect(writes).toEqual(["POST"]);
      else expect(writes, route.path).toEqual([]);
    }
  });

  // M1 had "no route whose path takes a payment". M3's roadmap adds Stripe checkout, so the rule is now
  // an exact allowlist: these two method + path pairs, and nothing else that looks like money.
  it("has no payment route except exactly POST /api/checkout and POST /api/webhooks/stripe", async () => {
    const money = (await discoverRoutes())
      .filter((r) => MONEY_PATH.test(r.path))
      .flatMap((r) => r.methods.map((m) => `${m} ${r.path}`));
    expect(money.sort()).toEqual([...PAYMENT_ROUTES].sort());
  });

  it("has no mutating route that moves, grants or transfers points", async () => {
    for (const route of await discoverRoutes()) {
      for (const method of route.methods.filter((m) => MUTATING.has(m))) {
        expect(`${method} ${route.path}`).not.toMatch(TRANSFER_PATH);
      }
    }
  });

  it("serves the points balance read-only", async () => {
    const me = (await discoverRoutes()).find((r) => r.path === "/api/me");
    expect(me?.methods).toEqual(["GET"]);
  });

  it("imports no payment SDK anywhere in the app or lib code", () => {
    for (const file of [...sourceFiles(APP_DIR), ...sourceFiles(LIB_DIR)]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(PAYMENT_SDK);
    }
  });

  // M3 allowed one file (lib/stripe.ts) to call the Stripe API. The owner's Payment Link note removes the
  // API entirely, so now no file may call it, read a Stripe secret key or create Checkout Sessions.
  it("never calls the Stripe API, reads a Stripe secret key or creates Checkout Sessions, anywhere", () => {
    const files = [...sourceFiles(APP_DIR), ...sourceFiles(LIB_DIR), ...sourceFiles(SCRIPTS_DIR)];
    expect(files).toContain(join(LIB_DIR, "stripe.ts"));
    const callers = files.filter((f) => STRIPE_API.test(readFileSync(f, "utf8")));
    expect(callers).toEqual([]);
  });
});

describe("points have no purchase, cash-out or transfer route (M3 exit criterion)", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    openPayments(vi.stubEnv);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("lists no route that mentions points except the read-only GET /api/me", async () => {
    for (const route of await discoverRoutes()) {
      for (const method of route.methods) {
        expect(`${method} ${route.path}`).not.toMatch(/points|score|rank|leaderboard/i);
      }
    }
    const me = (await discoverRoutes()).find((r) => r.path === "/api/me");
    expect(me?.methods).toEqual(["GET"]);
  });

  it("lists no cash-out or transfer route, for points or anything else", async () => {
    for (const route of await discoverRoutes()) {
      for (const method of route.methods) {
        expect(`${method} ${route.path}`).not.toMatch(CASH_OUT_PATH);
        if (MUTATING.has(method)) expect(`${method} ${route.path}`).not.toMatch(TRANSFER_PATH);
      }
    }
  });

  // M3 sold only premium house characters and frames. M4's roadmap adds episode packs, which add
  // episodes (not points), so the kind list grows by exactly that one; the name check is unchanged.
  it("sells nothing but premium house characters, cosmetic frames and episode packs", () => {
    expect(CATALOG.length).toBeGreaterThan(0);
    for (const item of CATALOG) {
      expect(["house_character", "frame", "episode_pack"]).toContain(item.kind);
      expect(`${item.sku} ${item.name}`).not.toMatch(/point|coin|credit|token|gem|boost|rank|bet|odds|score|cash/i);
    }
  });

  it("sells no badge, medal, podium place or season result (M4: badges are earned, never bought)", () => {
    for (const item of CATALOG) {
      expect(`${item.sku} ${item.name} ${item.description}`).not.toMatch(/badge|medal|podium|trophy|winner|place/i);
    }
  });

  it.each(["points", "points_100", "coins", "boost", "rank_up"])(
    "refuses to check out %j (422), without handing out a payment link or storing an order",
    async (sku) => {
      const res = await api.checkout({ sku, attest: true }, newUserCookie());
      expect(res.status).toBe(422);
      expect(await res.text()).not.toContain("buy.stripe.com");
      expect(await t.count("orders")).toBe(0);
    },
  );
});

describe("request bodies cannot smuggle in points or payments", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    openPayments(vi.stubEnv);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("ignores points, amount and recipient fields on every write", async () => {
    const smuggled = { points: 1000, amount: 500, currency: "usd", to_user_id: "someone-else" };
    const user = newUserCookie();
    expect((await api.createCharacter(validCharacter(smuggled), user)).status).toBe(201);

    const { creator, episode } = await setupEpisode("friends");
    expect((await api.predict({ episode_id: episode.id, pick: "disaster", ...smuggled }, user)).status).toBe(201);
    expect((await api.reveal(episode.id, creator)).status).toBe(200);

    expect((await (await api.me(user)).json()).points).toBe(0);
    expect((await (await api.me(creator)).json()).points).toBe(0);
  });

  it("ignores them on the M3 writes too: checkout and the waitlist", async () => {
    const smuggled = { points: 1000, amount: 1, price_cents: 1, currency: "jpy", to_user_id: "someone-else" };
    const user = newUserCookie();
    const [item] = ON_SALE;
    expect((await api.checkout({ sku: item.sku, attest: true, ...smuggled }, user)).status).toBe(200);
    expect(await t.count("orders", `amount_cents = ${item.price_cents} and currency = 'usd'`)).toBe(1);
    expect((await api.joinWaitlist({ email: "a@example.com", attest: true, ...smuggled }, user)).status).toBe(201);
    expect((await (await api.me(user)).json()).points).toBe(0);
  });
});
