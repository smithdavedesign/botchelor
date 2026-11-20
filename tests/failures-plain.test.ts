/**
 * Failures said plainly (mobile audit 2026-11-20, fix #13: C18, C21, A4): a refused admin queue is an error, never an
 * empty queue; a closed feature says "Not open yet", not 404; a neutral .notice isn't green.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { loadFailure } from "@/app/admin/showcase/Panel";
import NotOpenYet from "@/app/NotOpenYet";

describe("the admin showcase queue (C18)", () => {
  it("says a refused or failed load is a failure, never an empty queue", () => {
    expect(loadFailure(403)).toBe("Couldn't load the queue (403): sign in again as an admin. Nothing here means it's empty.");
    expect(loadFailure(401)).toContain("sign in again");
    expect(loadFailure(500)).toBe("Couldn't load the queue (500). Nothing here means it's empty.");
    expect(loadFailure(null)).toBe("Couldn't load the queue. Nothing here means it's empty.");
    const panel = readFileSync("app/admin/showcase/Panel.tsx", "utf8");
    expect(panel).not.toContain("r.ok ? r.json() : { posts: [] }");
    expect(panel).toMatch(/if \(failed\)\s*return \(\s*<p className="error" role="alert">/);
  });
});

describe("Not open yet (C21)", () => {
  it("names the feature, says it isn't open, and gives a way on", () => {
    const html = renderToStaticMarkup(createElement(NotOpenYet, { title: "Companions", children: "Soon." }));
    expect(html).toContain('<p class="kicker">Not open yet</p>');
    expect(html).toContain("<h1>Companions</h1>");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("isn&#x27;t on the show");
  });
  it("is what the companion pages show while closed, not notFound()", () => {
    for (const p of ["app/companion/page.tsx", "app/companion/plan/page.tsx"]) {
      const src = readFileSync(p, "utf8");
      expect(src, p).toContain("<NotOpenYet");
      expect(src, p).not.toContain("notFound()");
    }
  });
});

describe(".notice (A4)", () => {
  it("is neutral, and green only as .notice-ok", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\n\.notice \{\n  color: inherit;/);
    expect(css).toMatch(/\n\.notice-ok \{\n  color: var\(--ok-text\);/);
  });
});
