// Zod without eval (lib/zod-config.ts, 2026-11-22): its object schemas used to test `new Function("")`, which the
// Report-Only Content-Security-Policy reported from /create and /import on every load. The switch is set before any
// schema is built, in the browser (instrumentation-client.ts) and on the server (instrumentation.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import "@/lib/zod-config";
import { z } from "zod";

describe("zod without eval (lib/zod-config.ts)", () => {
  it("builds and parses object schemas without calling new Function", () => {
    const real = globalThis.Function;
    const made: string[] = [];
    globalThis.Function = new Proxy(real, {
      construct(target, args) {
        made.push(String(args.at(-1)).slice(0, 80));
        return Reflect.construct(target, args);
      },
    });
    let parsed: unknown = null;
    let refused = false;
    try {
      const schema = z.object({ name: z.string().min(1), age: z.number().int().optional(), tags: z.array(z.object({ id: z.string() })) });
      parsed = schema.parse({ name: "Ada", tags: [{ id: "a" }], extra: 1 });
      refused = !schema.safeParse({ name: "", tags: [] }).success;
    } finally {
      globalThis.Function = real;
    }
    expect(parsed).toEqual({ name: "Ada", tags: [{ id: "a" }] });
    expect(refused).toBe(true);
    expect(made).toEqual([]);
    expect(z.config().jitless).toBe(true);
  });

  it("is set by the browser's first file and by the server's, before the app's own code", () => {
    expect(readFileSync("instrumentation-client.ts", "utf8")).toMatch(/^import "\.\/lib\/zod-config";$/m);
    expect(readFileSync("instrumentation.ts", "utf8")).toMatch(/^import "\.\/lib\/zod-config";$/m);
  });
});
