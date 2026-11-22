// Where people pay, lifted to the design kit (2026-11-13): /shop as a grid of offer tiles with the price as each headline
// under a meter card, /companion/plan as a price hero with companions' faces and a Free-beside-the-plan table, and
// /agents/pricing as two plan cards under three stat chips (app/ux/money.css). Each page keeps every behaviour the lift
// re-arranged: the buttons, the notices, the notes, the links and the attributes other tests and the e2e scripts look for.
//
// One obvious upgrade (2026-11-21): the shop's tiles are the packs alone, the bigger one first with the page's one loud
// button; the Companion Plan is a line under them and Plus's demand test its small block. /agents/pricing shows the
// operator pass only while it is offered (OPERATOR_PASS_SALE=1 beside its link).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined), has: (name: string) => jar.cookies.has(name), getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import { companionFreePerDay } from "@/lib/companion-plan";
import { COMPANION_EXTRAS, COMPANION_FAIR_USE_PER_MONTH, extraTerms } from "@/lib/companion-shared";
import { agentDailyDateCap } from "@/lib/dating";
import { RESERVED_PER_MONTH } from "@/lib/operator-pass";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { startTestDb } from "./helpers";

/** The page as the server streams it, its text-node markers dropped so words can be matched across them. */
async function render(node: ReactNode): Promise<string> {
  const { prelude } = await prerender(node);
  return (await new Response(prelude).text()).replace(/<!-- -->/g, "");
}

/** A developer's machine, not a deploy: a test-mode Payment Link counts. */
function notDeployed() {
  for (const key of ["VERCEL", "VERCEL_ENV", "DEPLOY_ENV", "AFTER_DARK_ONLY", "STRIPE_PRICE_LABEL", "SESSION_SECRET", "COMPANION_PLAN_PRICE", "OPERATOR_PASS_PRICE_USD"]) vi.stubEnv(key, "");
}

afterEach(() => {
  vi.unstubAllEnvs();
  jar.cookies.clear();
});

describe("/shop: offer tiles under a meter card", () => {
  const openShop = () => {
    notDeployed();
    vi.stubEnv("STRIPE_PAYMENT_LINK", "https://example.com/pay");
    vi.stubEnv("COMPANION_OPEN", "1");
    vi.stubEnv("COMPANION_PLAN_LINK", "https://buy.stripe.com/plan_for_tests");
  };

  it("puts the balance in a meter card, then the pack in a tile with its price as the headline and one button", async () => {
    openShop();
    const { default: ShopPage } = await import("@/app/shop/page");
    const html = await render(await ShopPage({ searchParams: Promise.resolve({}) }));
    // The meter: a visitor with no account has this week's free dates and nothing topped up.
    expect(html).toContain('class="card money-meter token-balance"');
    expect(html).toContain(`<strong>${FREE_EPISODES_PER_SEASON}</strong><span>dates left</span>`);
    // As sent, in UTC; the browser puts it in the viewer's own clock (app/WeeklyTime.tsx; 2026-11-22 audit).
    expect(html).toContain(`${FREE_EPISODES_PER_SEASON} of ${FREE_EPISODES_PER_SEASON} free this week. Free dates come back Monday at 00:00 UTC.`);
    expect(html.indexOf("money-meter")).toBeLessThan(html.indexOf("money-tile"));
    // One tile: the pack, led by its price. The Companion Plan and Plus's demand test (not for sale) come after the
    // tiles, a line and a small block, so neither reads as an offer beside the pack.
    expect(html.match(/class="card money-tile shop-item[^"]*"/g)).toHaveLength(1);
    expect(html).toContain('<p class="money-price"><span class="money-price-amount">$4</span><span class="money-price-per">once</span></p>');
    expect(html.match(/class="money-price"/g)).toHaveLength(1);
    const after = html.slice(html.indexOf("</ul>", html.indexOf('class="money-tiles"')));
    expect(after).toMatch(
      /<p class="shop-also muted" data-shop-plan="companion">Talk with any companion as much as you like: <a[^>]*href="\/companion\/plan"[^>]*>the Companion Plan<\/a>, \$9\.99 a month\. Cancel any time\.<\/p>/,
    );
    expect(after).toMatch(/<div class="shop-also shop-plus" data-shop-plus="true"><div class="plus-tile is-compact" data-plus-interest="shop">/);
    expect(html).not.toContain("plan-face");
    // Buy as before: the attestation box and the labelled button, the small print folded, the points rule in the open.
    // The only pack on sale is the one the page leads with, so its button is the loud one.
    expect(html).toMatch(/<button type="submit">Buy 5 more dates for \$4<\/button>/);
    expect(html).toContain('name="attest"');
    expect(html).not.toContain("Purchases open soon");
    expect(html).not.toContain("data-ad-tokens-note");
    expect(html).toContain('class="ux-fold shop-small-print"');
    expect(html).toContain("Nothing here changes points, picks, badges or rank");
    expect(html).toContain('href="/terms"');
    expect(html).toContain("<h1>More dates</h1>");
  });

  it("leads with the bigger pack once it's on sale: first, with the one loud button, the other pack's outlined", async () => {
    openShop();
    vi.stubEnv("STRIPE_LINK_PACK_15", "https://example.com/pay-15");
    const { default: ShopPage } = await import("@/app/shop/page");
    const html = await render(await ShopPage({ searchParams: Promise.resolve({}) }));
    expect([...html.matchAll(/data-shop-sku="([a-z0-9_]+)"/g)].map((m) => m[1])).toEqual(["pack_15", "pack_5"]);
    expect(html.match(/class="card money-tile shop-item[^"]*"/g)).toHaveLength(2);
    expect(html.match(/<span class="badge">Best value<\/span>/g)).toHaveLength(1);
    expect(html.match(/<button[^>]*>Buy [^<]+<\/button>/g)).toEqual([
      '<button type="submit">Buy 15 more dates for $10</button>',
      '<button type="submit" class="secondary">Buy 5 more dates for $4</button>',
    ]);
    // Signed out, the same: the price is still each button, and only the bigger pack's is loud.
    vi.stubEnv("SESSION_SECRET", ["money", "pages", "test", "secret", "0123456789abcdef"].join("-"));
    const signedOut = await render(await ShopPage({ searchParams: Promise.resolve({}) }));
    expect(signedOut.match(/<button[^>]*>Buy [^<]+<\/button>/g)).toEqual([
      '<button type="button">Buy 15 more dates · $10</button>',
      '<button type="button" class="secondary">Buy 5 more dates · $4</button>',
    ]);
  });

  it("keeps the notices: purchases open soon while no link is set (Buy shown but off), thanks back from checkout", async () => {
    openShop();
    vi.stubEnv("STRIPE_PAYMENT_LINK", "");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PAYMENT_LINK", "");
    const { default: ShopPage } = await import("@/app/shop/page");
    const html = await render(await ShopPage({ searchParams: Promise.resolve({ checkout: "success" }) }));
    expect(html).toContain("Purchases open soon. Everything else on Botchelor is free.");
    expect(html).toContain("Thanks! Your dates are added as soon as Stripe confirms the payment");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("asks a visitor without an account to sign in to buy, the price still the button", async () => {
    openShop();
    vi.stubEnv("SESSION_SECRET", ["money", "pages", "test", "secret", "0123456789abcdef"].join("-"));
    const { default: ShopPage } = await import("@/app/shop/page");
    const html = await render(await ShopPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Buy 5 more dates · $4");
    expect(html).toContain("Buying needs an account, so what you buy follows you to any device.");
    expect(html).not.toContain('name="attest"');
  });
});

describe("/companion/plan: the price over the faces, Free beside the plan", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  }, 60_000);
  afterAll(async () => {
    await t.close();
  });
  const openPlan = () => {
    notDeployed();
    vi.stubEnv("COMPANION_OPEN", "1");
    vi.stubEnv("COMPANION_PLAN_LINK", "https://buy.stripe.com/plan_for_tests");
    vi.stubEnv("DEEPGRAM_API_KEY", "");
  };

  it("leads with the price, shows up to eight companions' faces, and compares Free with the plan row by row", async () => {
    openPlan();
    const { default: PlanPage } = await import("@/app/companion/plan/page");
    const html = await render(await PlanPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('<header class="money-hero">');
    expect(html).toContain('<p class="money-price"><span class="money-price-amount">$9.99</span><span class="money-price-per">a month</span></p>');
    // The house cast is in every test database: faces at 44px, eight at most, and the way to all of them.
    const faces = html.match(/<li class="money-face">/g) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.length).toBeLessThanOrEqual(8);
    expect(html).toContain('width="44"');
    expect(html).toMatch(/\d+ companions to talk with\. <a href="\/companion">Meet them<\/a>\./);
    // The comparison: Free and the plan as columns, the numbers from the code.
    expect(html).toContain('<table class="money-compare">');
    expect(html).toContain('<th scope="col">Free</th><th scope="col" class="is-plan">Companion Plan</th>');
    expect(html).toContain(`<th scope="row">Replies a day</th><td>${companionFreePerDay()} a day across every companion</td>`);
    expect(html).toContain(`No daily limit<small>fair use: ${COMPANION_FAIR_USE_PER_MONTH.toLocaleString("en-US")} a month</small>`);
    expect(html).toContain(`<td>One date from a pack buys ${COMPANION_EXTRAS.voice.bundle}</td>`);
    expect(html).toContain(`${COMPANION_EXTRAS.voice.included} a month included<small>after that, one date from a pack buys ${COMPANION_EXTRAS.voice.bundle}</small>`);
    expect(html).not.toContain("Live calls");
    expect(html.match(/class="money-yes"/g)).toHaveLength(6);
    expect(html).toContain("Their memory of you");
    expect(html).toContain("Another reply whenever you like");
    expect(html).toContain("How much they say");
    expect(html).toContain('href="/terms#companion-extras"');
    // Subscribe as before: sign in first, the renewal sentence in full (the e2e looks for it), the plan's terms.
    expect(html).toContain('id="plan-buy"');
    expect(html).toContain('href="/account?next=%2Fcompanion%2Fplan"');
    expect(html).toContain("$9.99 a month, charged now and every month after until you cancel");
    expect(html).toContain('href="/terms#companion-plan"');
    expect(html.indexOf("Sign in to subscribe")).toBeLessThan(html.indexOf("charged now and every month"));
  });

  it("adds the live-calls row only when live calls are on", async () => {
    openPlan();
    vi.stubEnv("DEEPGRAM_API_KEY", "dg_test_key");
    vi.stubEnv("COMPANION_LIVE", "");
    const { default: PlanPage } = await import("@/app/companion/plan/page");
    const html = await render(await PlanPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Live calls");
    expect(html).toContain(`${extraTerms("minute").included} minutes a month`);
    expect(html).toContain(`one date from a pack buys ${extraTerms("minute").bundle} minutes`);
    expect(html).toContain("<td>Calls that take turns are free</td>");
  });

  it("says it isn't open yet while companions are closed, rather than a 404 (mobile audit C21)", async () => {
    notDeployed();
    vi.stubEnv("COMPANION_OPEN", "");
    const { default: PlanPage } = await import("@/app/companion/plan/page");
    const html = await render(await PlanPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("data-not-open-yet");
    expect(html).toContain("<h1>The Companion Plan</h1>");
    expect(html).not.toContain("Subscribe");
  });
});

describe("/agents/pricing: stat chips over what's free, and the operator pass only while it's offered", () => {
  it("leaves the pass out while it isn't offered, even with its link set: two chips, the free card, nothing to buy", async () => {
    notDeployed();
    vi.stubEnv("OPERATOR_PASS_LINK", "https://buy.stripe.com/test_pass");
    vi.stubEnv("OPERATOR_PASS_SALE", "");
    const { default: PricingPage, generateMetadata } = await import("@/app/agents/pricing/page");
    const html = await render(PricingPage());
    const chips = [...html.matchAll(/<li class="money-stat"><strong>(\d+)<\/strong>/g)].map((m) => Number(m[1]));
    expect(chips).toEqual([3, agentDailyDateCap()]);
    expect(html.match(/class="card money-plan/g)).toHaveLength(1);
    expect(html).toContain("<h2>Free, always</h2>");
    expect(html).toContain("<code>start_own_date</code>");
    expect(html).not.toMatch(/operator pass/i);
    expect(html).not.toContain("Coming soon");
    expect(html).not.toContain("buy.stripe.com");
    expect(html).not.toContain("client_reference_id");
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="/shop"');
    const meta = JSON.stringify(await generateMetadata());
    expect(meta).toContain("Pricing for agents");
    expect(meta).not.toMatch(/operator pass/i);
  });

  it("with OPERATOR_PASS_SALE=1 beside the link, prices the pass as its headline, the link as a button, the reference note under it", async () => {
    notDeployed();
    vi.stubEnv("OPERATOR_PASS_LINK", "https://buy.stripe.com/test_pass");
    vi.stubEnv("OPERATOR_PASS_SALE", "1");
    const { default: PricingPage, generateMetadata } = await import("@/app/agents/pricing/page");
    const html = await render(PricingPage());
    const chips = [...html.matchAll(/<li class="money-stat"><strong>(\d+)<\/strong>/g)].map((m) => Number(m[1]));
    expect(chips).toEqual([3, agentDailyDateCap(), RESERVED_PER_MONTH]);
    expect(html.match(/class="card money-plan/g)).toHaveLength(2);
    expect(html).toContain("<h2>Free, always</h2>");
    expect(html.match(/class="money-checklist"/g)).toHaveLength(2);
    expect(html).toContain("<code>start_own_date</code>");
    expect(html).toContain('<h2>Operator pass</h2><p class="money-price"><span class="money-price-amount">$9</span><span class="money-price-per">a month</span></p>');
    expect(html).toContain(`<strong>${RESERVED_PER_MONTH} reserved show-model dates a month.</strong>`);
    expect(html).toContain('<a class="button" href="https://buy.stripe.com/test_pass" rel="nofollow">Get the operator pass</a><small class="muted">At checkout, set <code>client_reference_id</code>');
    expect(html).not.toContain("Coming soon");
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="/shop"');
    expect(JSON.stringify(await generateMetadata())).toContain("Operator pass");
  });

  it("never offers the pass on the switch alone: no link, nothing to buy", async () => {
    notDeployed();
    for (const key of ["OPERATOR_PASS_LINK", "NEXT_PUBLIC_OPERATOR_PASS_LINK"]) vi.stubEnv(key, "");
    vi.stubEnv("OPERATOR_PASS_SALE", "1");
    vi.stubEnv("OPERATOR_PASS_ENABLED", "1");
    const { default: PricingPage } = await import("@/app/agents/pricing/page");
    const html = await render(PricingPage());
    expect(html.match(/class="card money-plan/g)).toHaveLength(1);
    expect(html).not.toMatch(/operator pass/i);
  });
});
