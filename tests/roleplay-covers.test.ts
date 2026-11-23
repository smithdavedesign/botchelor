// Cover pictures for Step in's roleplay cards (lib/adult/roleplay-covers.ts): each is a house character dressed for one
// side of a roleplay, in the story's place. The pictures are committed (public/cast) and AI-marked like the rest.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ROLEPLAY_COVERS } from "@/lib/adult/roleplay-covers";
import { ROLEPLAYS } from "@/lib/adult/roleplays";
import { readXmp } from "@/lib/ai-mark";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { checkShowText } from "@/lib/safety";

const ROOT = join(__dirname, "..");

describe("the covers", () => {
  const covers = Object.entries(ROLEPLAY_COVERS);

  it("are one for every roleplay, each of a house character, on a side the roleplay has", () => {
    expect(covers).toHaveLength(ROLEPLAYS.length);
    expect(covers).toHaveLength(45);
    for (const rp of ROLEPLAYS) expect(ROLEPLAY_COVERS[rp.id], rp.id).toBeTruthy();
    for (const [id, c] of covers) {
      const rp = ROLEPLAYS.find((r) => r.id === id);
      expect(rp, id).toBeTruthy();
      // Someone After Dark's cast can have: never a premium house character, who isn't in it (two covers were drawn of
      // them first, 2026-11-23, and their cards could never have shown them).
      expect(HOUSE_CHARACTERS.some((h) => h.id === c.character), `${id}: ${c.character}`).toBe(true);
      expect(PREMIUM_HOUSE_CHARACTERS.some((h) => h.id === c.character), `${id}: ${c.character}`).toBe(false);
      // The viewer is on the second side only where the roleplay has two roles to choose between: a roleplay with no
      // named roles is played with the viewer as its card's first person, and its picture shows the second.
      if (c.you === 1) expect(rp!.roles, id).toBeTruthy();
      expect(c.src, id).toBe(`/cast/roleplay-${id}-${c.character.replace(/^house-/, "")}.webp`);
    }
  });

  it("are shared out: every house character is on three covers, and no two covers are the same picture", () => {
    const times = new Map<string, number>();
    for (const [, c] of covers) times.set(c.character, (times.get(c.character) ?? 0) + 1);
    expect([...times.keys()].sort()).toEqual(HOUSE_CHARACTERS.map((h) => h.id).sort());
    for (const [who, n] of times) expect(n, who).toBe(3);
    expect(new Set(covers.map(([, c]) => c.src)).size).toBe(covers.length);
    expect(new Set(covers.map(([, c]) => c.alt)).size).toBe(covers.length);
  });

  it("are files the site serves: 4:3, a sensible size, marked as AI-made", async () => {
    for (const [id, c] of covers) {
      const file = join(ROOT, "public", c.src);
      expect(existsSync(file), c.src).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.length, id).toBeLessThan(160_000);
      const meta = await sharp(bytes).metadata();
      expect([meta.width, meta.height], id).toEqual([960, 720]);
      expect(readXmp(bytes) ?? "", id).toContain("trainedAlgorithmicMedia");
    }
  });

  it("say what they show in plain words anyone can read", () => {
    for (const [id, c] of covers) {
      expect(c.alt.length, id).toBeGreaterThan(30);
      expect(c.alt.length, id).toBeLessThan(160);
      expect(c.alt, id).not.toMatch(/[{}]/);
      // A cover is the show's own picture on After Dark's page: its words are held to the show's rating.
      expect(checkShowText({ alt: c.alt }).ok, id).toBe(true);
    }
  });
});
