#!/usr/bin/env node
/**
 * The builder's PG check, field by field (app/create/sheet-issues.ts), proven in a real browser on a local build:
 *
 *   1. typing a line that won't pass marks that input at once, with the words that did it, and its step on the rail;
 *   2. Save with problems on the form doesn't send: it goes to the first one (another step, a folded group) and puts the
 *      cursor in it, and the list by Save links to each;
 *   3. fixed, it saves.
 *
 * Writes docs/screenshots/sheet-issues-*.png (desktop and phone). Set CHROMIUM_PATH; SKIP_BUILD=1 reuses the last build.
 */
import { join } from "node:path";
import { chromium } from "playwright-core";
import { appEnv, build, freePort, ROOT, startApp, startShowrunner, stopApp } from "./harness.mjs";

const OUT_DIR = join(ROOT, "docs", "screenshots");
const DATA_DIR = join(ROOT, ".data", "sheet-issues-screenshots");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function shot(page, file) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT_DIR, file) });
}

async function checkPhone(page, name) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  assert(scroll <= width, `${name}: the page scrolls sideways (${scroll}px wide on a ${width}px screen)`);
}

/** The element the cursor is in: its name, or its data-issue for a chip. */
const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute("name") ?? document.activeElement?.getAttribute("data-issue") ?? null);

async function main() {
  if (!process.env.SKIP_BUILD) build();
  const showrunner = await startShowrunner();
  const env = appEnv(showrunner.address().port, DATA_DIR);
  const app = await startApp(await freePort(), env);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: app.base }]);
    const handle = `sheet${Date.now() % 1e6}`;
    const reg = await ctx.request.post(`${app.base}/api/auth/register`, { data: { handle, password: ["a", "long", "shots", "phrase"].join("-"), attest: true } });
    assert(reg.ok(), `register: HTTP ${reg.status()}`);
    const made = await ctx.request.post(`${app.base}/api/characters`, {
      headers: { origin: app.base },
      data: {
        name: `Brock Halvorsen ${Date.now() % 1e4}`,
        age: 29,
        bio: "A semi-pro footballer who also writes software. Loves hiking and a good argument about tactics.",
        traits: ["confident", "competitive", "charming"],
        want: "Someone who laughs at his jokes",
        dealbreaker: "They check their phone all night",
        attest: true,
        extras: {
          hobbies: ["Night swimming", "Chess"],
          prompts: [
            { id: "dating_me_is_like", answer: "Winning in life" },
            { id: "geek_out", answer: "Set pieces" },
          ],
        },
      },
    });
    assert(made.status() === 201, `create: HTTP ${made.status()} ${await made.text()}`);
    const { id } = await made.json();

    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${app.base}/characters/${id}/edit`);
    await page.getByRole("button", { name: "Save changes" }).waitFor();

    // 1. A want that won't pass: marked at once, with the words that did it.
    await page.locator('input[name="want"]').fill("A wild first night that leads back to his place for what every guy wants");
    const wantIssue = page.locator("#issue-want");
    await wantIssue.waitFor();
    assert((await wantIssue.textContent()).includes("“what every guy wants”"), `want's message: ${await wantIssue.textContent()}`);
    assert((await page.locator('input[name="want"]').getAttribute("aria-invalid")) === "true", "want isn't marked invalid");

    // Two more on the Dating profile: a quirk in a folded group, and an interest (a chip).
    await page.getByRole("button", { name: /^Step 4: Dating profile/ }).click();
    await page.locator("#hobby-input").fill("making you moan");
    await page.locator("#hobby-input").press("Enter");
    await page.locator("summary", { hasText: "Quirks" }).click();
    await page.locator('input[name="extra_quirk"]').fill("Tries to talk you into sleeping with him");
    await page.locator("#issue-extra_quirk").waitFor();
    assert(await page.locator('[data-issue="hobby_2"].chip-issue').isVisible(), "the hobby chip isn't marked");
    const list = page.locator(".sheet-issues");
    await list.waitFor();
    assert((await list.locator("li").count()) === 3, `the list by Save has ${await list.locator("li").count()} items, not 3`);
    assert(await page.locator(".wizard-rail-step.has-issues").count() === 2, "the rail should mark Identity and Dating profile");
    await page.locator("summary", { hasText: "Quirks" }).scrollIntoViewIfNeeded();
    await shot(page, "sheet-issues-inline-desktop.png");

    // 2. Save goes to the first problem (another step) and puts the cursor in it.
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText("Who are they?").waitFor();
    await page.waitForTimeout(400);
    assert((await focused(page)) === "want", `Save left the cursor in ${await focused(page)}, not want`);
    assert(page.url().endsWith("/edit"), "Save sent a sheet that can't pass");
    await shot(page, "sheet-issues-save-desktop.png");

    // The list's link to the quirk: back to the Dating profile, its group open, the cursor in it.
    await list.getByRole("button", { name: "Quirk" }).click();
    await page.locator('input[name="extra_quirk"]').waitFor();
    await page.waitForTimeout(400);
    assert((await focused(page)) === "extra_quirk", `the Quirk link left the cursor in ${await focused(page)}`);

    // On a phone: the same, and nothing scrolls sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await checkPhone(page, "the Dating profile with issues");
    await page.locator('input[name="extra_quirk"]').scrollIntoViewIfNeeded();
    await shot(page, "sheet-issues-inline-phone.png");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText("Who are they?").waitFor();
    await page.waitForTimeout(400);
    await checkPhone(page, "Identity after Save");
    await shot(page, "sheet-issues-save-phone.png");
    await page.setViewportSize({ width: 1280, height: 900 });

    // 3. Fixed: it saves and goes back to the character.
    await page.locator('input[name="want"]').fill("Someone who laughs at his jokes and posts him on her story");
    await page.getByRole("button", { name: /^Step 4: Dating profile/ }).click();
    await page.locator('[data-issue="hobby_2"] button').click();
    await page.locator('input[name="extra_quirk"]').fill("Rates every date out of ten, always a ten himself");
    assert((await page.locator(".sheet-issues").count()) === 0, "the list is still up with nothing to fix");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForURL(new RegExp(`/characters/${id}$`), { timeout: 20_000 });
    console.log("✓ sheet issues: marked as typed, Save goes to each, fixed it saves");
  } finally {
    await browser.close();
    await stopApp(app);
    showrunner.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
