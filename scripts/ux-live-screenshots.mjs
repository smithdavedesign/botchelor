#!/usr/bin/env node
/**
 * npm run screenshots:ux-live [out-dir]: proof on botchelor.com of the 2026-10-31 UX audit's fixes
 * (docs/audits/2026-10-31-ux-audit.md), into docs/screenshots/ by default. A throwaway visitor identifies as
 * botchelor-live-check. Its character is closed to dates, so it never reaches anyone's deck, and it never swipes. It
 * cleans up with DELETE /api/me and exits non-zero if that fails. Needs CHROMIUM_PATH (a local Chromium; nothing is
 * downloaded).
 *
 *   As a visitor, on a phone: /characters two to a row, the footer's groups, the account page's Sign in and Create
 *   account tabs, the create wizard's Next saying what's missing, and the home page's three reviews. On a desktop,
 *   /reviews.
 *   With a character of its own: the character page's one next step and notifications' ⚙ Settings modal on a phone,
 *   and the swipe deck at 1280×800 with Pass and Like in view.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.LIVE_BASE ?? "https://botchelor.com";
const OUT = process.argv[2] ?? join(process.cwd(), "docs", "screenshots");
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-live-check/1.0 (Claude)";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const NAMES = ["Thessaly Brindlecombe", "Odalric Fenmoor", "Wilhelmina Quarrender", "Isembard Thornquist", "Peregrine Ashcombe"];

if (!process.env.CHROMIUM_PATH) throw new Error("Set CHROMIUM_PATH to a local Chromium; this script never downloads one.");
mkdirSync(OUT, { recursive: true });
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, name) });
  console.log(`  📸 ${name}`);
}
async function checkPhone(page, label) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  assert(scroll <= width, `${label}: scrolls sideways (${scroll} > ${width})`);
  console.log(`  ✓ ${label}: no sideways scroll`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ userAgent: PHONE_UA, viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: "bz_adult", value: "1", url: BASE }]);
let created = false;
try {
  const page = await ctx.newPage();

  await page.goto(`${BASE}/characters`);
  await page.locator(".characters-hub .gallery .card").first().waitFor();
  const columns = await page.locator(".characters-hub .gallery").first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  assert(columns === 2, `/characters on a phone: ${columns} columns, not 2`);
  await checkPhone(page, "/characters");
  await shot(page, "ux-characters-phone.png");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  // The groups fold once the page runs (app/FooterGroup.tsx), so wait for that rather than count straight away.
  const folded = await page
    .waitForFunction(() => document.querySelectorAll("details.footer-group:not([open])").length === 3, null, { timeout: 15_000 })
    .then(() => 3)
    .catch(() => page.locator("details.footer-group:not([open])").count());
  assert(folded === 3, `the footer's groups on a phone: ${folded} folded, not 3`);
  await page.locator("details.footer-group > summary", { hasText: "Help and legal" }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  // "Give us feedback" is a button beside "Report a problem", a link: the two sit level in their row.
  const middle = async (l) => {
    const b = await l.boundingBox();
    return b ? b.y + b.height / 2 : NaN;
  };
  const help = page.locator("details.footer-group[open]");
  const [report, feedback] = [await middle(help.getByRole("link", { name: "Report a problem" })), await middle(help.getByRole("button", { name: "Give us feedback" }))];
  assert(Math.abs(report - feedback) <= 3, `the footer: "Give us feedback" sits ${Math.round(report - feedback)}px off "Report a problem"`);
  console.log("  ✓ the footer: Give us feedback level with Report a problem");
  await shot(page, "ux-footer-phone.png");

  await page.goto(`${BASE}/account`);
  await page.locator('[role="tab"][aria-selected="true"]').waitFor();
  assert((await page.locator('[role="tab"]').count()) === 2, "the account page should have two tabs");
  await shot(page, "ux-account-phone.png");

  await page.goto(`${BASE}/create`);
  await page.getByRole("button", { name: /^Next\b/ }).click();
  await page.locator(".wizard-still").waitFor();
  console.log(`  ✓ Next on an empty step 1: "${(await page.locator(".wizard-still").innerText()).trim()}"`);
  await shot(page, "ux-create-next-phone.png");

  await page.goto(`${BASE}/`);
  await page.locator("#bots").scrollIntoViewIfNeeded();
  assert((await page.locator("#bots .bot-card").count()) === 3, "the home page should quote three reviews");
  await page.locator("#bots").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(page, "ux-home-reviews-phone.png");

  // A character of its own, closed to dates, with a dating profile finished (so the deck opens for it).
  let me = null;
  for (const name of NAMES) {
    const res = await ctx.request.post(`${BASE}/api/characters`, {
      headers: { origin: BASE },
      data: {
        name,
        age: 34,
        bio: "A cartographer of night trains who keeps a ledger of every station clock that runs slow, and why.",
        traits: ["curious", "wry", "patient"],
        want: "Someone who likes the long way round",
        dealbreaker: "Checking the time on a date",
        appearance: "a long coat, a pencil behind one ear",
        attest: true,
        keep_name: true,
        open_to_dates: false,
        extras: {
          prompts: [
            { id: "simple_pleasures", answer: "The last train home with a window seat and a thermos." },
            { id: "geek_out", answer: "Why station clocks in old towns all run two minutes slow." },
          ],
          hobbies: ["Night trains", "Old timetables"],
        },
      },
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok()) {
      me = body;
      created = true;
      break;
    }
    console.log(`  (${name}: ${res.status()} ${body.error ?? ""})`);
  }
  assert(me, "couldn't make the visitor's character");
  console.log(`visitor's character: ${me.name} (${me.id}), closed to dates`);

  await page.goto(`${BASE}/characters/${encodeURIComponent(me.id)}`);
  await page.locator(".owner-next").waitFor();
  await checkPhone(page, "the owner's character page");
  await shot(page, "ux-character-owner-phone.png");

  await page.goto(`${BASE}/notifications`);
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.locator("dialog.sheet-dialog[open]").waitFor();
  await shot(page, "ux-notifications-settings-phone.png");

  // The same visitor on a desktop: Pass and Like in view at 1280×800, beside the intro.
  const desk = await browser.newContext({ userAgent: DESKTOP_UA, viewport: DESKTOP, storageState: await ctx.storageState() });
  try {
    const dpage = await desk.newPage();
    await dpage.goto(`${BASE}/reviews`);
    await dpage.locator(".bot-reviews .bot-card").first().waitFor();
    await shot(dpage, "ux-reviews-desktop.png");

    await dpage.goto(`${BASE}/swipe?character=${encodeURIComponent(me.id)}`);
    await dpage.locator(".swipe-top").waitFor();
    const like = await dpage.locator(".swipe-btn-like").boundingBox();
    assert(like && like.y + like.height <= DESKTOP.height, `Like is below the fold at 1280×800 (${like ? Math.round(like.y) : "missing"})`);
    console.log(`  ✓ the desktop deck: Like at y=${Math.round(like.y)}, in view`);
    await shot(dpage, "ux-swipe-desktop.png");
  } finally {
    await desk.close();
  }
} finally {
  if (created) {
    const res = await ctx.request.delete(`${BASE}/api/me`, { headers: { origin: BASE }, data: { confirm: true } });
    console.log(`cleanup: DELETE /api/me → ${res.status()}`);
    if (!res.ok()) {
      process.exitCode = 1;
      console.log("  ✗ CLEANUP FAILED: the throwaway visitor is still on the site");
    }
  }
  await browser.close();
}
