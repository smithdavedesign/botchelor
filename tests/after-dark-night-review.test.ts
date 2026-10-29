import { describe, expect, it } from "vitest";
import { cleanDoing } from "@/lib/adult/doing";
import { withoutSelfAddress } from "@/lib/adult/guards";
import { topicsOf, topicWordsSaid } from "@/lib/adult/quality";
import { doingNotPlace } from "@/lib/adult/scenes";
import { cleanPlaceLabel } from "@/lib/adult/studio";
import { studioMenu } from "@/lib/adult/studio-catalog";
import type { Character } from "@/lib/character";

// David's two test nights, 2026-10-26 (Coco × Sweet, Chud × Sweet): the small things.
describe("the night's small things", () => {
  it("nobody calls out their own name: the name goes, the rest stays", () => {
    expect(withoutSelfAddress("*Her whole body tenses as she shudders.* Fuck... Coco.", "Coco Delacroix-Santos", "Sweet thang")).toBe("*Her whole body tenses as she shudders.* Fuck...");
    // Every other line as written, its pauses kept (2026-10-26: each "..." had become ".").
    expect(withoutSelfAddress("*Her palms press flat against the glass.* It's... screaming for you.", "Juniper Vale", "Sweet thang")).toBe("*Her palms press flat against the glass.* It's... screaming for you.");
    expect(withoutSelfAddress("Yes, Coco. Right there.", "Coco Delacroix-Santos", "Sweet thang")).toBe("Yes. Right there.");
    expect(withoutSelfAddress("Coco.", "Coco Delacroix-Santos", "Sweet thang")).toBeNull();
    // The other's name, a name in an action, and saying who they are, stay.
    expect(withoutSelfAddress("*She shudders.* Oh, god—Coco—", "Sweet thang", "Coco Delacroix-Santos")).toBe("*She shudders.* Oh, god—Coco—");
    expect(withoutSelfAddress("*Coco pulls her close.* Stay.", "Coco Delacroix-Santos", "Sweet thang")).toBe("*Coco pulls her close.* Stay.");
    expect(withoutSelfAddress("I'm Coco, by the way.", "Coco Delacroix-Santos", "Sweet thang")).toBe("I'm Coco, by the way.");
  });

  it("a place is a place, not what they're doing there", () => {
    expect(doingNotPlace("Kneeling on the rug in the masquerade ballroom, Coco pinning Sweet beneath her as she climaxes.")).toBe(true);
    expect(doingNotPlace("Lying together in the bedroom")).toBe(true);
    for (const place of ["the bedroom of the seaside cottage", "the masquerade ballroom", "a wedding reception hall", "the spring garden"]) expect(doingNotPlace(place)).toBe(false);
  });

  it("a doing label keeps their names capitalised, and never talks about the writing", () => {
    expect(cleanDoing("coco takes control of the climax", ["Coco Delacroix-Santos", "Sweet thang"])).toBe("Coco takes control of the climax");
    expect(cleanDoing("basking in the afterglow of the 'finale'")).toBe("basking in the afterglow of the finale");
    expect(cleanDoing("speaking the premise aloud")).toBeNull();
    expect(cleanDoing("Sizing up the smug couple")).toBe("sizing up the smug couple");
  });

  it("an actress's work words include the stage's, though her sheet doesn't write them", () => {
    const sweet = { name: "Sweet thang", bio: "One of the hottest women in the world.", extras: { occupation: "actress" } } as unknown as Character;
    const topics = topicsOf(sweet);
    expect(topicWordsSaid("*nips at her ear* The finale is when you beg for it. What a performance, co-star.", topics)).toEqual(expect.arrayContaining(["finale", "performance"]));
    expect(topicWordsSaid("*pulls her onto the stage of the bed* Stay right there.", topics)).toEqual([]);
  });

  it("the Studio's menu opens on a pose, an outfit and a place, Filthy's acts last; its own places read cleanly (the audit, 2026-10-29)", () => {
    const ALL: Parameters<typeof studioMenu>[0] = { maxLevel: 3, hardNos: [], disabled: new Set(), pov: true };
    const ids = studioMenu(ALL, "woman").map((g) => g.id);
    expect(ids.slice(0, 3)).toEqual(["pose", "wardrobe", "place"]);
    expect(ids.at(-1)).toBe("filthy");
    expect(cleanPlaceLabel("street", ["Sweet"])).toBeNull();
    expect(cleanPlaceLabel("Lexis bedroom", ["Lexi", "Dex"])).toBe("Lexi's bedroom");
    expect(cleanPlaceLabel("the masquerade ballroom", ["Coco"])).toBe("the masquerade ballroom");
  });
});

