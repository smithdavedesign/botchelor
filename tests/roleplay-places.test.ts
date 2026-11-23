// Where each of After Dark's roleplays is set (lib/adult/roleplays.ts `at`). David, 2026-11-23: "A place for each card":
// a card on Step in's shelf started at the character's home whatever its story said. Each place was written from its
// own card, and whether it is out in public is read from its words by the same rule every place is read by
// (lib/adult/scenes.ts isPublicPlace). The list below is written out so that a change to a place, or to the public
// rules, shows up here as a diff: nothing gets held to a kiss, or let off it, by accident.
import { describe, expect, it } from "vitest";
import { ROLEPLAY_PLACE_MAX, ROLEPLAYS } from "@/lib/adult/roleplays";
import { venueSituation } from "@/lib/adult/scene-catalog";
import { isPublicPlace } from "@/lib/adult/scenes";
import { stepInPlaces } from "@/lib/adult/step-in";
import { checkAdultText, checkShowText } from "@/lib/safety";
import { setPrompt } from "@/lib/sets";
import { normalizeScene } from "@/lib/venues";

/** Out in public (other people are around: a kiss at most until the scene moves), or not. */
const OUT = true;
const IN = false;

const PLACES: Record<string, [place: string, out: boolean]> = {
  "neighbours": ["the landing between two flats, one door open", IN],
  "boss": ["the office after hours, two desks still lit", IN],
  "delivery": ["the open front door of a flat, late on a Thursday", IN],
  "handyman": ["the homeowner's kitchen, the leak fixed, the kettle on", IN],
  "roommates": ["the shared flat's kitchen at midnight", IN],
  "strangers-bar": ["a quiet bar on a weeknight, two stools apart", OUT],
  "no-names": ["a small table for two, far from anyone either one knows", IN],
  "hotel-mixup": ["the hotel room both key cards open", IN],
  "photo-shoot": ["the photo studio after the shoot, the lights cooling", IN],
  "bodyguard": ["the residence's sitting room, the door locked for the night", IN],
  "bodyguard-off-duty": ["a quiet bar on the bodyguard's night off", OUT],
  "bodyguard-gala": ["the emptied ballroom after the gala, the car waiting below", IN],
  "celebrity": ["a corner of a loud club party where nobody is looking", OUT],
  "exes": ["the quiet end of the gallery at a friend's opening", OUT],
  "friends": ["the usual sofa, a film on that neither is watching", IN],
  "rivals": ["the awards dinner in a hotel ballroom, seated side by side", OUT],
  "blind-date": ["the restaurant a friend picked, a table for two", OUT],
  "wedding": ["the singles' table by the dance floor at a wedding", OUT],
  "rival-spies": ["the same hotel bar, in yet another city", OUT],
  "vampire": ["the front door of an old house at midnight", IN],
  "royal": ["the candlelit corridor outside the royal chamber", IN],
  "starship": ["the starship's observation lounge on the night shift", IN],
  "your-rules": ["a lamplit room, two chairs pulled close together", IN],
  "dons-truce": ["a private dining room, a table too long for two", IN],
  "said-no": ["a small restaurant where nobody knows either name", OUT],
  "arranged-match": ["the book-lined study between two wings of a great house", IN],
  "off-duty": ["a rooftop above the city, two masks on the ledge", OUT],
  "anniversary-strangers": ["a hotel bar far enough from home to feel like elsewhere", OUT],
  "after-the-party": ["the hall at home, the front door just shut on the party", IN],
  "the-cold-one": ["the climbing gym at closing time, the music turned down", OUT],
  "slow-sunday": ["the sofa on a rainy Sunday, nowhere to be", IN],
  "after-the-cameras": ["the villa suite, every camera dark", IN],
  "summoned": ["the study, a chalk circle smudged on the floor", IN],
  "two-captains": ["the great cabin of a ship moored at the quay", IN],
  "home-again": ["the hall of the flat, a bag just dropped by the door", IN],
  "the-house": ["the private card room above the casino floor", IN],
  "the-final-night": ["the villa's terrace by the pool, every camera dark", IN],
  "gala-date": ["a balcony above the ballroom, the orchestra muffled", OUT],
  "closing-night": ["the restaurant's back kitchen on its last night", IN],
  "after-the-toast": ["the terrace at a wedding, the reception winding down", OUT],
  "masks-on": ["a curtained alcove off the dance floor of a masked party", OUT],
  "the-forge": ["the village forge after dark, a mended sword on the anvil", IN],
  "who-leads": ["the empty dance studio after closing, one song on repeat", IN],
  "haunted-inn": ["the low-beamed parlour of a storm-bound old inn", IN],
  "the-fitting": ["the closed tailor's shop, blinds down, one lamp lit", IN],
};

describe("where each roleplay is set", () => {
  it("every one of the show's roleplays has a place, and the list here is all of them", () => {
    expect(ROLEPLAYS.map((r) => r.id).sort()).toEqual(Object.keys(PLACES).sort());
    for (const rp of ROLEPLAYS) expect(rp.at.place, rp.id).toBe(PLACES[rp.id][0]);
  });

  it("is a phrase a prompt can say after \"at\": short, lower case first, plain words, and nothing the lines refuse", () => {
    for (const rp of ROLEPLAYS) {
      const { place, title } = rp.at;
      expect(place.length, rp.id).toBeLessThanOrEqual(ROLEPLAY_PLACE_MAX);
      expect(place, rp.id).toMatch(/^[a-z]/);
      expect(place, rp.id).not.toMatch(/[{}"]|[.!?]$/);
      // After Dark's own lines, and the show's (a set is only drawn for a place the show's check passes: lib/sets.ts).
      expect(checkAdultText({ place }).ok, rp.id).toBe(true);
      expect(checkShowText({ place }).ok, rp.id).toBe(true);
      expect(checkShowText({ title }).ok, rp.id).toBe(true);
      // What the scene's header shows: a name, capitalised, that fits beside the pin.
      expect(title, rp.id).toMatch(/^[A-Z]/);
      expect(title.length, rp.id).toBeLessThanOrEqual(48);
      expect(title, rp.id).not.toMatch(/[{}"]|[.!?]$/);
      // And it reads as a place in the sentence a set is drawn from.
      expect(setPrompt(place), rp.id).toContain(`A photograph of ${place}, completely empty`);
    }
  });

  it("is its own: no two roleplays share a place, and none is a place the catalog already has", () => {
    const keys = ROLEPLAYS.map((r) => normalizeScene(r.at.place));
    expect(new Set(keys).size).toBe(ROLEPLAYS.length);
    const catalog = new Set(stepInPlaces().map((p) => normalizeScene(p.place)));
    for (const rp of ROLEPLAYS) {
      expect(catalog.has(normalizeScene(rp.at.place)), rp.id).toBe(false);
      // Never one of the library's venues by another name: those bring a situation of their own with them.
      expect(venueSituation(rp.at.place), rp.id).toBeNull();
    }
  });

  it("reads as out in public exactly where the list says: a story set among other people is held to a kiss until it moves", () => {
    const read = Object.fromEntries(ROLEPLAYS.map((r) => [r.id, isPublicPlace(r.at.place)]));
    expect(read).toEqual(Object.fromEntries(Object.entries(PLACES).map(([id, [, out]]) => [id, out])));
    // A third of them, not most: the shelf is still mostly stories that start behind a door.
    expect(Object.values(read).filter(Boolean)).toHaveLength(15);
  });
});
