/**
 * The visual audit's two open follow-ups (2026-11-21): a read that drops an error's body unread holds its request open
 * (lib/ok-json.ts takes the place of `(r) => (r.ok ? r.json() : null)` everywhere), and the bell on the follow and
 * notify controls is the app's icon, not an emoji (app/Icon.tsx).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FollowButton } from "@/app/couples/[a]/[b]/CoupleActions";
import { okJson } from "@/lib/ok-json";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));

const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("okJson", () => {
  it("is the JSON of an ok response, exactly as r.json() reads it", async () => {
    expect(await okJson(new Response(JSON.stringify({ n: 3 }), { status: 200 }))).toEqual({ n: 3 });
    await expect(okJson(new Response("<html>not json</html>", { status: 200 }))).rejects.toThrow();
  });

  it("reads an error's body to the end and gives null, JSON or not", async () => {
    const denied = new Response(JSON.stringify({ error: "sign in" }), { status: 401 });
    expect(await okJson(denied)).toBeNull();
    expect(denied.bodyUsed).toBe(true);
    const broken = new Response("<html>Bad gateway</html>", { status: 502 });
    expect(await okJson(broken)).toBeNull();
    expect(broken.bodyUsed).toBe(true);
    expect(await okJson(new Response(null, { status: 404 }))).toBeNull();
  });

  it("is the only way the app reads a maybe-failed response: no read leaves an error's body unread", () => {
    const left = [...sources(join(root, "app")), ...sources(join(root, "lib"))]
      .filter((f) => !f.endsWith(join("lib", "ok-json.ts")))
      .filter((f) => /\((\w+)\) => \(\1\.ok \? \1\.json\(\) : (null|undefined)\)/.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f));
    expect(left).toEqual([]);
  });
});

describe("the bell is an icon", () => {
  it("on the couple's follow button, both ways", () => {
    const off = renderToStaticMarkup(createElement(FollowButton, { pair: ["a", "b"], following: false, followers: 0 }));
    expect(off).toMatch(/aria-pressed="false"><svg class="icon"[^>]*>[\s\S]*?<\/svg> Follow this couple<\/button>/);
    const on = renderToStaticMarkup(createElement(FollowButton, { pair: ["a", "b"], following: true, followers: 2 }));
    expect(on).toMatch(/aria-pressed="true"><svg class="icon"[^>]*>[\s\S]*?<\/svg> Following<\/button>/);
    expect(off + on).not.toMatch(/🔔|✓/);
  });

  it("on the character's follow, the notify-me button and the push prompt", () => {
    for (const f of [
      ["app", "couples", "[a]", "[b]", "CoupleActions.tsx"],
      ["app", "characters", "[id]", "HeaderActions.tsx"],
      ["app", "episodes", "[id]", "GeneratingPoller.tsx"],
      ["app", "notifications", "PushToggle.tsx"],
    ]) {
      const src = read(...f);
      expect(src, f.join("/")).not.toContain("🔔");
      expect(src, f.join("/")).toContain('<Icon name="bell" />');
    }
  });
});
