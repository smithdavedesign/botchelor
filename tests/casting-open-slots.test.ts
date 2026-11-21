/**
 * /casting's open places as controls (app/casting/OpenSlots.tsx; David 2026-11-21: "click the plus sign and choose one
 * of the characters to submit for audition"): each place is a button that opens the picker of your characters, or a
 * link to sign in when nobody is. Pure renders and source reads; who may apply is tests/auditions.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import OpenSlots from "@/app/casting/OpenSlots";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));

const read = (...p: string[]) => readFileSync(join(__dirname, "..", ...p), "utf8");
const mara = { id: "fan-1", name: "Mara Quill", hue: 300, portrait: "/api/assets/a", blocks: [] };

describe("the open places", () => {
  it("are buttons that open the picker when someone's here, one a place", () => {
    const html = renderToStaticMarkup(createElement(OpenSlots, { count: 5, picks: [mara], noun: "suitor", label: "December 2026" }));
    expect(html.match(/<li class="casting-slot is-open is-pickable">/g)).toHaveLength(5);
    expect(html.match(/<button type="button" class="casting-slot-pick" aria-haspopup="dialog" data-track="casting-slot-pick">/g)).toHaveLength(5);
    expect(html).toContain("a suitor: your character?");
    expect(html).toContain('<span class="sr-only">: choose one of your characters</span>');
    // The sheet isn't in the page until a place is pressed.
    expect(html).not.toContain("sheet-dialog");
  });

  it("send someone signed out to sign in, and come back here", () => {
    const html = renderToStaticMarkup(createElement(OpenSlots, { count: 2, picks: null, noun: null, label: "December 2026" }));
    expect(html.match(/<a class="casting-slot-pick" data-track="casting-slot-sign-in" href="\/account\?next=%2Fcasting">/g)).toHaveLength(2);
    expect(html).toContain("your character?");
    expect(html).not.toContain("<button");
  });

  it("apply with the owner's consent, through the character page's own audition route", () => {
    const src = read("app", "casting", "OpenSlots.tsx");
    expect(src).toContain("requestJson(`/api/characters/${p.id}/audition`, { consent: true })");
    expect(src).toContain('import type { AuditionPick } from "@/lib/auditions";');
    expect(src).not.toMatch(/import \{[^}]*\} from "@\/lib\/auditions"/);
    // The board redraws when they close the sheet, not as they apply: a refresh then would unmount the open places and
    // the sheet with them, and "Mara is in" would vanish before it could be read (found by npm run e2e:casting).
    expect(src).toMatch(/setApplied\(p\.name\);\n  \}/);
    expect(src).toMatch(/function close\(\) \{\s*setOpen\(false\);\s*if \(applied\) router\.refresh\(\);/);
    const page = read("app", "casting", "page.tsx");
    expect(page).toContain("<OpenSlots count={open} picks={picks} noun={def.lead ? words.noun : null} label={label} />");
    expect(page).toContain("auditionPicks(db, { userId: viewer, authenticated: auth?.authenticated === true })");
  });
});
