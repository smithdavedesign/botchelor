import { describe, expect, it } from "vitest";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";
import { DATE_VENUES } from "@/lib/venues";
import {
  BACKDROP_PROMPT_VERSION,
  buildBatch,
  NEGATIVE_PROMPT,
  PORTRAIT_PROMPT_VERSION,
  portraitPrompt,
} from "../scripts/prompts.mjs";

/**
 * The portrait prompts. portrait-v1 was rejected in review, all seventeen: it gave the model an age
 * number and a clothing line but no presentation or physical description, so the cast came out as one
 * young face — several reading as teenagers, one in what looked like a school uniform. These tests pin
 * the fixes so a later prompt edit cannot quietly undo them. They do not replace the human review.
 */
describe("the portrait prompts", () => {
  const batch = buildBatch({ house: ALL_HOUSE_CHARACTERS, venues: DATE_VENUES });
  const portraits = batch.filter((j) => j.kind === "portrait");

  it("describes every character physically, with presentation and an explicit age", () => {
    for (const c of ALL_HOUSE_CHARACTERS) {
      expect(c.look.trim().length).toBeGreaterThan(40);
      expect(c.look).toMatch(/^an? (woman|man|heavyset man) /);
      const prompt = portraitPrompt(c);
      expect(prompt).toContain(c.look);
      expect(prompt).toContain(`Clearly ${c.age} years old`);
    }
  });

  it("gives every character a distinct look, not one face for the cast", () => {
    const looks = ALL_HOUSE_CHARACTERS.map((c) => c.look);
    expect(new Set(looks).size).toBe(looks.length);
  });

  it("states each older character's age as it shows on a face", () => {
    // v1's failure: nobody over thirty looked it. An older character's look must carry visible age.
    for (const c of ALL_HOUSE_CHARACTERS.filter((x) => x.age >= 40)) {
      expect(c.look, c.name).toMatch(/grey|silver|salt-and-pepper|weathered|smile lines|forties|fifties/);
    }
  });

  it("keeps the portrait prompt off the engine's appearance line", () => {
    // `appearance` is read by the engine for want/dealbreaker cues; the portrait uses `look` instead,
    // so physical detail can never change a date's outcome. v1's appearance-driven prompt also pulled
    // hands, boots and props into frame.
    for (const c of ALL_HOUSE_CHARACTERS) expect(portraitPrompt(c)).not.toContain(c.appearance);
  });

  it("negates what went wrong in v1", () => {
    for (const term of ["teenager", "youthful face", "school uniform", "bare chest", "open shirt", "real person"]) {
      expect(NEGATIVE_PROMPT).toContain(term);
    }
    for (const job of portraits) expect(job.negative).toBe(NEGATIVE_PROMPT);
  });

  it("versions every job, and keeps the version in each portrait's file name", () => {
    expect(PORTRAIT_PROMPT_VERSION).toBe("portrait-v2");
    for (const job of portraits) {
      expect(job.prompt_version).toBe(PORTRAIT_PROMPT_VERSION);
      // A regenerated version must never overwrite a rejected file or inherit its ledger row.
      expect(job.file).toBe(`${job.character_id}-v2.png`);
    }
    for (const job of batch.filter((j) => j.kind === "background")) {
      expect(job.prompt_version).toBe(BACKDROP_PROMPT_VERSION);
      expect(job.negative).toContain("people");
    }
  });

  it("is reproducible: one stable seed per job", () => {
    const again = buildBatch({ house: ALL_HOUSE_CHARACTERS, venues: DATE_VENUES });
    expect(again.map((j) => j.seed)).toEqual(batch.map((j) => j.seed));
    expect(new Set(batch.map((j) => j.seed)).size).toBe(batch.length);
  });
});
