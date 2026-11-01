#!/usr/bin/env node
/**
 * npm run screenshots:swipes-live -- swipe|unmatch [out-dir]: proof on botchelor.com of the phone swipe (#1131, #1138)
 * and of Unmatch in the chat (#1138), into docs/screenshots/ by default. A throwaway visitor identifies as
 * botchelor-live-check. Its character is closed to dates, so it never reaches anyone's deck. It likes house cards only;
 * its passes are silent. It cleans up with DELETE /api/me (its swipes, matches and unmatches go too) and exits non-zero
 * if that fails. Needs CHROMIUM_PATH (a local Chromium; nothing is downloaded).
 *
 *   swipe: real touch input on a phone (CDP Input.dispatchTouchEvent, as a finger is handled). The deck at rest, a card
 *     mid-drag on its profile text, a drag let go short (the card stays), two left swipes back to back (passes), then a
 *     right swipe (like: the house cast likes back, so it's a match).
 *   unmatch: a match with a house character. The thread (its header fits a phone, their name whole), ⋯ open, Unmatch's
 *     confirm (a modal: Keep the match on desktop, 💔 Unmatch on the phone), back on Matches, a like again refused, then
 *     the old link to the thread.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.LIVE_BASE ?? "https://botchelor.com";
const MODE = process.argv[2];
const OUT = process.argv[3] ?? join(process.cwd(), "docs", "screenshots");
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 botchelor-live-check/1.0 (Claude)";
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844 };
const HOUSE = ["house-nell", "house-teo", "house-marisol", "house-rafe", "house-juniper", "house-dex", "house-sable", "house-orin", "house-imogen", "house-kaz", "house-wally", "house-perpetua"];
const NAMES = ["Corvina Ashgrove", "Thessaly Brindlecombe", "Odalric Fenmoor", "Wilhelmina Quarrender", "Isembard Thornquist"];

if (!["swipe", "unmatch"].includes(MODE)) throw new Error("usage: npm run screenshots:swipes-live -- swipe|unmatch [out-dir]");
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
// Touch on, as a phone: the bug was in how the browser hands a finger's drag to the page.
const ctx = await browser.newContext({ userAgent: UA, viewport: PHONE, hasTouch: true, isMobile: MODE === "swipe", deviceScaleFactor: MODE === "swipe" ? 2 : 1 });
await ctx.addCookies([{ name: "bz_adult", value: "1", url: BASE }]);
let created = false;
try {
  const page = await ctx.newPage();
  await page.goto(BASE + "/");
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
  const first = me.name.split(" ")[0];
  console.log(`visitor's character: ${me.name} (${me.id}), closed to dates`);

  if (MODE === "swipe") {
    await page.goto(`${BASE}/swipe?character=${encodeURIComponent(me.id)}`);
    await page.locator(".swipe-top").waitFor();
    const topName = () => page.locator(".swipe-top .swipe-name").innerText();
    const topIsHouse = async () => (await page.locator(".swipe-top .badge", { hasText: "On the show this season" }).count()) > 0;
    // Only house cards: a pass on anyone else's character is silent, but it's still theirs.
    for (let i = 0; i < 8 && !(await topIsHouse()); i++) {
      console.log(`  (top card isn't the house cast: passing with ✕)`);
      await page.locator(".swipe-btn-nope").click();
      await page.waitForTimeout(900);
    }
    assert(await topIsHouse(), "no house card came up");
    await checkPhone(page, "the deck on a phone");
    await shot(page, "swipe-live-deck-phone.png");

    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    async function move(x0, y0, dx, steps = 12) {
      for (let i = 1; i <= steps; i++) {
        await touch("touchMove", x0 + (dx * i) / steps, y0);
        await page.waitForTimeout(16);
      }
    }
    const start = async () => {
      const box = await page.locator(".swipe-top .swipe-body").boundingBox();
      assert(box, "no profile text on the card");
      return { x: box.x + box.width / 2, y: box.y + Math.min(70, box.height / 3) };
    };

    // 1. Mid-drag on the profile text (before the fix, the browser took this as its own pan and the card never moved).
    const nell = await topName();
    let p = await start();
    await touch("touchStart", p.x, p.y);
    await move(p.x, p.y, 110);
    await page.waitForTimeout(150);
    const moved = await page.locator(".swipe-top").evaluate((el) => getComputedStyle(el).transform);
    assert(moved && moved !== "none", `the card didn't follow the finger (transform ${moved})`);
    await page.screenshot({ path: join(OUT, "swipe-live-drag-phone.png") });
    console.log(`  📸 swipe-live-drag-phone.png (mid-drag on ${nell}: ${moved})`);
    // Let go short of the line: it springs back, no swipe.
    await move(p.x + 110, p.y, -110, 6);
    await touch("touchEnd");
    await page.waitForTimeout(700);
    assert((await topName()) === nell, "a drag let go short still swiped");
    console.log(`  ✓ a drag let go short springs back: ${nell} still on top`);

    // 2. Two real left swipes on the profile text, back to back (passes): the second doesn't wait for the first's answer.
    const swipeLeft = async () => {
      const q = await start();
      await touch("touchStart", q.x, q.y);
      await move(q.x, q.y, -220);
      await touch("touchEnd");
    };
    await swipeLeft();
    await page.waitForFunction((name) => document.querySelector(".swipe-top .swipe-name")?.innerText !== name, nell, { timeout: 5_000 });
    const after = await topName();
    await page.waitForTimeout(300);
    await swipeLeft();
    await page.waitForFunction((name) => document.querySelector(".swipe-top .swipe-name")?.innerText !== name, after, { timeout: 2_000 });
    console.log(`  ✓ two left swipes back to back: ${nell}, then ${after}, passed; next: ${await topName()}`);

    // 3. A right swipe on a house card: a like, and the house cast likes back.
    for (let i = 0; i < 8 && !(await topIsHouse()); i++) {
      await page.locator(".swipe-btn-nope").click();
      await page.waitForTimeout(900);
    }
    assert(await topIsHouse(), "no second house card came up");
    const liked = await topName();
    p = await start();
    await touch("touchStart", p.x, p.y);
    await move(p.x, p.y, 220);
    await touch("touchEnd");
    await page.locator(".swipe-match-overlay").waitFor({ timeout: 10_000 });
    console.log(`  ✓ swiped right (like) on ${liked}: it's a match`);
    await shot(page, "swipe-live-match-phone.png");
  } else {
    // A match with a house character: a like, and it likes back at once.
    let them = null;
    for (const id of HOUSE) {
      const res = await ctx.request.post(`${BASE}/api/swipes`, { headers: { origin: BASE }, data: { character_id: me.id, target_id: id, like: true } });
      const body = await res.json().catch(() => ({}));
      if (res.ok() && body.match) {
        them = id;
        break;
      }
      console.log(`  (${id}: ${res.status()} ${body.error ?? "no match"})`);
    }
    assert(them, "no house match");
    const [lo, hi] = me.id < them ? [me.id, them] : [them, me.id];
    const thread = `${BASE}/messages/${lo}/${hi}?as=${encodeURIComponent(me.id)}`;
    console.log(`matched ${them}; thread ${thread}`);

    for (const [size, viewport] of [
      ["desktop", DESKTOP],
      ["phone", PHONE],
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(thread);
      const more = page.locator(".phone-header .thread-menu > button");
      await more.waitFor();
      if (size === "phone") {
        await checkPhone(page, "the thread on a phone");
        const row = await page.locator(".phone-header.is-page").evaluate((el) => ({ scroll: el.scrollWidth, width: el.clientWidth }));
        assert(row.scroll <= row.width, `the thread header overflows (${row.scroll} > ${row.width})`);
        const name = await page.locator(".phone-header .phone-contact-name").evaluate((el) => ({ shown: el.clientWidth, needs: el.scrollWidth }));
        assert(name.shown >= name.needs, `their name is cut short in the header (${name.shown} < ${name.needs})`);
        console.log(`  ✓ the header row fits, their name whole (${row.scroll} ≤ ${row.width})`);
      }
      await shot(page, `unmatch-thread-${size}.png`);
      // ⋯: their story, a double date, Unmatch.
      await more.click();
      const menu = page.locator(".thread-menu-panel");
      await menu.getByRole("menuitem", { name: /Unmatch/ }).waitFor();
      await shot(page, `unmatch-menu-${size}.png`);
      // Unmatch asks first, in a modal (a bottom sheet on a phone).
      await menu.getByRole("menuitem", { name: /Unmatch/ }).click();
      await page.locator(".sheet-dialog[open]").waitFor();
      await shot(page, `unmatch-confirm-${size}.png`);
      if (size === "desktop") {
        await page.locator(".sheet-dialog").getByRole("button", { name: "Keep the match" }).click();
        await page.locator(".sheet-dialog").waitFor({ state: "detached" });
      }
    }

    await page.locator(".sheet-dialog").getByRole("button", { name: /Unmatch/ }).click();
    await page.waitForURL(/\/matches/, { timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    assert((await page.locator(`a[href^="/messages/${lo}/${hi}"]`).count()) === 0, "the thread is still on Matches");
    console.log(`  ✓ unmatched: back on ${first}'s Matches, and the thread is gone from it`);
    await shot(page, "unmatch-done-phone.png");

    // They can't match again: the deck refuses the house character now.
    const again = await ctx.request.post(`${BASE}/api/swipes`, { headers: { origin: BASE }, data: { character_id: me.id, target_id: them, like: true } });
    const againBody = await again.json().catch(() => ({}));
    assert(again.status() === 404 && /unmatched/.test(againBody.message ?? ""), `a like again: ${again.status()} ${againBody.message}`);
    console.log(`  ✓ a like again is refused: ${againBody.message}`);

    for (const [size, viewport] of [
      ["phone", PHONE],
      ["desktop", DESKTOP],
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(thread);
      await page.getByText("unmatched, so their chat has ended").waitFor();
      await shot(page, `unmatch-ended-${size}.png`);
    }
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
