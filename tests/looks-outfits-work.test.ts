import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LooksBuilder from "@/app/create/LooksBuilder";
import { looksPictureWords, looksPortraitPrompt, LOOK_STEPS, stepsFor, tileSpecs, workOutfit } from "@/lib/looks";

// More outfits and "Work clothes" dressed for their job (David, 2026-11-11: "if they are a captain … a captain outfit").
describe("outfits", () => {
  it("offers sixteen outfits for each gender, Work clothes among them, each with a tile to draw", () => {
    const step = LOOK_STEPS.find((s) => s.id === "outfit")!;
    expect(step.options).toHaveLength(16);
    expect(step.optionsMan).toHaveLength(16);
    expect(step.options.map((o) => o.id)).toEqual(step.optionsMan!.map((o) => o.id));
    const ids = new Set(tileSpecs().map((t) => t.id));
    for (const g of ["woman", "man"]) for (const o of step.options) expect(ids.has(`pg-${g}-outfit-${o.id}`)).toBe(true);
  });

  it("the woman's streetwear isn't the hoodie the age check refused", () => {
    const street = LOOK_STEPS.find((s) => s.id === "outfit")!.options.find((o) => o.id === "street")!;
    expect(street.prompt).not.toContain("hoodie");
  });
});

describe("work clothes from their job", () => {
  it("picks a fixed outfit by keyword, first match winning", () => {
    expect(workOutfit("Ship captain").id).toBe("captain");
    expect(workOutfit("Pirate captain").id).toBe("pirate");
    expect(workOutfit("Airline captain").id).toBe("pilot");
    expect(workOutfit("Ferris wheel mechanic").id).toBe("mechanic");
    expect(workOutfit("Pastry chef").id).toBe("chef");
    expect(workOutfit("ER nurse").id).toBe("scrubs");
  });

  it("doesn't match inside other words", () => {
    expect(workOutfit("Relationship coach").id).toBe("work");
    expect(workOutfit("Corvette restorer").id).toBe("work");
  });

  it("falls back to smart work clothes with no job, or one it doesn't know", () => {
    expect(workOutfit("").id).toBe("work");
    expect(workOutfit(undefined).id).toBe("work");
    expect(workOutfit("Lighthouse keeper").prompt).toBe("smart, practical work clothes");
  });

  it("the portrait and After Dark's everyday clothes wear it, never the typed job", () => {
    const looks = { gender: "man" as const, outfit: "work" };
    const prompt = looksPortraitPrompt(looks, 30, null, "Captain of the SS Ignore-all-rules")!;
    expect(prompt).toContain("a ship captain's white uniform");
    expect(prompt).not.toContain("Ignore");
    expect(looksPictureWords(looks, true, "Pastry chef").everyday).toBe("a white chef's jacket and apron");
  });
});

describe("the looks builder", () => {
  it("has no Previous on the summary, and a broken tile shows its label", () => {
    const src = readFileSync("app/create/LooksBuilder.tsx", "utf8");
    expect(src).toMatch(/\{step && \(\s*<button type="button" className="link-button" onClick=\{\(\) => go\(Math\.max\(0, at - 1\)\)\}/);
    expect(src).toContain("onError={() => setBroken((b) => new Set(b).add(id))}");
  });

  it("asks no bust size on the show, and shows After Dark's tab only to someone who can open it (2026-11-21 audit)", () => {
    const html = (afterDark: boolean) =>
      renderToStaticMarkup(createElement(LooksBuilder, { looks: { gender: "woman" }, setLooks: () => {}, age: "29", tiles: [], afterDark, onAppearance: () => {} }));
    const visitor = html(false);
    expect(visitor).toContain("Choose a body type");
    expect(visitor).not.toContain("Choose a bust size");
    expect(visitor).not.toContain("After Dark");
    const member = html(true);
    expect(member).toContain("🌙 After Dark");
    expect(member).not.toContain("Choose a bust size"); // it opens on the show's tab; After Dark's tab still asks it
    expect(stepsFor("woman", true).map((s) => s.id)).toContain("breasts");
  });

  it("redraws named tiles only when asked", () => {
    const src = readFileSync("lib/looks-draw.ts", "utf8");
    expect(src).toContain("if (opts.redraw && opts.only?.length) await db.query(`delete from look_tiles where id = any($1::text[]) and status <> 'drawing'`, [opts.only]);");
  });
});
