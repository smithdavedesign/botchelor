// The content filter's word lists (lib/safety.ts: the terms, the real people it refuses) are the server's. A page's code in
// the browser loads them only where it runs the check as someone types: the builder (/create), the importer (/import) and
// the Create library. 2026-11-22 audit: they rode along on the home page, /prompts, every character page and the roleplay
// pickers, through modules that needed a number, a type or a picker helper from beside a check
// (lib/express-text.ts, lib/opening-choice.ts, lib/import-paths.ts, lib/studio/library-limits.ts, lib/safety-reasons.ts
// and the checks in lib/roleplay-check.ts and lib/scene-card-check.ts are the splits).
//
// This walks the imports the way the bundler does: from a page (server code) into its client components ("use client")
// and everything they import, skipping type-only imports, which never reach the browser.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const LISTS = join(ROOT, "lib/safety.ts");

const sources = new Map<string, string>();
const source = (file: string): string => {
  let s = sources.get(file);
  if (s === undefined) sources.set(file, (s = readFileSync(file, "utf8")));
  return s;
};

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : null;
  if (!base) return null; // a package
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** The modules a file loads at run time: its imports and re-exports, less the type-only ones. */
function imports(file: string): string[] {
  const s = source(file);
  const out: string[] = [];
  for (const m of s.matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    if (m[1]) continue;
    const clause = m[2].trim();
    const names = /^\{([^}]*)\}$/.exec(clause)?.[1].split(",").map((n) => n.trim()).filter(Boolean);
    if (names?.length && names.every((n) => n.startsWith("type "))) continue;
    const r = resolve(file, m[3]);
    if (r) out.push(r);
  }
  for (const m of s.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) {
    const r = resolve(file, m[1]);
    if (r) out.push(r);
  }
  return out;
}

const isClient = (file: string) => /^\s*["']use client["']/.test(source(file));

/** How the browser's code for `entry` reaches `target` (each file on the way), or null when it doesn't. */
function clientPath(entry: string, target: string): string[] | null {
  const start = join(ROOT, entry);
  const key = (f: string, client: boolean) => `${client ? "c" : "s"}:${f}`;
  const from = new Map<string, string | null>([[key(start, isClient(start)), null]]);
  const queue: [string, boolean][] = [[start, isClient(start)]];
  while (queue.length) {
    const [file, client] = queue.shift()!;
    if (client && file === target) {
      const path: string[] = [];
      for (let k: string | null = key(file, client); k; k = from.get(k) ?? null) path.unshift(relative(ROOT, k.slice(2)));
      return path;
    }
    for (const next of imports(file)) {
      const c = client || isClient(next);
      const k = key(next, c);
      if (!from.has(k)) {
        from.set(k, key(file, client));
        queue.push([next, c]);
      }
    }
  }
  return null;
}

describe("the content filter's word lists stay on the server", () => {
  it.each([
    "app/layout.tsx",
    "app/page.tsx",
    "app/characters/[id]/page.tsx",
    "app/prompts/page.tsx",
    "app/companion/[id]/page.tsx",
    "app/couples/[a]/[b]/page.tsx",
    "app/watch/page.tsx",
    "app/swipe/page.tsx",
    "app/matches/page.tsx",
    "app/showcase/page.tsx",
    "app/after-dark/[a]/[b]/page.tsx",
    "app/after-dark/step-in/page.tsx",
  ])("%s doesn't send them to the browser", (entry) => {
    expect(clientPath(entry, LISTS)).toBeNull();
  });

  it("the builder still does, for its check as you type (and so the walk above is seen to find a path)", () => {
    expect(clientPath("app/create/page.tsx", LISTS)).toEqual(expect.arrayContaining(["app/create/CreateWizard.tsx", "lib/safety.ts"]));
  });
});
