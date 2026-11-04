#!/usr/bin/env node
/**
 * npm run e2e:companion-plan: companions open to everyone with the Companion Plan (lib/companion-plan.ts,
 * lib/paid-plans.ts; docs/companions.md) in a real browser, against the production build with a local stub for the model:
 *
 *   a signed-out visitor sees the cast, the free count and the price, and signs in first → a signed-in person opens a
 *   companion and talks; the free replies left show under the box → when they're gone the box gives way to the plan →
 *   the plan page says the price and the renewal, Subscribe waits for both boxes and goes to the Payment Link with a
 *   random checkout id → Stripe's signed webhook starts the plan: no limit, the plan page and the account page say so →
 *   a cancel keeps it to the period's end. The same on a phone, with no sideways scroll.
 *
 * Exits non-zero if any step fails. Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build; SHOTS=1 writes the
 * screenshots to docs/screenshots/ (else .data/e2e-companion-plan/). Never calls Stripe: the link is caught in the browser.
 */
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const DATA_DIR = join(ROOT, ".data", "e2e-companion-plan");
const SHOTS_DIR = process.env.SHOTS ? join(ROOT, "docs", "screenshots") : DATA_DIR;
const LINK = "https://buy.stripe.com/e2e_companion_plan";
const PORTAL = "https://billing.stripe.com/p/login/e2e";
const SECRET = ["whsec", "e2eplan".repeat(5)].join("_");
const FREE = 3;
const results = [];

async function step(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${err instanceof Error ? err.message : err}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** The model's stand-in: the crisis check says no, a reply is one JSON message. */
function startStub() {
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let content = "{}";
      try {
        const system = JSON.parse(body).messages[0]?.content ?? "";
        if (system.startsWith("You check one message")) content = JSON.stringify({ risk: false });
        else if (system.startsWith("You are ") && system.includes("Botchelor")) content = JSON.stringify({ messages: ["Tell me more, I'm listening."] });
      } catch {
        // The empty object.
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "stub", object: "chat.completion", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] }));
    });
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

/** A Stripe event as Stripe signs it (v1 = HMAC-SHA256 over `${t}.${body}`). */
function signed(event) {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  return { body, signature: `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex")}` };
}

async function main() {
  if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(SHOTS_DIR, { recursive: true });
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const stub = await startStub();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  Object.assign(env, {
    LLM_BASE_URL: `http://127.0.0.1:${stub.address().port}/v1`,
    LLM_API_KEY: "local-stub-companion",
    LLM_MODEL: "stub-companion",
    COMPANION_OPEN: "1",
    COMPANION_FREE_PER_DAY: String(FREE),
    COMPANION_PLAN_LINK: LINK,
    STRIPE_PLANS_WEBHOOK_SECRET: SECRET,
    STRIPE_PORTAL_LINK: PORTAL,
  });
  const app = await startApp(await freePort(), env);
  const base = app.base;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  const adultContext = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: base }]);
    return ctx;
  };
  const shot = async (page, name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`) });
  };

  let me = null;
  let page = null;
  let threadPath = "";
  let checkoutId = null;
  const composer = () => page.getByRole("textbox", { name: "Your message" });
  const send = async (text) => {
    await composer().fill(text);
    await composer().press("Enter");
  };
  const replies = () => page.locator(".companion-thread .chat-row-a .chat-bubble", { hasText: "Tell me more" });

  try {
    await step("a signed-out visitor sees the cast, the free count and the price, and signs in first", async () => {
      const ctx = await adultContext();
      try {
        const p = await ctx.newPage();
        const res = await p.goto(`${base}/companion`);
        assert(res.status() === 200, `/companion should open for a visitor (HTTP ${res.status()})`);
        await p.getByText(`Free: ${FREE} replies a day across every companion.`).waitFor({ timeout: 10_000 });
        await p.getByText("$9.99 a month").first().waitFor();
        assert((await p.getByRole("link", { name: "Sign in to start" }).count()) === 1, "a Sign in to start button");
        assert((await p.locator(".companion-card").count()) > 0, "the cast is shown");
        assert((await p.locator('nav a[href="/companion"]').count()) > 0, "the Companions nav link shows");
        await shot(p, "companion-signed-out-desktop");
      } finally {
        await ctx.close();
      }
    });

    await step(`talks: ${FREE} free replies, counted under the box, then the plan instead of the box`, async () => {
      me = await adultContext();
      const reg = await me.request.post(`${base}/api/auth/register`, { data: { handle: `planner${Date.now() % 1e6}`, password: "a-long-e2e-password-1", attest: true } });
      assert(reg.ok(), `register: HTTP ${reg.status()}`);
      page = await me.newPage();
      await page.goto(`${base}/companion`);
      await page.locator(".companion-plan-line", { hasText: `(${FREE} left today)` }).waitFor({ timeout: 10_000 });
      await page.locator(".companion-card").first().getByRole("button", { name: "Talk" }).click();
      await page.waitForURL(/\/companion\/[^/]+$/, { timeout: 30_000 });
      threadPath = new URL(page.url()).pathname;
      // The opener is free.
      await page.getByText(`${FREE} free replies left today`).waitFor({ timeout: 15_000 });
      for (let i = 1; i <= FREE; i++) {
        await send(`message ${i}`);
        await replies().nth(i - 1).waitFor({ timeout: 15_000 });
      }
      await page.locator(".companion-out", { hasText: `That's today's ${FREE} free replies.` }).waitFor({ timeout: 10_000 });
      assert((await composer().count()) === 0, "the box gives way once they're gone");
      await shot(page, "companion-out-desktop");
    });

    await step("the plan page says the price and the renewal; Subscribe waits for both boxes and carries a random checkout id", async () => {
      await page.getByRole("link", { name: /Talk without a limit/ }).click();
      await page.waitForURL(/\/companion\/plan$/);
      await page.getByText("$9.99 a month, charged now and every month after until you cancel", { exact: false }).waitFor();
      const subscribe = page.getByRole("button", { name: /^Subscribe/ });
      assert(await subscribe.isDisabled(), "Subscribe waits for the boxes");
      await page.getByLabel("I'm 18 or older.").check();
      assert(await subscribe.isDisabled(), "and for the renewal box");
      await page.getByLabel(/renews automatically at \$9\.99 a month until I cancel/).check();
      await shot(page, "companion-plan-desktop");
      let went = null;
      await page.route("https://buy.stripe.com/**", (route) => {
        went = route.request().url();
        return route.fulfill({ status: 200, contentType: "text/html", body: "<p>Stripe</p>" });
      });
      await subscribe.click();
      await page.waitForURL(/buy\.stripe\.com/, { timeout: 15_000 });
      const url = new URL(went);
      assert(url.origin + url.pathname === LINK, `went to ${url.origin + url.pathname}`);
      checkoutId = url.searchParams.get("client_reference_id");
      assert(/^[0-9a-f-]{36}$/.test(checkoutId ?? ""), `a random checkout id, got ${checkoutId}`);
    });

    await step("Stripe's signed webhook starts the plan: no limit, said on the plan page and the account page", async () => {
      const bad = await me.request.post(`${base}/api/webhooks/stripe-plans`, { headers: { "stripe-signature": "t=1,v1=00" }, data: "{}" });
      assert(bad.status() === 400, `a bad signature is refused (HTTP ${bad.status()})`);
      const { body, signature } = signed({
        id: `evt_e2e_${Date.now()}`,
        type: "checkout.session.completed",
        data: { object: { id: "cs_e2e", mode: "subscription", payment_status: "paid", client_reference_id: checkoutId, subscription: "sub_e2e", customer_details: { email: "e2e@example.com" } } },
      });
      const hook = await me.request.post(`${base}/api/webhooks/stripe-plans`, { headers: { "stripe-signature": signature, "content-type": "application/json" }, data: body });
      assert(hook.ok(), `the webhook: HTTP ${hook.status()}`);
      await page.goto(`${base}/companion/plan?checkout=success`);
      await page.getByText(/^It's on, and renews on/).waitFor({ timeout: 10_000 });
      assert((await page.getByRole("link", { name: "Cancel or change your card" }).getAttribute("href")) === PORTAL, "the billing portal link");
      await shot(page, "companion-plan-on-desktop");
      await page.goto(`${base}${threadPath}`);
      await composer().waitFor({ timeout: 10_000 });
      assert((await page.getByText(/free repl(y|ies) left today/).count()) === 0, "no count with the plan");
      await send("and now?");
      await replies().nth(FREE).waitFor({ timeout: 15_000 });
      await page.goto(`${base}/account`);
      await page.locator("[data-companion-plan-card]", { hasText: "On: renews monthly" }).waitFor({ timeout: 10_000 });
    });

    await step("a cancel keeps it to the period's end", async () => {
      const end = Math.floor(Date.now() / 1000) + 20 * 24 * 3600;
      const { body, signature } = signed({
        id: `evt_e2e_cancel_${Date.now()}`,
        type: "customer.subscription.updated",
        data: { object: { id: "sub_e2e", status: "active", cancel_at_period_end: true, items: { data: [{ current_period_end: end }] } } },
      });
      const hook = await me.request.post(`${base}/api/webhooks/stripe-plans`, { headers: { "stripe-signature": signature, "content-type": "application/json" }, data: body });
      assert(hook.ok(), `the webhook: HTTP ${hook.status()}`);
      await page.goto(`${base}/companion/plan`);
      await page.getByText(/^Cancelled: it runs until/).waitFor({ timeout: 10_000 });
      assert((await page.getByRole("link", { name: "Keep it going, or change your card" }).getAttribute("href")) === PORTAL, "the portal link to keep it going");
      await page.goto(`${base}${threadPath}`);
      await composer().waitFor({ timeout: 10_000 });
    });

    await step("on a phone: the visitor page, the plan page and the chat, with no sideways scroll", async () => {
      const phone = await adultContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      try {
        const p = await phone.newPage();
        await p.goto(`${base}/companion`);
        await p.getByRole("link", { name: "Sign in to start" }).waitFor({ timeout: 10_000 });
        const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(wide <= 1, `the visitor page scrolls sideways by ${wide}px`);
        await shot(p, "companion-signed-out-phone");
      } finally {
        await phone.close();
      }
      const mine = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await me.storageState() });
      try {
        const p = await mine.newPage();
        await p.goto(`${base}/companion/plan`);
        await p.getByText(/^Cancelled: it runs until/).waitFor({ timeout: 10_000 });
        const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(wide <= 1, `the plan page scrolls sideways by ${wide}px`);
        await shot(p, "companion-plan-phone");
      } finally {
        await mine.close();
      }
    });
  } finally {
    await browser.close().catch(() => {});
    await stopApp(app);
    showrunner.close();
    stub.close();
  }

  const failed = results.filter((r) => !r).length;
  console.log(failed ? `\n${failed} of ${results.length} steps failed.` : `\nAll ${results.length} steps passed. Screenshots in ${SHOTS_DIR}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
