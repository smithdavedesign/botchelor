// Show-ready (lib/show-ready.ts): which of the show's format moves a character's public card can carry, what would
// unlock the rest, the voice-kit check the show writer runs, the builder's two new details, and the moment card a
// creator posts (app/characters/[id]/moment.png).
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getMoment } from "@/app/characters/[id]/moment.png/route";
import { ExtrasInput, normaliseExtras, publicExtras, type CharacterExtras } from "@/lib/extras";
import { updateCharacterMemory } from "@/lib/memory";
import { showReadiness, SHOW_MOVES, voiceBreaks } from "@/lib/show-ready";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

describe("show readiness", () => {
  it("an empty card carries only the moves that need nothing, and asks first for what unlocks the most", () => {
    const r = showReadiness({});
    expect(r.ready).toEqual(["unequal_dates"]);
    expect(r.score).toBe(0);
    expect(r.unlock.find((u) => u.move === "hometowns")?.missing).toEqual(["hometown", "family"]);
    expect(r.asks).toHaveLength(7);
    expect(new Set(r.asks)).toEqual(new Set(["hello", "dodge", "upset", "annoyed", "hometown", "family", "villain_ok"]));
  });

  it("a full card carries the card-only moves; the rest wait on the record, then come in with it", () => {
    const full: CharacterExtras = {
      hometown: "a canal town",
      family: "A nan who trusts nobody",
      lines: { hello: "Hi.", dodge: "Ask the fog.", upset: "Well, that's that." },
      tells: { annoyed: "taps the table" },
      villain_ok: true,
    };
    const fresh = showReadiness(full);
    expect(fresh.score).toBe(100);
    expect(fresh.asks).toEqual([]);
    expect(fresh.ready.sort()).toEqual(["first_impression", "hometowns", "unequal_dates"]);
    expect(fresh.waiting.sort()).toEqual(["cliffhanger", "interruption", "reunion", "spinoff", "villain"]);
    const later = showReadiness(full, { rivals: 2, exited: true });
    expect(later.ready).toHaveLength(SHOW_MOVES.length);
  });

  it("a user's character is the villain only with its owner's yes; the house cast needs none", () => {
    expect(showReadiness({}, { rivals: 3 }).ready).not.toContain("villain");
    expect(showReadiness({ villain_ok: true }, { rivals: 3 }).ready).toContain("villain");
    const house = showReadiness({}, { rivals: 3, house: true });
    expect(house.ready).toContain("villain");
    expect(house.asks).not.toContain("villain_ok");
  });

  it("reads only the public card: a private fact never counts", () => {
    const e: CharacterExtras = { facts: [{ label: "Family", value: "secret twin", private: true }] };
    expect(publicExtras(e).facts).toBeUndefined();
    expect(showReadiness(e).score).toBe(0);
  });
});

describe("the voice-kit check", () => {
  const kit: CharacterExtras = { never_says: ["no worries"], lines: { hello: "Clear skies, light breeze, and you." } };
  it("catches a never-say and a sample line recited word for word", () => {
    expect(voiceBreaks("Oh, No worries at all.", kit)).toEqual(['uses a never-say: "no worries"']);
    expect(voiceBreaks("Clear skies, light breeze, and you again.", kit)).toEqual(['repeats their sample line "Clear skies, light breeze, and you."']);
  });
  it("passes a line in their rhythm that recites nothing", () => {
    expect(voiceBreaks("Overcast, a little drizzle, and then you walked in.", kit)).toEqual([]);
    expect(voiceBreaks("Anything at all.", null)).toEqual([]);
  });
});

describe("the builder's show details", () => {
  it("keeps who they'd bring home and the villain yes, and drops a no", () => {
    const e = normaliseExtras(ExtrasInput.parse({ family: "  Three cousins and a loud dog ", villain_ok: true }));
    expect(e).toEqual({ family: "Three cousins and a loud dog", villain_ok: true });
    expect(normaliseExtras(ExtrasInput.parse({ villain_ok: false }))).toEqual({});
    expect(() => ExtrasInput.parse({ family: "x".repeat(121) })).toThrow();
  });
});

describe("the moment card", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  const oc = async (name: string) => (await (await api.createCharacter(validCharacter({ name }), newUserCookie())).json()).id as string;
  const at = Date.UTC(2026, 9, 5, 12) / 1000;
  async function aired(a: string, b: string, visibility = "public") {
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides,
                             transcript, setup, drama_question, drama_answer, created_at, revealed_at, visibility)
       values ('ep-m', 'sys', $1, $2, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', 'second_date', 'ready', $3::jsonb, '[]'::jsonb,
               '{"venue":"rooftop_bar"}'::jsonb, 'leaves_first', 'neither', to_timestamp($4), to_timestamp($4), $5)`,
      [a, b, JSON.stringify([0, 1].map(() => ({ wants_another: true, agenda_met: true, satisfied: true, dealbreaker_hit: null, want_met: null, note_followed: null }))), at, visibility],
    );
  }
  const get = (id: string, q: string) => getMoment(new Request(`http://localhost/characters/${id}/moment.png?${q}`), { params: Promise.resolve({ id }) });

  it("draws a milestone they reached, in both sizes, and 404s one they haven't", async () => {
    const ira = await oc("Ira Fenn");
    const nell = await oc("Nell Abiodun");
    await aired(ira, nell);
    await updateCharacterMemory(t.db, ira);
    const og = await get(ira, "m=first_date");
    expect(og.status).toBe(200);
    // MOMENT_OUT=<dir> keeps the card to look at by eye.
    const png = Buffer.from(await og.arrayBuffer());
    expect(png.length).toBeGreaterThan(5000);
    if (process.env.MOMENT_OUT) writeFileSync(`${process.env.MOMENT_OUT}/moment-og.png`, png);
    expect(og.headers.get("content-type")).toBe("image/png");
    expect((await get(ira, "m=first_spark&format=story")).status).toBe(200);
    expect((await get(ira, "m=ten_dates")).status).toBe(404);
    expect((await get("nobody", "m=first_date")).status).toBe(404);
  });

  it("never draws a moment from a date that isn't public", async () => {
    const ira = await oc("Ira Fenn");
    const nell = await oc("Nell Abiodun");
    await aired(ira, nell, "unlisted");
    await updateCharacterMemory(t.db, ira);
    expect((await get(ira, "m=first_date")).status).toBe(404);
  });
});
