// The show does not read After Dark (docs/data-model.md; the connected-model plan, stage 4). The rule was a sentence in
// every brief and one test about one table; nothing stopped a new show file from importing After Dark's code. This
// pins every such import that exists today (tests/adult-imports-baseline.json). A new one fails here until it is
// added to the baseline on purpose, which is the moment to ask whether the show needs it at all, or whether the piece
// it wants (a plain query, a label) belongs in a neutral module.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import baseline from "./adult-imports-baseline.json";

/** After Dark's own code and pages: they may import each other freely. */
const OWN = [/^lib\/adult\//, /^app\/after-dark\//, /^app\/api\/after-dark\//, /^app\/admin\/after-dark\//, /^app\/api\/admin\/after-dark\//];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?)$/.test(f) ? [p] : [];
  });

/** file → the After Dark modules it imports, for every file that isn't After Dark's own. */
function adultImports(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const file of [...files("lib"), ...files("app"), "proxy.ts"]) {
    const path = file.replace(/\\/g, "/");
    if (OWN.some((re) => re.test(path))) continue;
    const src = readFileSync(file, "utf8");
    const found = new Set<string>();
    for (const m of src.matchAll(/from\s+"([^"]+)"|import\("([^"]+)"\)/g)) {
      const spec = m[1] ?? m[2];
      const hit = /(?:^@\/lib\/adult\/|(?:^|\/)adult\/)([a-z0-9-]+)$/.exec(spec);
      // "./adult/x" from lib/, "../adult/x" from lib/<dir>/, "@/lib/adult/x" from anywhere.
      if (hit && (spec.startsWith("@/lib/adult/") || path.startsWith("lib/"))) found.add(hit[1]);
    }
    if (found.size) out[path] = [...found].sort();
  }
  return out;
}

describe("the show's imports of After Dark's code", () => {
  it("are exactly the ones pinned: a new one is a decision, not an accident", () => {
    const now = adultImports();
    const added: string[] = [];
    for (const [file, mods] of Object.entries(now)) {
      const known = new Set((baseline as Record<string, string[]>)[file] ?? []);
      for (const m of mods) if (!known.has(m)) added.push(`${file} → lib/adult/${m}`);
    }
    expect(added, "New imports of After Dark's code from show code. Move what you need to a neutral module, or add the line to tests/adult-imports-baseline.json and say why in the PR.").toEqual([]);
  });

  it("the baseline holds nothing that is gone (so it only ever shrinks or is changed on purpose)", () => {
    const now = adultImports();
    const stale: string[] = [];
    for (const [file, mods] of Object.entries(baseline as Record<string, string[]>)) for (const m of mods) if (!(now[file] ?? []).includes(m)) stale.push(`${file} → lib/adult/${m}`);
    expect(stale, "Remove these from tests/adult-imports-baseline.json: the import is gone.").toEqual([]);
  });
});
