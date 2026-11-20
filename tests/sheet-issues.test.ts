/**
 * The builder's PG check, field by field (app/create/sheet-issues.ts): the same check the save runs (lib/safety.ts
 * sheetPgMatch), placed on the form. 2026-11-20: Chud's edit page refused every save with one line at the bottom that
 * named nothing, and fixing one field only met the next; twelve of his texts failed.
 */
import { describe, expect, it } from "vitest";
import { placedTexts, placeServerIssues, selectorOf, sheetIssues, type SheetDraft } from "@/app/create/sheet-issues";
import { extrasFields, normaliseExtras, SAMPLE_LINES, TELLS, TEXT_DETAIL_KEYS, type CharacterExtras } from "@/lib/extras";
import { checkSheetText, sheetPgIssue, sheetPgIssues, sheetPgMatch } from "@/lib/safety";

const BLANK: SheetDraft = { name: "", bio: "", traits: ["", "", ""], want: "", dealbreaker: "", appearance: "", voice: "", week: "", hiding: [], extras: {} };
const draft = (d: Partial<SheetDraft>): SheetDraft => ({ ...BLANK, ...d });

// The sheet as it was on 2026-11-20 (the fields that failed; the rest passed).
const CHUD = draft({
  name: "Chud the crusher",
  bio: "A professional footballer. Loves physical touch and will treat you well.",
  traits: ["allergic to small talk", "extremely attractive", "dominant"],
  want: "A wild first night that he hopes will lead back to his place for what every guys wants",
  dealbreaker: "They're boring or not into exploring in the bedroom",
  extras: {
    quirk: "trys to manipulate you into sleeping with him",
    hobbies: ["dating", "Night swimming", "Chess", "making you moan"],
    prompts: [{ id: "simple_pleasures", answer: "making you moan" }, { id: "dating_me_is_like", answer: "Winning in life" }],
    tells: { bored: "try and sleep with their date", nervous: "wink and with a smile" },
    pet_peeve: "prudes",
    guilty_pleasure: "eating ass",
    catchphrase: "Let's take this conversation back to my place",
    hidden_talent: "satisfying women at all costs",
    ideal_first_date: "drinks, fun, and straight back to my place for hooking up",
    facts: [{ label: "Best memory", value: "you handling my sausage tonight gif" }, { label: "favorite sport", value: "footy" }],
  },
});

describe("sheetPgMatch", () => {
  it("names the words that tripped it, and agrees with sheetPgIssue", () => {
    expect(sheetPgMatch("making you moan")).toEqual({ reason: "innuendo", phrase: "making you moan" });
    expect(sheetPgMatch("A wild first night, then back to his place")).toEqual({ reason: "innuendo", phrase: "wild first night" });
    expect(sheetPgMatch("Into kinky stuff")).toEqual({ reason: "sexual", phrase: "kinky" });
    expect(sheetPgMatch("A teenager at heart")).toEqual({ reason: "minor", phrase: "teenager" });
    expect(sheetPgMatch("Basically Taylor Swift")).toEqual({ reason: "real_person", phrase: "taylor swift" });
    expect(sheetPgMatch("Breakfast in bed on Sundays")).toBeNull();
    for (const t of ["eating ass", "prudes", "Graduated magna cum laude", "Sleeps with the window open", "n.s.f.w only"]) {
      expect(sheetPgMatch(t)?.reason ?? null, t).toBe(sheetPgIssue(t));
    }
  });

  it("sheetPgIssues lists every refused text where checkSheetText stops at the first", () => {
    const fields = { want: CHUD.want, bio: "Fine.", hobbies: ["Chess", "making you moan", "eating ass"] };
    expect(checkSheetText(fields)).toMatchObject({ ok: false, field: "want" });
    expect(sheetPgIssues(fields).map((i) => [i.field, i.index])).toEqual([["want", 0], ["hobbies", 1], ["hobbies", 2]]);
  });
});

describe("sheetIssues", () => {
  it("finds all twelve of Chud's, each on its step with the input to go to", () => {
    const issues = sheetIssues(CHUD);
    expect(issues.map((i) => `${i.step}:${i.key}`)).toEqual([
      "identity:want",
      "identity:dealbreaker",
      "voice:tell_bored",
      "details:extra_prompt_0",
      "details:hobby_3",
      "details:extra_quirk",
      "details:extra_catchphrase",
      "details:extra_hidden_talent",
      "details:extra_pet_peeve",
      "details:extra_guilty_pleasure",
      "details:extra_ideal_first_date",
      "facts:fact_value_0",
    ]);
    const quirk = issues.find((i) => i.key === "extra_quirk")!;
    expect(quirk).toMatchObject({ field: "quirk", label: "Quirk", reason: "innuendo", phrase: "sleeping with him" });
    expect(quirk.message).toContain("“sleeping with him”");
    expect(issues.find((i) => i.key === "extra_prompt_0")?.label).toBe("My simple pleasures");
    expect(issues.find((i) => i.key === "fact_value_0")?.label).toBe("Best memory");
    expect(selectorOf("hobby_3")).toBe('[name="hobby_3"], [data-issue="hobby_3"]');
  });

  it("a clean sheet has none, and blanks are never checked", () => {
    expect(sheetIssues(draft({ name: "Mara", bio: "Bakes at dawn.", traits: ["warm", "dry", "early"], want: "Someone who reads", dealbreaker: "Rudeness to waiters" }))).toEqual([]);
    expect(placedTexts(BLANK)).toEqual([]);
  });

  it("every field the server checks has a place on the form (a new detail must get one)", () => {
    const every: CharacterExtras = {
      ...Object.fromEntries(TEXT_DETAIL_KEYS.map((k) => [k, "x"])),
      kind: "other",
      kind_label: "x",
      hobbies: ["x"],
      prompts: [{ id: "geek_out", answer: "x" }],
      lines: Object.fromEntries(SAMPLE_LINES.map((l) => [l.id, "x"])),
      tells: Object.fromEntries(TELLS.map((t) => [t.id, "x"])),
      never_says: ["x"],
      facts: [{ label: "x", value: "x" }],
      hot_takes: ["x"],
      baggage: "x",
      wins_them_over: "x",
    } as CharacterExtras;
    const server = Object.entries(extrasFields(normaliseExtras(every)))
      .filter(([, v]) => (typeof v === "string" ? v : v?.length))
      .map(([k]) => k);
    const placed = new Set(placedTexts(draft({ extras: every })).map((p) => p.field));
    expect(server.filter((k) => !placed.has(k))).toEqual([]);
    for (const core of ["name", "bio", "traits", "want", "dealbreaker", "appearance", "voice", "this_week", "hiding"]) {
      const d = draft({ name: "x", bio: "x", traits: ["x"], want: "x", dealbreaker: "x", appearance: "x", voice: "x", week: "x", hiding: ["x"] });
      expect(placedTexts(d).some((p) => p.field === core), core).toBe(true);
    }
  });
});

describe("placeServerIssues", () => {
  it("places the server's list, by field and place in the list", () => {
    const placed = placeServerIssues(CHUD, {
      issues: [
        { field: "hobbies", index: 0, reason: "innuendo", phrase: "making you moan" },
        { field: "want", index: 0, reason: "innuendo", phrase: "wild first night" },
      ],
    });
    // The server counts only the texts it was sent: hobby 0 of the non-blank ones is the first chip.
    expect(placed.map((p) => p.key)).toEqual(["hobby_0", "want"]);
    expect(placed[1].message).toContain("“wild first night”");
  });

  it("falls back to the single field (a translated text, or an older server), with the server's message", () => {
    const placed = placeServerIssues(draft({ bio: "Un texto en otro idioma" }), { field: "bio", reason: "sexual", message: "Keep the character sheet free of sexual content." });
    expect(placed).toEqual([expect.objectContaining({ key: "bio", step: "identity", message: "Keep the character sheet free of sexual content." })]);
    expect(placeServerIssues(BLANK, { field: "bio" })).toEqual([]);
  });
});
