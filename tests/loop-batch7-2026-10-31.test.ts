import { describe, expect, it } from "vitest";
import { pictureNoteKind, SETUP_NOTE_PREFIX } from "@/lib/adult/picture-notes";
import { PICTURES_OFF_NOTE } from "@/lib/adult/media";
import { APPEARANCE_MAX, BIO_MAX, DEALBREAKER_MAX, NAME_MAX, TRAIT_MAX, WANT_MAX } from "@/lib/field-limits";
import { SHEET_PROPS } from "@/lib/mcp/constants";
import { movePlace } from "@/lib/places";

// From the loop20 prod run 2026-10-31-1521 (~/.botchelor-loop/runs/2026-10-31-1521).
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("#1117: the MCP sheet's limits are the real ones", () => {
  it("SHEET_PROPS reads lib/field-limits.ts, so they can't drift again", () => {
    const p = SHEET_PROPS as Any;
    expect(p.name.maxLength).toBe(NAME_MAX);
    expect(p.bio.maxLength).toBe(BIO_MAX);
    expect(p.traits.items.maxLength).toBe(TRAIT_MAX);
    expect(p.want.maxLength).toBe(WANT_MAX);
    expect(p.dealbreaker.maxLength).toBe(DEALBREAKER_MAX);
    expect(p.appearance.maxLength).toBe(APPEARANCE_MAX);
    expect([TRAIT_MAX, WANT_MAX]).toEqual([50, 180]);
  });
});

describe("#1119: a car park isn't the botanic park", () => {
  it("keeps their own words for a car park, and a park is still the park", () => {
    expect(movePlace("the top floor of a car park", "Ana Ruiz", "Bo Lee")).toBe("elsewhere@the top floor of a car park");
    expect(movePlace("a multi-storey car-park roof", "Ana Ruiz", "Bo Lee")).toBe("elsewhere@a multi-storey car-park roof");
    expect(movePlace("the park", "Ana Ruiz", "Bo Lee")).toBe("botanic_park");
    expect(movePlace("my car", "Ana Ruiz", "Bo Lee")).toBeNull();
  });
});

describe("#1115: a setup step isn't a failed picture", () => {
  it("tells setup and status notes from real failures", () => {
    expect(pictureNoteKind(`${SETUP_NOTE_PREFIX} Odile needs a face and a body set in the Studio.`)).toBe("setup");
    expect(pictureNoteKind(PICTURES_OFF_NOTE)).toBe("status");
    expect(pictureNoteKind("This chapter's pictures are drawn: 📸 Picture this draws another.")).toBe("status");
    expect(pictureNoteKind("The picture didn't come through.")).toBe("failure");
  });
});
