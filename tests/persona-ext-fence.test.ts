import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTENSIONS } from "@/lib/persona-ext";
import { manifestProblem } from "@/lib/persona-ext-host";
import { fencePaths } from "../scripts/persona-ext-fence.mjs";

/**
 * The fence around persona extensions (lib/persona-ext/types.ts, docs/persona-ext.md): code the self-improving loop's
 * fixer writes from a character's request can only be pure functions over its own data.
 */
const ROOT = join(__dirname, "..");
const EXT_DIR = join(ROOT, "lib/persona-ext");

const filesIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? filesIn(p) : [p];
  });

/** Nothing an extension may reach: the network, the database, the environment, timers, the page, code from strings. */
const FORBIDDEN: [RegExp, string][] = [
  [/\bfetch\s*\(/, "fetch"],
  [/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bnavigator\b/, "the network"],
  [/\bprocess\b/, "process"],
  [/\brequire\s*\(/, "require"],
  [/\bimport\s*\(/, "dynamic import"],
  [/\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/, "code from strings"],
  [/\bglobalThis\b|\bwindow\b|\bdocument\b|\bself\./, "globals"],
  [/\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|\bqueueMicrotask\b/, "timers"],
  [/dangerouslySetInnerHTML|innerHTML/, "raw HTML"],
  [/\bReflect\b|\bProxy\b|__proto__|\bconstructor\s*\[/, "reflection"],
  [/["'`]use (server|client)["'`]/, "a Next.js boundary"],
];

describe("the persona-ext fence (docs/persona-ext.md)", () => {
  const files = filesIn(EXT_DIR);
  // What the checks read: the code without comments or plain string literals (words in a string can't run).
  const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');

  it("holds only TypeScript, and every import stays inside lib/persona-ext/", () => {
    for (const f of files) {
      const rel = relative(ROOT, f);
      expect(rel, `${rel}: extensions are .ts files`).toMatch(/\.ts$/);
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)) {
        const spec = m[1];
        expect(spec.startsWith("./") || spec.startsWith("../"), `${rel} imports ${spec}: only relative imports inside lib/persona-ext/`).toBe(true);
        const target = join(f, "..", spec);
        expect(relative(EXT_DIR, target).startsWith(".."), `${rel} imports ${spec}, outside lib/persona-ext/`).toBe(false);
      }
      for (const m of src.matchAll(/\bimport\s+["']([^"']+)["']/g)) expect.fail(`${rel}: a side-effect import (${m[1]})`);
      for (const [re, what] of FORBIDDEN) expect(re.test(codeOf(src)), `${rel} uses ${what}`).toBe(false);
    }
  });

  it("registers each extension once, from its own folder, with a sound manifest and a test", () => {
    const slugs = EXTENSIONS.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const e of EXTENSIONS) {
      expect(manifestProblem(e), `${e.slug}'s manifest`).toBe(null);
      expect(existsSync(join(EXT_DIR, e.slug)), `lib/persona-ext/${e.slug}/`).toBe(true);
      expect(existsSync(join(ROOT, "tests/persona-ext", `${e.slug}.test.ts`)), `tests/persona-ext/${e.slug}.test.ts`).toBe(true);
    }
    const folders = readdirSync(EXT_DIR).filter((f) => statSync(join(EXT_DIR, f)).isDirectory());
    for (const d of folders) expect(slugs, `lib/persona-ext/${d}/ is registered in index.ts`).toContain(d);
  });

  it("is reached by the app only through its index and its types", () => {
    const hits: string[] = [];
    const scan = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (f === "node_modules" || f.startsWith(".") || p === EXT_DIR) continue;
        if (statSync(p).isDirectory()) scan(p);
        else if (/\.(ts|tsx|mts)$/.test(f)) {
          for (const m of readFileSync(p, "utf8").matchAll(/from\s*["']([^"']*persona-ext\/[^"']+)["']/g)) if (!/persona-ext\/types$/.test(m[1])) hits.push(`${relative(ROOT, p)}: ${m[1]}`);
        }
      }
    };
    for (const d of ["app", "lib", "workers"]) if (existsSync(join(ROOT, d))) scan(join(ROOT, d));
    expect(hits).toEqual([]);
  });

  it("the CI path fence: a character-request branch may change only lib/persona-ext/ and tests/persona-ext/", () => {
    expect(fencePaths("loop/ext-12-bucket-list", ["lib/persona-ext/bucket_list/index.ts", "lib/persona-ext/index.ts", "tests/persona-ext/bucket_list.test.ts"])).toEqual([]);
    expect(fencePaths("loop/ext-12-bucket-list", ["lib/persona-ext/index.ts", "lib/safety.ts", "lib/persona-ext-host.ts"])).toEqual(["lib/safety.ts", "lib/persona-ext-host.ts"]);
    expect(fencePaths("loop/ext-12-bucket-list", ["lib/persona-ext/types.ts"])).toEqual(["lib/persona-ext/types.ts"]);
    expect(fencePaths("claude/some-branch", ["lib/safety.ts"])).toEqual([]);
  });
});
