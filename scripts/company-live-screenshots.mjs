#!/usr/bin/env node
/**
 * Proof on botchelor.com of the company pages (#1427, #1429) and the Sunday letter (#1428), into docs/screenshots/.
 * Needs CHROMIUM_PATH (a local Chromium; nothing is downloaded). The browser says it's botchelor-live-check, passes the
 * 18+ gate with the bz_adult cookie, and never reaches Google or our own event log (they'd count it as a visitor).
 *
 *   pages             /pricing and /press on a desktop, /faq on a phone, the whole footer on a desktop.
 *   signup <address>  signs one of our own addresses up from the footer, on a phone: the filled form, then "Check your
 *                     inbox". It sends a real confirmation email, so only @botchelor.com addresses are allowed.
 *   confirm <link>    the confirmation email's link, on a phone: the page with its button, then "You're on the list",
 *                     each from the top of the screen to the end of the page's own part. Safe to run again on a link
 *                     already used: confirming twice changes nothing.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.LIVE_BASE ?? "https://botchelor.com";
const OUT = process.env.OUT_DIR ?? join(process.cwd(), "docs", "screenshots");
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-live-check/1.0 (Claude)";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
// GA4, the idea-factory signal (as scripts/e2e-live.mjs blocks) and our own event log (/api/e, web_events).
const ANALYTICS = /google-analytics\.com|googletagmanager\.com|idea-factory\.1426davejobs\.workers\.dev\/api\/ideas\/signal|\/api\/e(?:\?|$)/;

const [mode, arg] = process.argv.slice(2);
if (!["pages", "signup", "confirm"].includes(mode)) throw new Error("Usage: company-live-screenshots.mjs pages | signup <address> | confirm <link>");
if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
if (mode === "signup" && !/^[^@\s]+@botchelor\.com$/i.test(arg ?? "")) throw new Error("signup takes one of our own @botchelor.com addresses: it sends a real email.");
if (mode === "confirm" && !(arg ?? "").startsWith(`${BASE}/newsletter/confirm?t=`)) throw new Error(`confirm takes the email's link, ${BASE}/newsletter/confirm?t=…`);
mkdirSync(OUT, { recursive: true });

const assert = (c, m) => {
  if (!c) throw new Error(m);
};
async function shot(target, name, clip) {
  await new Promise((r) => setTimeout(r, 400));
  await target.screenshot({ path: join(OUT, name), ...(clip ? { clip } : {}) });
  console.log(`  📸 ${name}`);
}
/** The top of a page down to the end of its own content: the site footer under it isn't part of what's shown. */
async function pageTop(page, selector) {
  const box = await page.locator(selector).boundingBox();
  assert(box, `no ${selector}`);
  return { x: 0, y: 0, width: page.viewportSize().width, height: Math.ceil(box.y + box.height + 32) };
}
async function noSidewaysScroll(page, label) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  assert(scroll <= width, `${label}: scrolls sideways (${scroll} > ${width})`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
async function context(phone) {
  const ctx = await browser.newContext(
    phone ? { userAgent: PHONE_UA, viewport: PHONE, hasTouch: true, isMobile: true } : { userAgent: DESKTOP_UA, viewport: DESKTOP },
  );
  await ctx.addCookies([{ name: "bz_adult", value: "1", url: BASE }]);
  await ctx.route(ANALYTICS, (route) => route.abort());
  return ctx;
}
async function open(ctx, path) {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const res = await page.goto(path.startsWith("http") ? path : `${BASE}${path}`, { waitUntil: "load" });
  assert(res && res.status() === 200, `${path}: ${res?.status()}`);
  return { page, errors };
}

try {
  if (mode === "pages") {
    const desk = await context(false);
    for (const [path, name, heading] of [
      ["/pricing", "company-live-pricing-desktop.png", "Pricing"],
      ["/press", "company-live-press-desktop.png", "Press kit"],
    ]) {
      const { page, errors } = await open(desk, path);
      assert((await page.locator("h1").first().innerText()).trim() === heading, `${path}: no "${heading}" heading`);
      await shot(page, name);
      assert(errors.length === 0, `${path}: ${errors.join("; ")}`);
    }
    const { page: footerPage } = await open(desk, "/pricing");
    const footer = footerPage.locator("footer.site-footer");
    for (const want of ["Company", "The Sunday letter.", "Sign up"]) {
      assert((await footer.innerText()).includes(want), `the footer has no "${want}"`);
    }
    await footer.scrollIntoViewIfNeeded();
    await shot(footer, "company-live-footer-desktop.png");

    const phone = await context(true);
    const { page, errors } = await open(phone, "/faq");
    await noSidewaysScroll(page, "/faq");
    await shot(page, "company-live-faq-phone.png");
    assert(errors.length === 0, `/faq: ${errors.join("; ")}`);
  }

  if (mode === "signup") {
    const phone = await context(true);
    const { page, errors } = await open(phone, "/pricing");
    const section = page.locator("footer .footer-newsletter");
    await section.waitFor();
    await section.locator('input[type="email"]').fill(arg);
    await section.locator('input[name="attest"]').check();
    await noSidewaysScroll(page, "the footer sign-up");
    // The letter's lede a little below the top of the screen, so the answer that replaces the form shows too.
    await section.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 200));
    await shot(page, "newsletter-live-signup-phone.png");
    const answer = page.waitForResponse((r) => r.url() === `${BASE}/api/newsletter` && r.request().method() === "POST");
    await section.getByRole("button", { name: "Sign up" }).click();
    const res = await answer;
    assert(res.status() === 201, `POST /api/newsletter: ${res.status()} ${await res.text()}`);
    await section.locator(".newsletter-done").waitFor();
    await shot(page, "newsletter-live-check-inbox-phone.png");
    assert(errors.length === 0, `sign-up: ${errors.join("; ")}`);
    console.log(`  ✓ signed up ${arg}: the confirmation email is on its way`);
  }

  if (mode === "confirm") {
    const phone = await context(true);
    const { page, errors } = await open(phone, arg);
    const button = page.getByRole("button", { name: "Yes, send me the letter" });
    await button.waitFor();
    await shot(page, "newsletter-live-confirm-phone.png", await pageTop(page, "article.newsletter-page"));
    await button.click();
    await page.waitForURL(/\/newsletter\/confirm\?done=1$/);
    const notice = (await page.locator(".newsletter-page .notice").innerText()).trim();
    assert(notice.startsWith("You're on the list."), `after the button: "${notice}"`);
    // Confirming twice is fine (lib/newsletter.ts confirmSubscription): the link keeps saying so for its 7 days.
    await shot(page, "newsletter-live-confirmed-phone.png", await pageTop(page, "article.newsletter-page"));
    assert(errors.length === 0, `confirm: ${errors.join("; ")}`);
    console.log(`  ✓ confirmed: "${notice}"`);
  }
} finally {
  await browser.close();
}
