// Where people pay, lifted to the design kit (2026-11-13): /shop as a grid of offer tiles with the price as each headline
// under a meter card, /companion/plan as a price hero with companions' faces and a Free-beside-the-plan table, and
// /agents/pricing as two plan cards under three stat chips (app/ux/money.css). Each page keeps every behaviour the lift
// re-arranged: the buttons, the notices, the notes, the links and the attributes other tests and the e2e scripts look for.
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

  it("puts the balance in a meter card, then each offer in a tile with its price as the headline and one button", async () => {
    openShop();
    const { default: ShopPage } = await import("@/app/shop/page");
    const html = await render(await ShopPage({ searchParams: Promise.resolve({}) }));
    // The meter: a visitor with no account has this week's free dates and nothing topped up.
    expect(html).toContain('class="card money-meter token-balance"');
    expect(html).toContain(`<strong>${FREE_EPISODES_PER_SEASON}</strong><span>dates left</span>`);
    expect(html).toContain(`${FREE_EPISODES_PER_SEASON} of ${FREE_EPISODES_PER_SEASON} free this week. Free dates come back Monday 00:00 UTC.`);
    expect(html.indexOf("money-meter")).toBeLessThan(html.indexOf("money-tile"));
    // Two tiles: the pack and the Companion Plan, each led by its price.
    expect(html.match(/class="card money-tile shop-item[^"]*"/g)).toHaveLength(2);
    expect(html).toContain('<p class="money-price"><span class="money-price-amount">$4</span><span class="money-price-per">once</span></p>');
    expect(html).toContain('<p class="money-price"><span class="money-price-amount">$9.99</span><span class="money-price-per">a month</span></p>');
    expect(html).toContain('data-shop-plan="companion"');
    expect(html).toContain('href="/companion/plan"');
    // Buy as before: the attestation box and the labelled button, the small print folded, the points rule in the open.
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Buy 5 more dates for \$4<\/button>/);
    expect(html).toContain('name="attest"');
    expect(html).not.toContain("Purchases open soon");
    expect(html).not.toContain("data-ad-tokens-note");
    expect(html).toContain('class="ux-fold shop-small-print"');
    expect(html).toContain("Nothing here changes points, picks, badges or rank");
    expect(html).toContain('href="/terms"');
    expect(html).toContain("<h1>More dates</h1>");
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
    expect(html).toContain(`<td>A token buys ${COMPANION_EXTRAS.voice.bundle}</td>`);
    expect(html).toContain(`${COMPANION_EXTRAS.voice.included} a month included<small>after that, a token buys ${COMPANION_EXTRAS.voice.bundle}</small>`);
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
    expect(html).toContain(`a token buys ${extraTerms("minute").bundle} minutes`);
    expect(html).toContain("<td>Calls that take turns are free</td>");
  });

  it("is still not found while companions are closed", async () => {
    notDeployed();
    vi.stubEnv("COMPANION_OPEN", "");
    const { default: PlanPage } = await import("@/app/companion/plan/page");
    await expect(PlanPage({ searchParams: Promise.resolve({}) })).rejects.toThrow();
  });
});

describe("/agents/pricing: three stat chips, two plan cards", () => {
  it("prices the pass as its headline, with the link as a button and the reference note under it", async () => {
    notDeployed();
    vi.stubEnv("OPERATOR_PASS_LINK", "https://buy.stripe.com/test_pass");
    const { default: PricingPage } = await import("@/app/agents/pricing/page");
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
  });

  it("says Coming soon in the pass card while the pass can't be bought", async () => {
    notDeployed();
    for (const key of ["OPERATOR_PASS_LINK", "NEXT_PUBLIC_OPERATOR_PASS_LINK", "OPERATOR_PASS_ENABLED"]) vi.stubEnv(key, "");
    const { default: PricingPage } = await import("@/app/agents/pricing/page");
    const html = await render(PricingPage());
    expect(html).toContain("Coming soon.");
    expect(html).toContain("<code>send_feedback</code>");
    expect(html).not.toContain("client_reference_id");
    expect(html).toContain("<h2>Operator pass</h2>");
  });
});
