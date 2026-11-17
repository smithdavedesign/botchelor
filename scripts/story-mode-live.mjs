// Live check of story mode, alternates and Continue (#1774) as the audit account (an admin, so Narrated is open to it).
// Writes only under that account; the style is set back to the script at the end. Takes two screenshots.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.argv[2] + "/package.json");
const { chromium } = require("playwright-core");
const OUT = process.argv[3];
mkdirSync(OUT, { recursive: true });
const SHOW = "https://botchelor.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 botchelor-live-check/1.0 (Claude)";
const CHROMIUM = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const password = execFileSync("security", ["find-generic-password", "-s", "vault/botchelor/AUDIT_ACCOUNT_PASSWORD", "-w"], { encoding: "utf8" }).trim();
const browser = await chromium.launch({ executablePath: CHROMIUM });
const api = (page, method, path, body) =>
  page.evaluate(async ([m, p, b]) => {
    const res = await fetch(p, { method: m, headers: b === undefined ? {} : { "content-type": "application/json" }, body: b === undefined ? undefined : JSON.stringify(b), signal: AbortSignal.timeout(200000) });
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  }, [method, path, body]);
const open = async (opts) => {
  const ctx = await browser.newContext({ userAgent: UA, ...opts });
  await ctx.addCookies([{ name: "bz_adult", value: "1", url: SHOW }, { name: "repohq_notrack", value: "1", url: SHOW }]);
  const login = await ctx.request.post(`${SHOW}/api/auth/login`, { data: { handle: "nightaudit", password } });
  if (!login.ok()) throw new Error(`sign-in: ${login.status()}`);
  return { ctx, page: await ctx.newPage() };
};
const last = (r) => r.data?.view?.messages?.at(-1);
try {
  const { ctx, page } = await open({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${SHOW}/account`, { waitUntil: "domcontentloaded" });
  console.log("style narrated:", (await api(page, "POST", "/api/writing-style", { style: "narrated" })).status);
  const id = (await api(page, "POST", "/api/companion", { character_id: "house-juniper" })).data?.thread_id;
  const scene = await api(page, "POST", `/api/companion/${id}`, { action: "scene", place: "rooftop_bar", roleplay: "old-friends-bench", opening: 0 });
  let m = last(scene);
  console.log("scene:", scene.status, scene.data?.error ?? "-", "| form:", m?.form ?? "(script)", "| paragraphs:", (m?.text ?? "").split(/\n\n+/).length);
  console.log("OPENER:\n" + (m?.text ?? "").slice(0, 900));
  const sent = await api(page, "POST", `/api/companion/${id}`, { action: "send", text: "I hold up the thermos I brought. \"I wasn't sure you'd remember the bench. I almost didn't come.\"" });
  m = last(sent);
  console.log("\nreply:", sent.status, sent.data?.error ?? "-", "| form:", m?.form ?? "(script)");
  console.log("REPLY:\n" + (m?.text ?? "").slice(0, 900));
  const regen = await api(page, "POST", `/api/companion/${id}`, { action: "regenerate" });
  m = last(regen);
  console.log("\nregenerate:", regen.status, "| draws:", JSON.stringify(m?.draws ?? m?.alternates ?? null));
  const prev = await api(page, "POST", `/api/companion/${id}`, { action: "swipe", to: "prev" });
  const p = last(prev);
  console.log("swipe prev:", prev.status, prev.data?.error ?? "-", "| draws:", JSON.stringify(p?.draws ?? p?.alternates ?? null), "| same as first reply:", (p?.text ?? "").slice(0, 60) === (last(sent)?.text ?? "").slice(0, 60));
  const cont = await api(page, "POST", `/api/companion/${id}`, { action: "continue" });
  m = last(cont);
  console.log("continue:", cont.status, cont.data?.error ?? "-", "| form:", m?.form ?? "(script)", "| role:", m?.role);
  console.log("CONTINUED:\n" + (m?.text ?? "").slice(0, 600));
  await ctx.close();
  for (const [opts, size] of [[{ viewport: { width: 1280, height: 900 } }, "desktop"], [{ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "phone"]]) {
    const s = await open(opts);
    await s.page.goto(`${SHOW}/companion/${id}`, { waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(2500);
    await s.page.screenshot({ path: `${OUT}/story-mode-live-${size}.png` });
    console.log("shot", size);
    await s.ctx.close();
  }
  const back = await open({ viewport: { width: 1280, height: 900 } });
  await back.page.goto(`${SHOW}/account`, { waitUntil: "domcontentloaded" });
  console.log("back to texting:", (await api(back.page, "POST", `/api/companion/${id}`, { action: "scene", place: null })).status, "| style back to script:", (await api(back.page, "POST", "/api/writing-style", { style: "script" })).status);
  await back.ctx.close();
} catch (e) { console.error("FAILED:", e.message); } finally { await browser.close(); }
