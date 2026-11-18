import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backdropPrompt, freeBackdropPrompt, FREE_BACKDROP_PROMPT_VERSION } from "../scripts/prompts.mjs";
import { venueBackdrop } from "@/lib/portraits";
import { placeProposal, venueFor } from "@/lib/places";
import { venueForPlan } from "@/lib/relationships";
import { SHOW_SET_PLATES, SHOW_SETS, showSetBackground, showSetPath } from "@/lib/show-sets";
import { DATE_VENUES } from "@/lib/venues";
import { sceneCatalog } from "@/lib/adult/scene-catalog";

const files = new Set(readdirSync(join(__dirname, "..", "public", "cast")));
const THEMED = ["gothic_manor", "countryside_picnic", "space_lounge", "cavern_lounge"] as const;

describe("the show's sets (PRD styles-and-storylines, phase 3)", () => {
  it("has the stage, the blind-date booth, the confessional and elimination, each a reviewed file on disk", () => {
    expect([...SHOW_SETS]).toEqual(["stage", "booth", "confessional", "elimination"]);
    for (const s of SHOW_SETS) {
      expect(showSetPath(s)).toBe(`/cast/set-${s}-v3.webp`);
      expect(files.has(`set-${s}-v3.webp`), s).toBe(true);
      expect(showSetBackground(s)).toContain(`url(${showSetPath(s)})`);
    }
  });

  it("draws every set empty: nobody in it and no lettering", () => {
    for (const [s, plate] of Object.entries(SHOW_SET_PLATES)) {
      expect(plate, s).toMatch(/^an empty\b/);
      expect(plate, s).not.toMatch(/\b(couple|host|crowd|people|person|man|woman|audience members?|contestants?)\b/i);
      expect(plate, s).not.toMatch(/\b(sign|logo|letters?|text|words?)\b/i);
    }
  });

  it("darkens a set more toward the bottom, where the words sit, and never past 0.94", () => {
    expect(showSetBackground("stage", 0.35)).toMatch(/rgba\(14,8,20,0\.35\) 0%, rgba\(14,8,20,0\.65\) 100%/);
    expect(showSetBackground("elimination", 0.8)).toContain("rgba(14,8,20,0.94) 100%");
  });
});

describe("the free backdrop prompt (backdrop-v3)", () => {
  it("is v2's plate without the dialogue overlay klein paints in, and asks for no text boxes or borders", () => {
    const plate = SHOW_SET_PLATES.confessional;
    expect(FREE_BACKDROP_PROMPT_VERSION).toBe("backdrop-v3");
    expect(backdropPrompt({ plate })).toContain("dialogue overlay");
    const free = freeBackdropPrompt({ plate });
    expect(free).toContain(`SCENE: ${plate}. Nobody in the frame.`);
    expect(free).not.toMatch(/overlay/);
    expect(free).toContain("the painting fills the whole frame edge to edge");
    expect(free).toContain("no text boxes, no captions, no borders");
  });
});

describe("the themed nights", () => {
  it("are dealt venues with a v3 backdrop on disk", () => {
    const ids = new Set<string>(DATE_VENUES.map((v) => v.id));
    for (const id of THEMED) {
      expect(ids.has(id), id).toBe(true);
      expect(venueBackdrop(id)).toBe(`/cast/venue-${id}-v3.webp`);
      expect(files.has(`venue-${id}-v3.webp`), id).toBe(true);
    }
  });

  it("have After Dark scene cards under their genres", () => {
    const catalog = sceneCatalog();
    const card = (id: string) => catalog.find((s) => s.id === `venue:${id}`);
    expect(card("gothic_manor")?.categories).toEqual(["mystery", "fantasy"]);
    expect(card("space_lounge")?.categories).toContain("scifi");
    expect(card("cavern_lounge")?.categories).toContain("fantasy");
    expect(card("countryside_picnic")?.tags).toContain("Cozy");
    for (const id of THEMED) expect(card(id)?.image).toBe(`/cast/venue-${id}-v3.webp`);
  });

  it("are where a plan or a move to one goes, while the places that were someone else's stay theirs", () => {
    const cases: [string, string][] = [
      ["A picnic in the meadow on Saturday? I'll bring far too much food", "countryside_picnic"],
      ["That gothic manor with the creaky library, after dark", "gothic_manor"],
      ["Drinks on the space station, if the gravity holds", "space_lounge"],
      ["The crystal cavern lounge, by the lava", "cavern_lounge"],
      ["A ghost tour of the old manor", "haunted_house"],
      ["Let's do the botanic park on Thursday instead.", "botanic_park"],
    ];
    for (const [text, venueId] of cases) expect(venueForPlan([{ text }]), text).toBe(venueId);
    expect(venueFor("a picnic")).toBe("countryside_picnic");
    // A cave someone named is their own place, not the cavern lounge.
    expect(placeProposal("I'd love to show you the caves.", "Brannoch Veil", "Hesper Oyelaran")).toEqual({ place: "elsewhere@the caves", strong: true });
  });
});
