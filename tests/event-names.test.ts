// Every named click on the site is stored (lib/event-name.ts). Until 2026-11-16, 123 of the 129 `data-track` names were
// written with hyphens, sent as written, and turned away by the server's rule: none was ever recorded. This reads every
// name in the source and holds it to the rule both sides now share.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_NAME, eventName } from "@/lib/event-name";
import { cleanBeacon } from "@/lib/engagement";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|mjs)$/.test(f) ? [p] : [];
  });

/** `data-track="name"` literals, and the `track: "name"` values a control takes its name from (lib/character-verb.ts). */
function names(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of [...files("app"), ...files("lib")]) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/data-track="([^"{}]+)"/g)) found.set(m[1], file);
    for (const m of src.matchAll(/\btrack(?:=|: )"([a-z0-9_-]+)"/g)) found.set(m[1], file);
  }
  return found;
}

describe("event names", () => {
  it("a hyphen is stored as an underscore, and nothing else changes", () => {
    expect(eventName("character-follow")).toBe("character_follow");
    expect(eventName("page_view")).toBe("page_view");
    expect(eventName("Bad Name")).toBeNull();
    expect(eventName("9lives")).toBeNull();
    expect(eventName("x".repeat(60))).toHaveLength(40);
    expect(EVENT_NAME.test("date_watched")).toBe(true);
  });

  it("every data-track name in the source is one the server keeps", () => {
    const all = names();
    expect(all.size).toBeGreaterThan(100);
    const lost = [...all].filter(([name]) => eventName(name) === null).map(([name, file]) => `${name} (${file})`);
    expect(lost).toEqual([]);
  });

  it("no two names collapse into one once hyphens are underscores", () => {
    const stored = new Map<string, string[]>();
    for (const name of names().keys()) stored.set(eventName(name)!, [...(stored.get(eventName(name)!) ?? []), name]);
    expect([...stored.values()].filter((v) => v.length > 1)).toEqual([]);
  });

  it("the server stores a hyphenated name from a page loaded before the fix", () => {
    const beacon = { v: "visitor-0001", s: "session-0001", events: [{ e: "character-follow", path: "/characters/abc", t: Date.now() }, { e: "Not A Name", path: "/", t: Date.now() }] };
    const clean = cleanBeacon(beacon, new Date());
    expect(clean?.events.map((e) => e.event)).toEqual(["character_follow"]);
  });
});
