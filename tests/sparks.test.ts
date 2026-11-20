import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AFTER_DARK_SPARKS, SPARKS } from "@/lib/sparks";
import { ExtrasInput } from "@/lib/extras";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";
import { BIO_MAX, DEALBREAKER_MAX, NAME_MAX, TRAIT_MAX, WANT_MAX, APPEARANCE_MAX } from "@/lib/field-limits";
import { pickSample, SAMPLE_TRIES } from "@/app/create/CreateWizard";

const all = [...SPARKS, ...AFTER_DARK_SPARKS];

describe("the sparks (2026-11-20)", () => {
  it("are thirteen for the builder and one kept for After Dark", () => {
    expect(SPARKS).toHaveLength(13);
    expect(AFTER_DARK_SPARKS).toHaveLength(1);
  });

  it("fit every field's limit, are adults and carry valid extras", () => {
    for (const s of all) {
      expect(s.name.length, s.name).toBeLessThanOrEqual(NAME_MAX);
      expect(s.bio.length, s.name).toBeLessThanOrEqual(BIO_MAX);
      expect(s.want.length, s.name).toBeLessThanOrEqual(WANT_MAX);
      expect(s.dealbreaker.length, s.name).toBeLessThanOrEqual(DEALBREAKER_MAX);
      expect(s.appearance.length, s.name).toBeLessThanOrEqual(APPEARANCE_MAX);
      for (const t of s.traits) expect(t.length, s.name).toBeLessThanOrEqual(TRAIT_MAX);
      expect(Number(s.age), s.name).toBeGreaterThanOrEqual(18);
      expect(Number(s.age), s.name).toBeLessThanOrEqual(1000);
      expect(s.hue, s.name).toBeGreaterThanOrEqual(1);
      expect(s.hue, s.name).toBeLessThanOrEqual(360);
      expect(ExtrasInput.safeParse(s.extras).success, s.name).toBe(true);
    }
  });

  it("have tells with no pronouns, like the builder's samples", () => {
    for (const s of all) {
      for (const tell of Object.values(s.extras.tells ?? {})) expect(tell, s.name).not.toMatch(/\b(he|she|his|her|hers|him|himself|herself)\b/i);
    }
  });

  it("share no name with each other, the house cast or the builder's samples", () => {
    const wizard = readFileSync("app/create/CreateWizard.tsx", "utf8");
    const samples = [...wizard.matchAll(/\{ name: "([^"]+)", age: "/g)].map((m) => m[1]);
    expect(samples.length).toBeGreaterThanOrEqual(4);
    const taken = [...ALL_HOUSE_CHARACTERS.map((c) => c.name), ...samples].map((n) => n.split(" ")[0].toLowerCase());
    const firsts = all.map((s) => s.name.split(" ")[0].toLowerCase());
    expect(new Set(firsts).size).toBe(firsts.length);
    for (const f of firsts) expect(taken, f).not.toContain(f);
  });

  it("are dealt by the builder's sample button, and the After Dark one isn't", () => {
    const wizard = readFileSync("app/create/CreateWizard.tsx", "utf8");
    expect(wizard).toContain("pickSample([...SAMPLES, ...SPARKS], checkName)");
    expect(wizard).not.toContain("AFTER_DARK_SPARKS");
  });
});

describe("pickSample", () => {
  const pool = [{ name: "A One" }, { name: "B Two" }, { name: "C Three" }, { name: "D Four" }, { name: "E Five" }];
  const fixed = () => 0;

  it("deals the first sample in its order whose name is free", async () => {
    const asked: string[] = [];
    const out = await pickSample(pool, async (n) => (asked.push(n), { taken: asked.length < 3, free: ["Zed"] }), fixed);
    expect(asked).toHaveLength(3);
    expect(out.name).toBe(asked[2]);
    expect(out.sample.name).toBe(asked[2]);
  });

  it("stops after SAMPLE_TRIES and renames the last when all are taken", async () => {
    const asked: string[] = [];
    const out = await pickSample(pool, async (n) => (asked.push(n), { taken: true, free: ["Zed"] }), fixed);
    expect(asked).toHaveLength(SAMPLE_TRIES);
    expect(out.sample.name).toBe(asked[SAMPLE_TRIES - 1]);
    expect(out.name).toBe("Zed");
  });

  it("deals a sample as it is when the check fails", async () => {
    const out = await pickSample(pool, async () => null, fixed);
    expect(out.name).toBe(out.sample.name);
  });
});
