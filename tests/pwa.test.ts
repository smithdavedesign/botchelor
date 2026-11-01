// Botchelor as an installable app (lib/pwa.ts): the manifest route, its PG icons, the iOS tags, the service worker's
// notification icons, and the once-only "Install the app" hint that never shows on After Dark.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { metadata, viewport } from "@/app/layout";
import manifest from "@/app/manifest";
import { config } from "@/middleware";
import {
  APP_ICONS,
  APP_NAME,
  APPLE_TOUCH_ICON,
  INSTALL_HINT_KEY,
  installHintPathBlocked,
  installSteps,
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
  PAPER_DARK,
  PAPER_LIGHT,
  platformOf,
  shouldShowInstallHint,
  type InstallContext,
} from "@/lib/pwa";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const publicFile = (src: string) => join(ROOT, "public", src);

/** A PNG's width, height and colour type (2 = RGB, 6 = RGBA), from its IHDR chunk. */
function png(src: string) {
  const b = readFileSync(publicFile(src));
  expect(b.subarray(0, 8).toString("hex"), `${src} is a PNG`).toBe("89504e470d0a1a0a");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PIXEL = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const INSTAGRAM = `${IPHONE} Instagram 300.0.0.0`;

describe("the manifest (/manifest.webmanifest)", () => {
  const m = manifest();

  it("installs the show as Botchelor, standalone, from the home page, in the brand's paper", () => {
    expect(m).toMatchObject({ id: "/", name: "Botchelor", short_name: "Botchelor", start_url: "/", scope: "/", display: "standalone" });
    expect(APP_NAME).toBe("Botchelor");
    // docs/brand.md's --paper, light (the manifest has one colour; the page's theme-color meta handles dark).
    const css = readFileSync(join(ROOT, "app", "globals.css"), "utf8");
    expect(css).toContain(`--paper: ${PAPER_LIGHT};`);
    expect(css).toContain(`--paper: ${PAPER_DARK};`);
    expect(m.background_color).toBe(PAPER_LIGHT);
    expect(m.theme_color).toBe(PAPER_LIGHT);
    expect(m.description).toBeTruthy();
  });

  it("lists 192 and 512 icons and a maskable one, each a PNG of the size it says", () => {
    expect(m.icons).toEqual(APP_ICONS.map((i) => ({ ...i })));
    const purposes = (m.icons ?? []).map((i) => `${i.sizes} ${i.purpose}`);
    expect(purposes).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const icon of m.icons ?? []) {
      const [w, h] = String(icon.sizes).split("x").map(Number);
      expect(png(icon.src), icon.src).toMatchObject({ width: w, height: h });
      expect(icon.type).toBe("image/png");
    }
    // Maskable fills its square to the edges (no transparent corners for the system's mask to show).
    expect(png("/icons/icon-maskable-512.png").colorType).toBe(2);
  });

  it("never names After Dark or anything adult", () => {
    expect(JSON.stringify(m)).not.toMatch(/after.?dark|adult|nsfw|explicit|18\+/i);
  });

  it("is served past the 18+ gate, like the icons and the service worker (middleware never runs on files)", () => {
    const gated = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/sw.js", "/icon.svg"]) {
      expect(gated.test(path), path).toBe(false);
    }
    expect(gated.test("/watch")).toBe(true);
  });
});

describe("the iPhone tags and theme colour (app/layout.tsx)", () => {
  it("declares the Home Screen icon (180×180, opaque) and opens as its own app", () => {
    expect(metadata.icons).toMatchObject({
      icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
      apple: [{ url: APPLE_TOUCH_ICON, sizes: "180x180", type: "image/png" }],
    });
    const apple = png(APPLE_TOUCH_ICON);
    expect(apple).toMatchObject({ width: 180, height: 180 });
    // iOS fills transparency with black: the Home Screen tile is opaque.
    expect(apple.colorType).toBe(2);
    expect(metadata.appleWebApp).toEqual({ capable: true, title: "Botchelor", statusBarStyle: "default" });
  });

  it("paints the browser bar in the page's paper, light and dark", () => {
    expect(viewport.themeColor).toEqual([
      { media: "(prefers-color-scheme: light)", color: PAPER_LIGHT },
      { media: "(prefers-color-scheme: dark)", color: PAPER_DARK },
    ]);
  });
});

describe("notifications (public/sw.js)", () => {
  const sw = readFileSync(publicFile("sw.js"), "utf8");

  it("show the PG tile, with the heart alone as Android's badge", () => {
    expect(sw).toContain(`const ICON = "${NOTIFICATION_ICON}";`);
    expect(sw).toContain(`const BADGE = "${NOTIFICATION_BADGE}";`);
    expect(png(NOTIFICATION_ICON)).toMatchObject({ width: 192, height: 192 });
    // A badge is drawn from its shape: white on transparent.
    expect(png(NOTIFICATION_BADGE)).toMatchObject({ width: 96, height: 96, colorType: 6 });
  });

  it("never take a picture from the push itself: what a notification shows is fixed here", () => {
    expect(sw).toMatch(/icon: ICON,\s*badge: BADGE,/);
    expect(sw).not.toMatch(/data\.(icon|image|badge)/);
    expect(existsSync(publicFile("icon.svg"))).toBe(true);
  });
});

describe("the install hint", () => {
  const phone = (over: Partial<InstallContext> = {}): InstallContext => ({ pathname: "/", phone: true, standalone: false, stored: null, ua: IPHONE, hasCharacter: true, ...over });

  it("shows on a phone's browser, once: after it's been shown, dismissed or installed, never again", () => {
    expect(INSTALL_HINT_KEY).toBe("bz_install_hint");
    expect(shouldShowInstallHint(phone())).toBe(true);
    expect(shouldShowInstallHint(phone({ ua: PIXEL, pathname: "/watch" }))).toBe(true);
    for (const stored of ["shown", "dismissed", "installed"]) expect(shouldShowInstallHint(phone({ stored })), stored).toBe(false);
  });

  it("waits until they have a character, so there's someone to hear from (2026-10-31 UX audit)", () => {
    expect(shouldShowInstallHint(phone({ hasCharacter: false }))).toBe(false);
  });

  it("not on a desktop, not inside the installed app, not in an app's own browser", () => {
    expect(shouldShowInstallHint(phone({ phone: false }))).toBe(false);
    expect(shouldShowInstallHint(phone({ standalone: true }))).toBe(false);
    expect(shouldShowInstallHint(phone({ ua: INSTAGRAM }))).toBe(false);
  });

  it("never on After Dark (or its admin pages), the admin pages, the 18+ gate or an email link", () => {
    for (const p of ["/after-dark", "/after-dark/a/b", "/after-dark/subscribe", "/admin/after-dark/graph", "/After-Dark", "/admin", "/admin/feedback", "/gate", "/email/unsubscribe"]) {
      expect(installHintPathBlocked(p), p).toBe(true);
      expect(shouldShowInstallHint(phone({ pathname: p })), p).toBe(false);
    }
    for (const p of ["/", "/watch", "/characters/after-darkness", "/account", "/notifications"]) expect(installHintPathBlocked(p), p).toBe(false);
  });

  it("knows an iPhone, an iPad (which asks as a Mac with touch) and Android, and says how to install on each", () => {
    expect(platformOf(IPHONE)).toBe("ios");
    expect(platformOf(IPAD, 5)).toBe("ios");
    expect(platformOf(IPAD, 0)).toBe("other");
    expect(platformOf(PIXEL)).toBe("android");
    expect(installSteps("ios")).toMatch(/Share.*Add to Home Screen/);
    expect(installSteps("android")).toMatch(/Install app|Add to Home screen/);
  });
});
