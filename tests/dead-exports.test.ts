import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// No dead exports: a function or constant the site's code exports that nothing else names (no other file in app/ or
// lib/, no test, no script) and its own file doesn't use either is code nobody runs. The 2026-11-22 audit found 45;
// they're gone, and this keeps new ones out. Next.js's own exports (a page's metadata, a route's GET, the proxy's
// config…) don't count. An export for a later PR goes in with that PR; one used only inside its file drops `export`.
const ENTRY =
  /(^|\/)(page|layout|route|template|error|global-error|global-not-found|loading|not-found|forbidden|unauthorized|default|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.tsx?$/;
const CONVENTION = new Set([
  "default", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "metadata", "generateMetadata", "viewport",
  "generateViewport", "dynamic", "dynamicParams", "revalidate", "runtime", "fetchCache", "preferredRegion", "maxDuration",
  "generateStaticParams", "generateSitemaps", "generateImageMetadata", "contentType", "size", "alt", "experimental_ppr",
  "config", "middleware", "proxy", "register", "onRequestError",
]);

describe("exports", () => {
  it("are each used somewhere: by another file, a test or a script", () => {
    // Tracked files and new ones not yet added, so a branch's own new file counts as a user.
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.ts", "*.tsx", "*.mts", "*.mjs", "*.js", "*.cjs"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
    const filesWith = new Map<string, string[]>();
    for (const [f, s] of text) {
      for (const word of new Set(s.match(/[A-Za-z_$][\w$]*/g) ?? [])) {
        const list = filesWith.get(word);
        if (list) list.push(f);
        else filesWith.set(word, [f]);
      }
    }
    const site = files.filter((f) => /^(app|lib)\/.*\.tsx?$/.test(f) || /^(proxy|middleware|instrumentation|next\.config)\.ts$/.test(f));
    const dead: string[] = [];
    for (const f of site) {
      const s = text.get(f)!;
      for (const [, name] of s.matchAll(/^export (?:async )?(?:function\*?|const|let|var|class|enum) ([A-Za-z_$][\w$]*)/gm)) {
        if (CONVENTION.has(name) && (ENTRY.test(f) || !f.includes("/"))) continue;
        if (filesWith.get(name)!.some((g) => g !== f)) continue;
        const uses = s.match(new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g"))!.length;
        if (uses <= 1) dead.push(`${f}: ${name}`);
      }
    }
    expect(dead, "exported, and used nowhere: remove it (or the export keyword)").toEqual([]);
  });
});
