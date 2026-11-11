#!/usr/bin/env node
/**
 * Proof on botchelor.com of getting back into an account (lib/account-recovery.ts), into docs/screenshots/. Needs
 * CHROMIUM_PATH (a local Chromium; nothing is downloaded). The browser says it's botchelor-live-check, passes the 18+ gate
 * with the bz_adult cookie, and never reaches Google or our own event log.
 *
 * The whole flow, on a throwaway account whose recovery email is one of our own addresses:
 *   pages                 the sign-in card's "Forgot your password?" (desktop and phone, sends nothing: the handle has no
 *                         account), the reset page opened without a link, /.well-known/change-password.
 *   start <address>       makes a throwaway account (bzcheck_…) on a phone and adds <address> as its recovery email: a real
 *                         confirmation email goes there, so only @botchelor.com addresses are allowed. Prints the handle.
 *   confirm <link>        the confirmation email's link: its page and button, then "Done".
 *   forgot <handle>       "Forgot your password?" for that handle on a phone: a real reset email goes to its recovery email.
 *   reset <link>          the reset email's link: the form, a new password, "Done", signed in. Then deletes the throwaway
 *                         account from that signed-in browser, so nothing is left behind.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.LIVE_BASE ?? "https://botchelor.com";
const OUT = process.env.OUT_DIR ?? join(process.cwd(), "docs", "screenshots");
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-live-check/1.0 (Claude)";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };
// GA4, the idea-factory signal and our own event log (/api/e), as scripts/company-live-screenshots.mjs blocks them.
const ANALYTICS = /google-analytics\.com|googletagmanager\.com|idea-factory\.1426davejobs\.workers\.dev\/api\/ideas\/signal|\/api\/e(?:\?|$)/;
const CHECK_HANDLE = /^bzcheck_[a-z0-9_]{4,12}$/;

const [mode, arg] = process.argv.slice(2);
if (!["pages", "start", "confirm", "forgot", "reset"].includes(mode)) {
  throw new Error("Usage: account-recovery-live.mjs pages | start <address> | confirm <link> | forgot <handle> | reset <link>");
}
if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
if (mode === "start" && !/^[^@\s]+@botchelor\.com$/i.test(arg ?? "")) throw new Error("start takes one of our own @botchelor.com addresses: it sends a real email.");
if (mode === "confirm" && !(arg ?? "").startsWith(`${BASE}/email/confirm-recovery?t=`)) throw new Error(`confirm takes the email's link, ${BASE}/email/confirm-recovery?t=…`);
if (mode === "forgot" && !CHECK_HANDLE.test(arg ?? "")) throw new Error("forgot takes the throwaway handle that start printed (bzcheck_…).");
if (mode === "reset" && !(arg ?? "").startsWith(`${BASE}/email/reset-password#t=`)) throw new Error(`reset takes the email's link, ${BASE}/email/reset-password#t=…`);
mkdirSync(OUT, { recursive: true });

const assert = (c, m) => {
  if (!c) throw new Error(m);
};
async function shot(target, name) {
  await new Promise((r) => setTimeout(r, 400));
  await target.screenshot({ path: join(OUT, name) });
  console.log(`  📸 ${name}`);
}
/** The top of a page down to the end of `selector`: the site footer under it isn't part of what's shown. */
async function shotDownTo(page, selector, name) {
  const box = await page.locator(selector).boundingBox();
  assert(box, `no ${selector}`);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: join(OUT, name), clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.ceil(box.y + box.height + 24) } });
  console.log(`  📸 ${name}`);
}
async function noSidewaysScroll(page, label) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  assert(scroll <= width, `${label}: scrolls sideways (${scroll} > ${width})`);
}
/** A password nobody types: only this run knows it, and nothing prints it. */
const throwawayPassword = () => `${randomBytes(18).toString("base64url")}-Aa1`;

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
/** The account page's sign-in card, on its Sign in tab, with "Forgot your password?" opened. */
async function forgotForm(page) {
  await page.getByRole("tab", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  const form = page.locator("#auth-panel form");
  await form.locator('input[name="who"]').waitFor();
  return form;
}

try {
  if (mode === "pages") {
    for (const phone of [false, true]) {
      const ctx = await context(phone);
      const { page, errors } = await open(ctx, "/account");
      const form = await forgotForm(page);
      await form.locator('input[name="who"]').fill("nobody_by_this_name");
      if (phone) await noSidewaysScroll(page, "the forgot form");
      await shot(page.locator(".account-auth"), `account-recovery-live-forgot-${phone ? "phone" : "desktop"}.png`);
      if (phone) {
        // No such account, so no email: the answer is the same one every handle gets.
        await form.getByRole("button", { name: "Email me a link" }).click();
        const answer = page.locator("#auth-panel .notice");
        await answer.waitFor();
        assert((await answer.innerText()).startsWith("If that account has a recovery email"), `the answer: "${await answer.innerText()}"`);
        await shot(page.locator(".account-auth"), "account-recovery-live-answer-phone.png");
      }
      assert(errors.length === 0, `/account: ${errors.join("; ")}`);
      await ctx.close();
    }
    const ctx = await context(true);
    const { page, errors } = await open(ctx, "/email/reset-password");
    const notice = (await page.locator("article .notice").innerText()).trim();
    assert(notice.startsWith("Open this page from the link in the email"), `the reset page without a link: "${notice}"`);
    assert(errors.length === 0, `/email/reset-password: ${errors.join("; ")}`);
    const res = await ctx.request.get(`${BASE}/.well-known/change-password`, { maxRedirects: 0 });
    assert(res.status() === 302 && res.headers().location === "/account#password", `/.well-known/change-password: ${res.status()} ${res.headers().location}`);
    console.log("  ✓ /.well-known/change-password → /account#password; the reset page without a link says how to get one");
  }

  if (mode === "start") {
    const handle = `bzcheck_${new Date().toISOString().slice(5, 10).replace("-", "")}${randomBytes(2).toString("hex")}`;
    const password = throwawayPassword();
    const ctx = await context(true);
    const { page, errors } = await open(ctx, "/account");
    await page.getByRole("tab", { name: "Create account" }).click();
    const form = page.locator("#auth-panel form");
    await form.locator('input[name="handle"]').fill(handle);
    await form.locator('input[name="password"]').fill(password);
    await form.locator('input[name="attest"]').check();
    await form.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("heading", { name: `Signed in as ${handle}` }).waitFor();
    const card = page.locator("#password");
    await card.waitFor();
    const add = card.locator("form").filter({ has: page.getByRole("heading", { name: "Add a recovery email" }) });
    await add.locator('input[name="email"]').fill(arg);
    await add.locator('input[name="password"]').fill(password);
    await card.scrollIntoViewIfNeeded();
    await noSidewaysScroll(page, "the password card");
    await shot(card, "account-recovery-live-add-email-phone.png");
    await add.getByRole("button", { name: "Save" }).click();
    const note = card.locator(".notice");
    await note.waitFor();
    assert((await note.innerText()).startsWith(`Check ${arg.toLowerCase()}`), `after Save: "${await note.innerText()}"`);
    await shot(card, "account-recovery-live-check-inbox-phone.png");
    assert(errors.length === 0, `/account: ${errors.join("; ")}`);
    console.log(`  ✓ ${handle} made, and its confirmation email is on its way to ${arg}`);
    console.log(`HANDLE=${handle}`);
  }

  if (mode === "confirm") {
    const ctx = await context(true);
    const { page, errors } = await open(ctx, arg);
    const button = page.getByRole("button", { name: "Yes, use this address" });
    await button.waitFor();
    await shotDownTo(page, "article.legal-page", "account-recovery-live-confirm-phone.png");
    await button.click();
    await page.waitForURL(/\/email\/confirm-recovery\?done=1$/);
    const notice = (await page.locator("article .notice").innerText()).trim();
    assert(notice.startsWith("Done."), `after the button: "${notice}"`);
    await shotDownTo(page, "article.legal-page", "account-recovery-live-confirmed-phone.png");
    assert(errors.length === 0, `confirm: ${errors.join("; ")}`);
    console.log(`  ✓ confirmed: "${notice}"`);
  }

  if (mode === "forgot") {
    const ctx = await context(true);
    const { page, errors } = await open(ctx, "/account");
    const form = await forgotForm(page);
    await form.locator('input[name="who"]').fill(arg);
    await form.getByRole("button", { name: "Email me a link" }).click();
    const answer = page.locator("#auth-panel .notice");
    await answer.waitFor();
    assert((await answer.innerText()).startsWith("If that account has a recovery email"), `the answer: "${await answer.innerText()}"`);
    assert(errors.length === 0, `/account: ${errors.join("; ")}`);
    console.log(`  ✓ asked for ${arg}'s reset link: the email is on its way`);
  }

  if (mode === "reset") {
    const ctx = await context(true);
    const { page, errors } = await open(ctx, arg);
    const form = page.locator("article form");
    await form.locator('input[name="password"]').waitFor();
    assert(!page.url().includes("#"), `the token is still in the address bar: ${page.url()}`);
    const who = (await form.locator("strong").first().innerText()).trim();
    assert(/^@bzcheck_/.test(who), `the link is for ${who}, not a throwaway account: stopping`);
    await noSidewaysScroll(page, "the reset form");
    await shotDownTo(page, "article.legal-page", "account-recovery-live-reset-phone.png");
    const password = throwawayPassword();
    await form.locator('input[name="password"]').fill(password);
    await form.locator('input[name="again"]').fill(password);
    await form.getByRole("button", { name: "Set the new password" }).click();
    const done = page.locator("article .notice");
    await done.waitFor();
    assert((await done.innerText()).startsWith("Done. Your new password is set"), `after the form: "${await done.innerText()}"`);
    await shotDownTo(page, "article.legal-page", "account-recovery-live-reset-done-phone.png");
    // The same link again: used up.
    const again = await ctx.newPage();
    await again.goto(arg, { waitUntil: "load" });
    await again.locator("article .notice").waitFor();
    assert((await again.locator("article .notice").innerText()).startsWith("That link doesn't work any more"), "the link worked twice");
    assert(errors.length === 0, `reset: ${errors.join("; ")}`);
    // Signed in by the reset: delete the throwaway account and everything on it.
    const deleted = await page.evaluate(async () => {
      const r = await fetch("/api/me", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      return r.status;
    });
    assert(deleted === 200, `deleting ${who}: ${deleted}`);
    console.log(`  ✓ ${who}: new password set, signed in, the link is used up, and the account is deleted`);
  }
} finally {
  await browser.close();
}
