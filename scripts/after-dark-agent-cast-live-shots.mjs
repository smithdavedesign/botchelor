// Live proof of After Dark's agent cast (#1336): the audit account (admin) on ad.botchelor.com, picking one of the
// show's own agent-made characters in the pair picker, on a desktop and a phone. Stops before a scene starts, so no
// picture or writer call is spent. The password comes from the keychain and is never printed.
// Usage: node scripts/after-dark-agent-cast-live-shots.mjs <out dir> <name>
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(new URL("../package.json", import.meta.url));
const { chromium } = require("playwright-core");
const BASE = "https://ad.botchelor.com";
const UA = "botchelor-live-check/1.0 (Claude)";
const CHROMIUM = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const [OUT, NAME] = process.argv.slice(2);
if (!OUT || !NAME) throw new Error("usage: node scripts/after-dark-agent-cast-live-shots.mjs <out dir> <name>");
mkdirSync(OUT, { recursive: true });
const password = execFileSync("security", ["find-generic-password", "-s", "vault/botchelor/AUDIT_ACCOUNT_PASSWORD", "-w"], { encoding: "utf8" }).trim();
const browser = await chromium.launch({ executablePath: CHROMIUM });
try {
  for (const [opts, size] of [
    [{ viewport: { width: 1280, height: 900 } }, "desktop"],
    [{ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "phone"],
  ]) {
    const ctx = await browser.newContext({ userAgent: UA, ...opts });
    await ctx.addCookies([{ name: "bz_adult", value: "1", url: BASE }]);
    const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { handle: "nightaudit", password } });
    if (!login.ok()) throw new Error(`sign-in: HTTP ${login.status()}`);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/after-dark`);
    const chip = page.locator(`.ad-cast-chip[title="${NAME}"]`).first();
    await chip.waitFor({ timeout: 30_000 });
    await chip.click();
    await page.locator(".ad-pair-picked").waitFor({ timeout: 10_000 });
    await page.locator(".ad-pair-picker").scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(OUT, `after-dark-agent-cast-live-${size}.png`) });
    console.log("shot", size);
    await ctx.close();
  }
} finally {
  await browser.close();
}
