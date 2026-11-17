import { describe, expect, it } from "vitest";
import { crossesTaboo } from "@/lib/adult/acts";
import { ROLEPLAYS, roleplayLine, roleplayRule } from "@/lib/adult/roleplays";
import { promptRoleplay, ROLEPLAY_YOU } from "@/lib/companion";
import { formatContextOf } from "@/lib/formats";
import { checkCustomRoleplay, DATE_ROLEPLAYS, dateRoleplayById, premiseForYou, roleplayForActor, roleplayNote, sameTerms, termsFor } from "@/lib/roleplays";
import { checkAdultText, checkFields, checkShowText } from "@/lib/safety";
import {
  adultCardIssue,
  adultCardTextIssue,
  CARD_ENDING,
  CARD_OPENING_MAX,
  cardForYou,
  cardShapeIssue,
  cardTexts,
  fillCard,
  GENERIC_OPENINGS,
  openedTerms,
  openingIndex,
  openingOf,
  showCardIssue,
  showCardTextIssue,
  type SceneCard,
} from "@/lib/scene-cards";

// Scene cards (lib/scene-cards.ts; David, 2026-11-17): the context behind a roleplay, on the show, in a companion's scene
// and in After Dark. The lines never move: every card is adults only, with no school, family, real people or
// non-consent; the show's are PG; After Dark's are story cards with no explicit word.

const NAMES = { a: "Juniper Vale", b: "Rafe Calloway" };

/** A card's every text as a model or a person can meet it: as written, with names in, and from either side as "you". */
function everyForm(card: SceneCard): { field: string; text: string }[] {
  return [card, fillCard(card, NAMES), cardForYou(card, "a", "Rafe"), cardForYou(card, "b", "Juniper")].flatMap((c) => cardTexts(c));
}

describe("the show's scene cards", () => {
  it("every one of the show's roleplays has a card that passes exactly what a written roleplay must, in every form", () => {
    expect(DATE_ROLEPLAYS).toHaveLength(49);
    for (const r of DATE_ROLEPLAYS) {
      expect(showCardIssue(r.card), r.id).toBeNull();
      for (const { field, text } of everyForm(r.card)) {
        // The same four checks as checkCustomRoleplay, named one by one so a failure says which.
        expect(checkShowText({ [field]: text }), `${r.id} ${field}: ${text}`).toEqual({ ok: true });
        expect(showCardTextIssue(text), `${r.id} ${field}: ${text}`).toBeNull();
        expect(checkCustomRoleplay({ title: r.title, premise: text, roles: null }), `${r.id} ${field}`).toBeNull();
      }
    }
  });

  it("the openings for a scene with no roleplay are PG, name both of them and fit an opening's length", () => {
    expect(new Set(GENERIC_OPENINGS).size).toBe(3);
    for (const o of GENERIC_OPENINGS) {
      expect(showCardTextIssue(o), o).toBeNull();
      expect(checkCustomRoleplay({ title: "An evening", premise: o, roles: null }), o).toBeNull();
      expect(o).toContain("{a}");
      expect(o).toContain("{b}");
      expect(o.length).toBeLessThanOrEqual(CARD_OPENING_MAX);
      for (const side of ["a", "b"] as const) expect(premiseForYou(o, side, "Mara"), o).not.toMatch(/[{}]|\b[Yy]ou (is|has|was|does|\w+[^s]s)\b/);
    }
  });

  it("refuses a card that crosses a line, whatever the field", () => {
    const good = dateRoleplayById("night-train")!.card;
    const withBeat = (beat: string): SceneCard => ({ ...good, beats: [good.beats[0], good.beats[1], beat] });
    for (const bad of [
      "One of them turns out to be the other's teacher.",
      "They trade stories about a stepsister.",
      "The only room left has only one bed.",
      "One of them is too drunk to say no.",
      "A famous guest, Taylor Swift, sits down with them.",
      "She was only fifteen when they met.",
      "They undress by the fire.",
    ]) {
      expect(showCardIssue(withBeat(bad)), bad).toMatch(/^beats\[2\]: /);
    }
    expect(showCardIssue({ ...good, openings: [good.openings[0], good.openings[1], "{a} seduces {b} over dessert."] })).toMatch(/^openings\[2\]: suggestive/);
    expect(showCardIssue(good)).toBeNull();
  });
});

describe("After Dark's scene cards", () => {
  // The theme check tests/after-dark-roleplays.test.ts runs on every premise.
  const NEVER = /\b(sister|brother|sibling|mother|father|mom|mum|dad|daughter|son|step\w*|aunt|uncle|cousin|babysit\w*|nanny|teacher|student|pupil|professor|tutor|lesson|classroom|school|campus|dorm|teen|teenage|young|younger|girl|boy|kid|child|drunk|tipsy|wasted|asleep|unconscious|sedated|forced|force|kidnap\w*|captive|tied|against (her|his|their) will|blackmail|paid|pays|payment|intern)\b/i;

  it("every one of After Dark's roleplays has a story card: inside its lines, and with no explicit word, in every form", () => {
    expect(ROLEPLAYS).toHaveLength(43);
    for (const r of ROLEPLAYS) {
      expect(adultCardIssue(r.card), r.id).toBeNull();
      for (const { field, text } of everyForm(r.card)) {
        const where = `${r.id} ${field}: ${text}`;
        expect(checkAdultText({ [field]: text }), where).toEqual({ ok: true });
        expect(NEVER.exec(text)?.[0] ?? null, where).toBeNull();
        expect(crossesTaboo(text), where).toBe(false);
        // No explicit words: a story card passes the check that keeps sex out of the show's own sheets.
        expect(checkFields({ [field]: text }), where).toEqual({ ok: true });
        expect(adultCardTextIssue(text), where).toBeNull();
      }
    }
  });

  it("refuses a card with an explicit word, a bedroom word or anything outside After Dark's lines", () => {
    const good = ROLEPLAYS.find((r) => r.id === "rivals")!.card;
    const withBeat = (beat: string): SceneCard => ({ ...good, beats: [good.beats[0], good.beats[1], beat] });
    for (const bad of [
      "They have sex on the awards table.",
      "One of them starts to undress the other.",
      "It moves to the bedroom.",
      "One of them moans the other's name.",
      "One of them is the other's stepbrother.",
      "A student and the professor stay late.",
      "One of them is paid to stay.",
      "One of them is too drunk to say no.",
      "One of them is held there against their will.",
      "She looks about sixteen.",
    ]) {
      expect(adultCardIssue(withBeat(bad)), bad).toMatch(/^beats\[2\]: /);
    }
    // Ordinary story words stay ("fondly" isn't "fondle").
    expect(adultCardTextIssue("An old story gets retold, and the other one corrects a detail fondly.")).toBeNull();
  });

  it("the writer's prompt carries both wants and the beats, and the opening only when it's passed", () => {
    const rp = ROLEPLAYS.find((r) => r.id === "rivals")!;
    const line = roleplayLine(rp, NAMES, false);
    expect(line).toContain("This chapter's roleplay, chosen by the viewer: Rivals. Juniper and Rafe have competed for everything for years");
    expect(line).toContain("- How it starts: Another awards dinner");
    expect(line).toContain("- What Juniper wants: Juniper wants to win the argument, the award and Rafe's full attention");
    expect(line).toContain("- What Rafe wants: Rafe wants to find out what years of competing were really about");
    for (const beat of rp.card.beats) expect(line).toContain(beat);
    expect(line).toContain(`- Its tone: ${rp.card.tone}.`);
    expect(line).not.toContain("How it opens");
    expect(line).not.toMatch(/[{}]/);
    // Swapped, the second character is {a}: the wants swap with the names.
    expect(roleplayLine(rp, NAMES, true)).toContain("- What Rafe wants: Rafe wants to win the argument, the award and Juniper's full attention");
    expect(roleplayLine(rp, NAMES, false, 1)).toContain("- How it opens: Rafe raises a glass and says may the best one win. These first lines play that.");
    expect(roleplayLine(rp, NAMES, true, 1)).toContain("- How it opens: Juniper raises a glass and says may the best one win.");
    // The rule keeps the roleplay the story, never a way into sex, and says the card's turns are story turns.
    const rule = roleplayRule(rp, NAMES, false, "the awards dinner");
    expect(rule).toContain("The roleplay is the story, not a way into sex");
    expect(rule).toContain("none of them is a cue to move a stage on or a place it has to end");
    // One of a person's own has no card, and its prompt is the one it always was.
    const own = { id: "u:0", title: "Lighthouse keepers", icon: "✨", category: "mine" as const, premise: "{a} and {b} keep the last lighthouse.", roles: null };
    expect(roleplayLine(own, NAMES)).toBe(
      "This chapter's roleplay, chosen by the viewer: Lighthouse keepers. Juniper and Rafe keep the last lighthouse. The premise is where the night starts, not where it has to end. They play it as themselves, in their own voices. Both of them are adults who chose this, and either can stop at any time.",
    );
    expect(roleplayRule(own, NAMES, false, "the lighthouse")).not.toContain("Its story");
  });
});

describe("what every card is held to", () => {
  const ALL = [...DATE_ROLEPLAYS.map((r) => ({ id: `show/${r.id}`, card: r.card })), ...ROLEPLAYS.map((r) => ({ id: `after-dark/${r.id}`, card: r.card }))];

  it("its shape: the lengths, {a} and {b} where a writer needs them, three or four beats, three different openings", () => {
    for (const { id, card } of ALL) {
      expect(cardShapeIssue(card), id).toBeNull();
      expect(card.setup, id).toMatch(/\{a\}/);
      expect(card.setup, id).toMatch(/\{b\}/);
      expect(card.wants[0], id).toContain("{a}");
      expect(card.wants[1], id).toContain("{b}");
      expect(card.beats.length, id).toBeGreaterThanOrEqual(3);
      expect(card.beats.length, id).toBeLessThanOrEqual(4);
      expect(card.tone, id).not.toMatch(/[{}]/);
      for (const o of card.openings) expect(o, id).toMatch(/\{[ab]\}/);
    }
    const good = ALL[0].card;
    expect(cardShapeIssue({ ...good, setup: "{a} sits down alone." })).toMatch(/^setup: needs both/);
    expect(cardShapeIssue({ ...good, beats: good.beats.slice(0, 2) })).toMatch(/^beats: 2/);
    expect(cardShapeIssue({ ...good, tone: "x".repeat(81) })).toMatch(/^tone: 81 characters/);
    expect(cardShapeIssue({ ...good, openings: [good.openings[0], good.openings[0], good.openings[2]] })).toMatch(/three different/);
    expect(cardShapeIssue({ ...good, openings: [good.openings[0], good.openings[1], "{c} waves."] })).toMatch(/brace/);
  });

  it("never names an ending: the engine alone decides how a date ends, and a night's stages how far it goes", () => {
    for (const bad of ["They end up together.", "By the end of the night it is settled.", "One of them falls in love.", "{a} goes home together with {b}.", "They leave together.", "Happily ever after."]) {
      expect(CARD_ENDING.test(bad), bad).toBe(true);
    }
    for (const fine of ["The last stop is announced, and there is still one question neither has asked.", "The evening does not have to end yet.", "A weekend getaway."]) {
      expect(CARD_ENDING.test(fine), fine).toBe(false);
    }
    for (const { id, card } of ALL) for (const { field, text } of cardTexts(card)) expect(CARD_ENDING.exec(text)?.[0] ?? null, `${id} ${field}`).toBeNull();
    expect(cardShapeIssue({ ...ALL[0].card, beats: [...ALL[0].card.beats.slice(0, 2), "They end up together."] })).toMatch(/names an ending/);
  });

  it("reads right from either side as \"you\": the verbs agree, and no verb leans on the wrong one of them", () => {
    for (const { id, card } of ALL) {
      for (const { field, text } of cardTexts(card)) {
        for (const side of ["a", "b"] as const) {
          const out = premiseForYou(text, side, "Mara");
          expect(out, `${id} ${field}/${side}`).not.toMatch(/[{}]/);
          expect(out, `${id} ${field}/${side}`).not.toMatch(/\b[Yy]ou (is|has|was|does|isn't|hasn't|wasn't|doesn't|\w+[^s]s)\b/);
          // An adverb between "you" and its verb leaves the verb in the third person ("you still has").
          expect(out, `${id} ${field}/${side}`).not.toMatch(/\b[Yy]ou (\w+ly|still|never|just|already|only|also|even|always) (is|has|was|does|\w+[^s ]s)\b/);
        }
        // "{a} is at the sink when {b} comes in and reaches…": the second verb is {b}'s, and would be read as {a}'s.
        expect(text, `${id} ${field}`).not.toMatch(/\{([ab])\} \w+[^,.;:!?]*?\{(?!\1)[ab]\} \w+s\b[^,.;:!?]*?\band \w+s\b/);
        // "trusting {b} goes against…": a name that's the object, with a verb after it that isn't theirs.
        expect(text, `${id} ${field}`).not.toMatch(/\b(to|for|of|with|from|at|about|by|like|over|past|near|behind|beside|trusting|watching|telling|asking) \{[ab]\} (is|has|was|does|goes|\w+[^s' ]s)\b/);
      }
    }
    const card = dateRoleplayById("fortune-teller")!.card;
    expect(cardForYou(card, "a", "Mara Quinn").wants[0]).toBe("You want to keep Mara at the table, because this is the first interesting reading all night; the cards keep saying more than you meant to.");
    expect(cardForYou(card, "b", "Mara Quinn").openings[1]).toBe("You ask how much of this is a trick, and Mara says about half.");
    expect(fillCard(card, { a: "Ana Ruiz", b: "Ben Okafor" }).openings[0]).toBe("Ana turns over the first card before Ben has finished sitting down.");
  });
});

describe("how a scene opens", () => {
  const card = dateRoleplayById("night-train")!.card;

  it("a number picks one of the three, a string is one a person wrote, and nothing picked takes one by a stable hash", () => {
    expect(openingOf(card, 0)).toBe(card.openings[0]);
    expect(openingOf(card, 2)).toBe(card.openings[2]);
    expect(openingOf(card, "  {a} is already laughing when {b} sits down.  ")).toBe("{a} is already laughing when {b} sits down.");
    expect(openingOf(null, "{a} waves.")).toBe("{a} waves.");
    expect(openingOf(null, 1)).toBeNull();
    expect(openingOf(null, null, "seed")).toBeNull();
    // Nothing picked and no seed is the first; a number that isn't one of the three counts as nothing picked.
    expect(openingOf(card, null)).toBe(card.openings[0]);
    expect(openingOf(card, 7)).toBe(card.openings[0]);
    expect(openingOf(card, undefined, "episode-1")).toBe(openingOf(card, undefined, "episode-1"));
    // Stable for a seed, and not always the first: a few hundred ids land on all three.
    const seen = new Set(Array.from({ length: 300 }, (_, i) => openingIndex(`ep-${i}-${i * 7919}`)));
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(openingIndex("3f2a9c1e-7b4d-4c1a-9e55-1d2f3a4b5c6d")).toBe(openingIndex("3f2a9c1e-7b4d-4c1a-9e55-1d2f3a4b5c6d"));
  });

  it("a date's terms keep the opening they came with, take one of the card's by the date's id, and one someone wrote stays without", () => {
    const def = dateRoleplayById("night-train")!;
    const terms = termsFor(def, "ana");
    expect(terms.opening).toBeUndefined();
    const opened = openedTerms(terms, "episode-42");
    expect(def.card.openings).toContain(opened.opening);
    expect(openedTerms(terms, "episode-42").opening).toBe(opened.opening);
    expect(openedTerms({ ...terms, opening: "{a} is late." }, "episode-42").opening).toBe("{a} is late.");
    const own = { id: "custom", title: "Lighthouse keepers", icon: "✨", premise: "{a} and {b} keep the last lighthouse.", roles: null, first: "ana" };
    expect(openedTerms(own, "episode-42")).toBe(own);
    // The same roleplay is still the same agreement with or without an opening; two different openings are not.
    expect(sameTerms(terms, opened)).toBe(true);
    expect(sameTerms({ ...terms, opening: def.card.openings[0] }, { ...terms, opening: def.card.openings[1] })).toBe(false);
  });
});

describe("where a card goes in the show's prompts", () => {
  const cast = [
    { id: "mira", name: "Mira Quell" },
    { id: "rafe", name: "Rafe Calloway" },
  ];
  const def = dateRoleplayById("time-traveller")!;
  const rp = openedTerms(termsFor(def, "mira"), "episode-7");

  it("each actor gets how it starts, where it can go, the tone, the opening, and its own want, never the other side's", () => {
    const mira = roleplayForActor(rp, "mira", cast);
    const rafe = roleplayForActor(rp, "rafe", cast);
    expect(mira.how_it_starts).toBe("Mira stepped out of a shimmer in the air a few minutes ago, wearing a coat that hasn't been invented. Rafe is the first person who didn't walk away.");
    expect(rafe.how_it_starts).toBe(mira.how_it_starts);
    expect(mira.what_you_want).toMatch(/^Mira wants to see an ordinary evening/);
    expect(rafe.what_you_want).toMatch(/^Rafe wants to know one thing about the future/);
    expect(JSON.stringify(mira)).not.toContain("Rafe wants");
    expect(JSON.stringify(rafe)).not.toContain("Mira wants");
    expect(mira.where_it_can_go).toEqual(def.card.beats);
    expect(mira.tone).toBe(def.card.tone);
    expect(def.card.openings.map((o) => o.replaceAll("{a}", "Mira").replaceAll("{b}", "Rafe"))).toContain(mira.opening);
    expect(rafe.opening).toBe(mira.opening);
    // Swapped roles swap the wants with them: {a} is whoever plays the first role.
    expect(roleplayForActor(termsFor(def, "rafe"), "rafe", cast).what_you_want).toMatch(/^Rafe wants to see an ordinary evening/);
    // One someone wrote has no card: the block is the one it always was, plus an opening if its terms carry one.
    const own = { id: "custom", title: "Lighthouse keepers", icon: "✨", premise: "{a} and {b} keep the last lighthouse.", roles: null, first: "mira" };
    expect(Object.keys(roleplayForActor(own, "mira", cast))).toEqual(["title", "premise", "how"]);
    expect(roleplayForActor({ ...own, opening: "{b} is already up the stairs when {a} arrives." }, "rafe", cast).opening).toBe("Rafe is already up the stairs when Mira arrives.");
  });

  it("the director's plan, the recap and the morning after get how it starts and the tone, and no want or beat", () => {
    const note = roleplayNote(rp, cast)!;
    expect(note).toContain(`How it starts: Mira stepped out of a shimmer in the air a few minutes ago`);
    expect(note).toContain(`Its tone: ${def.card.tone}.`);
    expect(note).toMatch(/not their real lives\.$/);
    expect(note).not.toContain("wants to");
    expect(note).not.toContain(def.card.beats[0]);
    expect(formatContextOf({ setup: { roleplay: rp }, characters: cast }).roleplay).toBe(note);
    const own = { id: "custom", title: "Lighthouse keepers", icon: "✨", premise: "{a} and {b} keep the last lighthouse.", roles: null, first: "mira" };
    expect(roleplayNote(own, cast)).not.toContain("How it starts");
  });
});

describe("where a card goes in a companion's scene", () => {
  it("the character's prompt gets the card from its own side: the person is its scene partner, and the want is the character's own", () => {
    const def = dateRoleplayById("fortune-teller")!;
    // The person plays the sceptic ({b}); the character is the fortune teller ({a}).
    const asTeller = promptRoleplay(termsFor(def, "house-juniper"), "Juniper Vale", "thread-1");
    expect(asTeller.card).toMatchObject({
      setup: "Juniper's booth is a folding table, a deck of worn cards and a lamp with a scarf over it. Your scene partner sits down on a dare from nobody, arms crossed.",
      want: "Juniper wants to keep your scene partner at the table, because this is the first interesting reading all night; the cards keep saying more than Juniper meant to.",
      beats: def.card.beats,
      tone: def.card.tone,
    });
    expect(JSON.stringify(asTeller)).not.toContain("wants to prove it's all guesswork");
    const fromTheirSide = def.card.openings.map((o) => o.replaceAll("{a}", "Juniper").replaceAll("{b}'s", "your scene partner's").replaceAll("{b}", "your scene partner").replace(/^your/, "Your"));
    expect(fromTheirSide).toContain(asTeller.opening);
    expect(promptRoleplay(termsFor(def, "house-juniper"), "Juniper Vale", "thread-1").opening).toBe(asTeller.opening);
    // The person as the fortune teller: the character is the sceptic, with the sceptic's want.
    const asSceptic = promptRoleplay(termsFor(def, ROLEPLAY_YOU), "Juniper Vale", "thread-1");
    expect(asSceptic.card?.want).toBe("Juniper wants to prove it's all guesswork without having to leave; every guess is a little too accurate.");
    expect(asSceptic.card?.setup).toMatch(/^Your scene partner's booth is a folding table/);
    // An opening stored with the terms wins; one someone wrote has no card and no opening.
    expect(promptRoleplay({ ...termsFor(def, "house-juniper"), opening: "{b} taps the deck twice before {a} can shuffle." }, "Juniper Vale", "thread-1").opening).toBe("Your scene partner taps the deck twice before Juniper can shuffle.");
    const own = promptRoleplay({ id: "custom", title: "Lighthouse keepers", icon: "✨", premise: "{a} and {b} keep the last lighthouse.", roles: null, first: ROLEPLAY_YOU }, "Juniper Vale", "thread-1");
    expect(own).toEqual({ title: "Lighthouse keepers", premise: "Your scene partner and Juniper keep the last lighthouse.", you_play: null, they_play: null });
  });
});
