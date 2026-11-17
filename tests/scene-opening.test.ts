import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { POST as actRoute } from "@/app/api/companion/[id]/route";
import RoleplayPicker, { openingsShown, roleplayFields } from "@/app/RoleplayPicker";
import { setCompanionModelForTests } from "@/lib/companion";
import { bookingAsk, resolveTerms } from "@/lib/date-roleplays";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { dateRoleplayById } from "@/lib/roleplays";
import { CARD_OPENING_MAX, GENERIC_OPENINGS } from "@/lib/scene-cards";
import { openingField, resolveOpening } from "@/lib/scene-opening";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, signedInCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// An opening you choose (the roleplay audit, 2026-11-17, item 2; lib/scene-opening.ts): after the place and the
// roleplay, one of its three openings, any of them, or a sentence of your own. Untouched, the scene opens as before.

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const STOWAWAY = dateRoleplayById("stowaway")!;

describe("what a picker's opening names", () => {
  it("is one of the three by its index, a checked sentence of their own, or nothing", () => {
    const three = STOWAWAY.card.openings;
    expect(resolveOpening(undefined, three)).toEqual({ ok: true, opening: null });
    expect(resolveOpening("", three)).toEqual({ ok: true, opening: null });
    expect(resolveOpening("   ", three)).toEqual({ ok: true, opening: null });
    expect(resolveOpening(0, three)).toEqual({ ok: true, opening: three[0] });
    expect(resolveOpening(2, three)).toEqual({ ok: true, opening: three[2] });
    expect(resolveOpening("1", three)).toEqual({ ok: true, opening: three[1] });
    expect(resolveOpening(3, three)).toMatchObject({ ok: false, status: 422, error: "invalid_opening" });
    expect(resolveOpening(1.5, three)).toMatchObject({ ok: false, error: "invalid_opening" });
    expect(resolveOpening(true, three)).toMatchObject({ ok: false, error: "invalid_opening" });
    // Nothing to pick from (a roleplay someone wrote): only a written one.
    expect(resolveOpening(1, null)).toMatchObject({ ok: false, error: "invalid_opening", message: expect.stringContaining("write one of your own") });
    expect(resolveOpening("  I'm halfway through a crossword   when she sits down. ", null)).toEqual({ ok: true, opening: "I'm halfway through a crossword when she sits down." });
    expect(resolveOpening("x".repeat(CARD_OPENING_MAX), null)).toMatchObject({ ok: true });
    expect(resolveOpening("x".repeat(CARD_OPENING_MAX + 1), null)).toMatchObject({ ok: false, error: "invalid_opening", message: `Keep the opening to one sentence, up to ${CARD_OPENING_MAX} characters.` });
  });

  it("refuses a written one the show's card check would, in the show's usual words, without saying it back", () => {
    const refused: [string, RegExp][] = [
      ["We wake up in bed together at the inn.", /PG, so nothing sexual and no innuendo/],
      ["She takes off her dress as I walk in.", /PG, so nothing sexual and no innuendo/],
      ["I'm sixteen and sneaking in past curfew.", /everyone in it is an adult/],
      ["Taylor Swift is already at the bar.", /no real or famous people/],
      ["My teacher keeps me after class.", /never family, school or a babysitter/],
      ["She's drunk and can't find her keys.", /nobody drunk, trapped or kept from saying no/],
    ];
    for (const [text, why] of refused) {
      const r = resolveOpening(text, GENERIC_OPENINGS);
      expect(r, text).toMatchObject({ ok: false, status: 422, error: "opening_not_allowed" });
      if (!r.ok) {
        expect(r.message, text).toMatch(why);
        expect(r.message).toMatch(/^That opening can't be used: /);
        expect(r.message).not.toMatch(/bed together|dress|sixteen|Taylor|after class|keys/);
      }
    }
  });

  it("the picker sends its choice as that field: a pick, any of the three for a surprise, a sentence, or nothing", () => {
    expect(openingField(null)).toEqual({});
    expect(openingField({ pick: 2 })).toEqual({ opening: 2 });
    expect(openingField({ surprise: true }, () => 0)).toEqual({ opening: 0 });
    expect(openingField({ surprise: true }, () => 0.5)).toEqual({ opening: 1 });
    expect(openingField({ surprise: true }, () => 0.999999)).toEqual({ opening: 2 });
    expect(openingField({ surprise: true }, () => 1)).toEqual({ opening: 2 });
    expect(openingField({ written: "  The lights go out   as I sit down. " })).toEqual({ opening: "The lights go out as I sit down." });
    expect(openingField({ written: "   " })).toEqual({});
  });

  it("goes into a date's terms with the roleplay (lib/date-roleplays.ts)", () => {
    const picked = resolveTerms({ roleplay_id: "stowaway", my_role: 1, opening: 2 }, "me", "them");
    expect(picked).toMatchObject({ ok: true, terms: { id: "stowaway", first: "them", opening: STOWAWAY.card.openings[2] } });
    const plain = resolveTerms({ roleplay_id: "stowaway" }, "me", "them");
    expect(plain.ok && "opening" in plain.terms).toBe(false);
    const own = { title: "Lighthouse keepers", premise: "{a} and {b} keep the last lighthouse on the coast, and tonight the ships have stopped coming." };
    expect(resolveTerms({ custom: own, opening: "{a} is trimming the lamp when {b} comes up the stairs with bad news." }, "me", "them")).toMatchObject({
      ok: true,
      terms: { id: "custom", opening: "{a} is trimming the lamp when {b} comes up the stairs with bad news." },
    });
    expect(resolveTerms({ custom: own, opening: 1 }, "me", "them")).toMatchObject({ ok: false, status: 422, error: "invalid_opening" });
    expect(resolveTerms({ roleplay_id: "stowaway", opening: "We end up in bed together." }, "me", "them")).toMatchObject({ ok: false, status: 422, error: "opening_not_allowed" });
    // A booking's ask carries it only when one was chosen.
    expect(bookingAsk("stowaway", 1, 0)).toEqual({ roleplay_id: "stowaway", my_role: 1, opening: 0 });
    expect(bookingAsk("stowaway", 1)).toEqual({ roleplay_id: "stowaway", my_role: 1 });
    expect(bookingAsk("none", undefined, 1)).toEqual({ skip: true });
  });
});

describe("the picker's last step", () => {
  const render = (props: Partial<Parameters<typeof RoleplayPicker>[0]>) =>
    renderToStaticMarkup(createElement(RoleplayPicker, { me: "You", them: "Mara Quinn", value: null, onChange: () => {}, signedIn: false, ...props }));

  it("shows the roleplay's three openings from your side when you play it yourself, either role", () => {
    expect(openingsShown({ value: { roleplay_id: "stowaway", my_role: 0 }, me: "You", them: "Mara", asYou: true })).toEqual(
      STOWAWAY.card.openings.map((o) => expect.stringMatching(/\b[Yy]ou\b/)),
    );
    const asStowaway = openingsShown({ value: { roleplay_id: "stowaway", my_role: 1 }, me: "You", them: "Mara", asYou: true });
    const asCaptain = openingsShown({ value: { roleplay_id: "stowaway", my_role: 0 }, me: "You", them: "Mara", asYou: true });
    expect(asStowaway).toHaveLength(3);
    expect(asStowaway).not.toEqual(asCaptain);
    for (const o of [...asStowaway, ...asCaptain]) expect(o).not.toMatch(/[{}]/);
    const html = render({ value: { roleplay_id: "stowaway", my_role: 1 }, asYou: true, onOpening: () => {}, opening: { pick: 1 } });
    expect(html).toContain("<legend>How it opens</legend>");
    for (const o of asStowaway) expect(html).toContain(o.replaceAll("'", "&#x27;"));
    expect(html).toContain("Surprise me");
    expect(html).toContain("Write your own");
    expect(html).toContain("Let it open its own way");
    expect(html.match(/type="radio"[^>]*name="[^"]*-opening"/g)?.length ?? html.match(/name="[^"]*-opening"/g)?.length).toBe(5);
  });

  it("offers the generic three for a scene with no roleplay, and names for a show date", () => {
    expect(openingsShown({ value: null, me: "You", them: "Mara", asYou: true })).toEqual([
      "You got there first and have been pretending not to watch the door when Mara walks in.",
      "You and Mara arrive at the same moment from opposite directions, and both pretend that was the plan.",
      "Mara is late and a little out of breath, and you have already decided not to mention it.",
    ]);
    expect(render({ asYou: true, onOpening: () => {} })).toContain("You got there first and have been pretending not to watch the door when Mara walks in.");
    // A show date: the two characters by name, {a} whoever plays the first role.
    const first = openingsShown({ value: { roleplay_id: "stowaway", my_role: 0 }, me: "Cass", them: "Otto", asYou: false });
    const second = openingsShown({ value: { roleplay_id: "stowaway", my_role: 1 }, me: "Cass", them: "Otto", asYou: false });
    expect(first).toEqual(STOWAWAY.card.openings.map((o) => o.replaceAll("{a}", "Cass").replaceAll("{b}", "Otto")));
    expect(second).toEqual(STOWAWAY.card.openings.map((o) => o.replaceAll("{a}", "Otto").replaceAll("{b}", "Cass")));
    // With no roleplay a show date has nothing to open, so there's no step.
    expect(openingsShown({ value: null, me: "Cass", them: "Otto", asYou: false })).toEqual([]);
    expect(render({ me: "Cass", them: "Otto", onOpening: () => {} })).not.toContain("How it opens");
  });

  it("a roleplay you wrote has no three to pick from: write the opening too; and the step is only there when asked for", () => {
    const own = { custom: { title: "Lighthouse keepers", premise: "{a} and {b} keep the last lighthouse on the coast." }, my_role: 0 as const };
    expect(openingsShown({ value: own, me: "You", them: "Mara", asYou: true })).toEqual([]);
    const html = render({ value: own, asYou: true, onOpening: () => {}, opening: { written: "The lamp goes out." } });
    expect(html).toContain("How it opens");
    expect(html).not.toContain("Surprise me");
    expect(html).toContain("Write your own");
    expect(html).toContain('value="The lamp goes out."');
    expect(html).toContain(`maxLength="${CARD_OPENING_MAX}"`);
    // The couple page's proposal passes no onOpening: no step.
    expect(render({ value: { roleplay_id: "stowaway", my_role: 0 } })).not.toContain("How it opens");
    // Untouched, nothing is chosen and nothing more is sent than before.
    expect(roleplayFields({ roleplay_id: "stowaway", my_role: 0 })).toEqual({ roleplay: "stowaway", my_role: 0 });
    const untouched = render({ value: { roleplay_id: "stowaway", my_role: 0 }, asYou: true, onOpening: () => {} });
    expect(untouched.slice(untouched.indexOf("How it opens"))).not.toContain("checked");
    expect(untouched).not.toContain("Let it open its own way");
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS[0];
const FIRST = CAST.name.split(/\s+/)[0];
const PLACE = "rooftop_bar";

let calls: ChatMessage[][] = [];
let risk = false;
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  calls = [];
  risk = false;
  let n = 0;
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": ${risk}}`;
      if (!system.startsWith("You are ")) return "{}";
      calls.push(messages);
      return system.includes("playing a scene together") ? JSON.stringify({ say: `Line ${++n}.`, do: "looks up" }) : JSON.stringify({ messages: [`Text ${++n}.`] });
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const person = () => {
  const id = crypto.randomUUID();
  return { id, cookie: `${signedInCookie(id)}; bz_adult=1` };
};
const req = (path: string, body: unknown, cookie: string) => new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
async function open(cookie: string): Promise<string> {
  return ((await (await openRoute(req("/api/companion", { character_id: CAST.id }, cookie))).json()) as Any).thread_id;
}
async function act(cookie: string, id: string, body: Record<string, unknown>) {
  const res = await actRoute(req(`/api/companion/${id}`, body, cookie), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Any };
}
const thread = async (id: string) => (await t.db.query<Any>(`select scene, roleplay, opening, paused_at from companion_threads where id = $1`, [id])).rows[0];
const cue = () => calls.at(-1)!.at(-1)!.content;
/** A card's or a generic opening as the character reads it: its own name, the person as "your scene partner". */
const theirSide = (text: string, person: "{a}" | "{b}") => {
  const own = person === "{a}" ? "{b}" : "{a}";
  return text
    .replaceAll(own, FIRST)
    .replaceAll(`${person}'s`, "your scene partner's")
    .replaceAll(person, "your scene partner")
    .replace(/(^|[.!?]\s+)your scene partner/g, (_m, lead: string) => `${lead}Your scene partner`);
};
const PLAYS = " Play your own part of that; whatever your scene partner does in it is theirs to play.";

describe("POST /api/companion/[id] {action: scene, opening}", () => {
  it("one of the roleplay's three, by its index: kept with the terms, and the opener plays it", async () => {
    const me = person();
    const id = await open(me.cookie);
    // The person is the stowaway ({b}); the character is the captain ({a}).
    for (const i of [0, 1, 2]) {
      const r = await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: "stowaway", my_role: 1, opening: i });
      expect(r.status).toBe(200);
      const row = await thread(id);
      expect(row.roleplay.opening).toBe(STOWAWAY.card.openings[i]);
      expect(row.opening).toBeNull();
      expect(cue()).toContain(`It opens like this: ${theirSide(STOWAWAY.card.openings[i], "{b}")}${PLAYS}`);
      // Another opening for the same roleplay is another scene: it started again (a new marker each time).
      expect(r.body.view.messages.filter((m: Any) => m.marker === "scene")).toHaveLength(i + 1);
    }
    // A regenerate right after opens on the same one.
    const before = cue();
    await act(me.cookie, id, { action: "regenerate" });
    expect(cue()).toBe(before);
  });

  it("one of the generic three for a scene with no roleplay: kept beside the scene, the person as {a}", async () => {
    const me = person();
    const id = await open(me.cookie);
    const r = await act(me.cookie, id, { action: "scene", place: PLACE, opening: 2 });
    expect(r.status).toBe(200);
    expect(await thread(id)).toMatchObject({ scene: PLACE, roleplay: null, opening: GENERIC_OPENINGS[2] });
    expect(cue()).toBe(
      `(You've both just got to ${(await import("@/lib/venues")).venue(PLACE).prompt}. It opens like this: ${FIRST} is late and a little out of breath, and your scene partner has already decided not to mention it.${PLAYS} Open the scene: what you do and say as you get there, playing off the place. Don't ask more than one question.)`,
    );
    // Only the opener's cue has it: the next reply's prompt doesn't.
    await act(me.cookie, id, { action: "send", text: "You're late." });
    expect(calls.at(-1)!.map((m) => m.content).join("\n")).not.toContain("It opens like this");
    // The same place with another opening starts the scene again; back to texting forgets it.
    const again = await act(me.cookie, id, { action: "scene", place: PLACE, opening: 0 });
    expect(again.body.view.messages.filter((m: Any) => m.marker === "scene")).toHaveLength(2);
    expect((await thread(id)).opening).toBe(GENERIC_OPENINGS[0]);
    await act(me.cookie, id, { action: "scene", place: null });
    expect(await thread(id)).toMatchObject({ scene: null, opening: null });
  });

  it("a sentence of their own: checked, kept, and quoted to the character as theirs", async () => {
    const me = person();
    const id = await open(me.cookie);
    const written = `I'm halfway through a crossword when ${FIRST} sits down across from me.`;
    const plain = await act(me.cookie, id, { action: "scene", place: PLACE, opening: `  ${written}  ` });
    expect(plain.status).toBe(200);
    expect((await thread(id)).opening).toBe(written);
    expect(cue()).toContain(`It opens like this: (as your scene partner wrote it, so "I" and "me" in it are them) ${JSON.stringify(written)}${PLAYS}`);
    // With a roleplay it goes into the terms instead.
    const inRole = await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: "stowaway", my_role: 1, opening: "I'm hiding behind the orange crates when the lights come on." });
    expect(inRole.status).toBe(200);
    expect(await thread(id)).toMatchObject({ opening: null, roleplay: { id: "stowaway", opening: "I'm hiding behind the orange crates when the lights come on." } });
    expect(cue()).toContain(`the roleplay "Captain and stowaway" starts now. It opens like this: (as your scene partner wrote it, so "I" and "me" in it are them) "I'm hiding behind the orange crates when the lights come on."${PLAYS}`);
    // One that names the sides reads from the character's side, like a card's.
    await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: "stowaway", my_role: 1, opening: "{b} is eating the captain's biscuits when {a} opens the locker." });
    expect(cue()).toContain(`It opens like this: Your scene partner is eating the captain's biscuits when ${FIRST} opens the locker.${PLAYS}`);
  });

  it("refuses a written one that isn't PG: nothing stored, no scene, no reply taken", async () => {
    const me = person();
    const id = await open(me.cookie);
    const n = calls.length;
    for (const body of [
      { action: "scene", place: PLACE, opening: "We wake up in bed together." },
      { action: "scene", place: PLACE, roleplay: "stowaway", opening: "She takes off her dress as I walk in." },
      { action: "scene", place: PLACE, opening: "I'm sixteen and out past curfew." },
      { action: "scene", place: PLACE, opening: "x".repeat(CARD_OPENING_MAX + 1) },
      { action: "scene", place: PLACE, roleplay: { title: "Lighthouse keepers", premise: "{a} and {b} keep the last lighthouse on the coast, and tonight the ships have stopped coming." }, opening: 1 },
    ]) {
      const r = await act(me.cookie, id, body);
      expect(r.status, JSON.stringify(body)).toBe(422);
      expect(["opening_not_allowed", "invalid_opening"]).toContain(r.body.error);
      expect(JSON.stringify(r.body)).not.toMatch(/bed together|her dress|sixteen/);
    }
    expect(calls.length).toBe(n);
    expect(await thread(id)).toMatchObject({ scene: null, roleplay: null, opening: null });
    const kept = JSON.stringify((await t.db.query<Any>(`select text from companion_messages where thread_id = $1`, [id])).rows);
    expect(kept).not.toMatch(/bed together|her dress|sixteen/);
    // The reply it would have drawn was given back.
    const usage = (await t.db.query<Any>(`select coalesce(sum(replies), 0)::int as n from companion_usage where user_id = $1`, [me.id])).rows[0].n;
    expect(usage).toBe(0);
    // An index that isn't one of the three never gets as far as the scene.
    expect((await act(me.cookie, id, { action: "scene", place: PLACE, opening: 3 })).status).toBe(422);
    expect(await thread(id)).toMatchObject({ scene: null });
  });

  it("a written one that reads as a crisis pauses the thread with the help, and keeps nothing", async () => {
    const me = person();
    const id = await open(me.cookie);
    const r = await act(me.cookie, id, { action: "scene", place: PLACE, opening: "I walk in and tell you I want to kill myself." });
    expect(r.body.error).toBe("paused");
    expect(r.body.crisis_resources?.lines?.length).toBeGreaterThan(0);
    const row = await thread(id);
    expect(row.paused_at).not.toBeNull();
    expect(row).toMatchObject({ scene: null, opening: null });
  });

  it("left out, the scene opens exactly as it did: one of the card's by the thread's id, nothing stored", async () => {
    const me = person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "scene", place: PLACE, roleplay: "stowaway", my_role: 1 });
    const row = await thread(id);
    expect("opening" in row.roleplay).toBe(false);
    expect(row.opening).toBeNull();
    expect(STOWAWAY.card.openings.filter((o) => cue().includes(`It opens like this: ${theirSide(o, "{b}")}${PLAYS}`))).toHaveLength(1);
    await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(cue()).not.toContain("It opens like this");
  });
});

describe("a show date's booking", () => {
  const book = async (cookie: string, body: Record<string, unknown>) => {
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode(body, cookie);
    return { status: res.status, body: (await res.json()) as Any };
  };
  const setupOf = async (episodeId: string) => (await t.db.query<Any>(`select setup from episodes where id = $1`, [episodeId])).rows[0].setup;

  it("takes the opening the picker chose into the roleplay's terms, and refuses a written one that isn't PG before anything is booked", async () => {
    const me = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const picked = await book(me, { character_id: cass.id, partner_id: HOUSE_PARTNER_ID, roleplay: "stowaway", my_role: 1, opening: 2 });
    expect(picked.status).toBe(200);
    expect((await setupOf(picked.body.id)).roleplay).toMatchObject({ id: "stowaway", opening: STOWAWAY.card.openings[2] });
    const written = await book(me, { character_id: cass.id, partner_id: HOUSE_PARTNER_ID, roleplay: "stowaway", my_role: 1, opening: "{b} is sitting on a crate of oranges when {a} finds the hold unlocked." });
    expect(written.status).toBe(200);
    expect((await setupOf(written.body.id)).roleplay.opening).toBe("{b} is sitting on a crate of oranges when {a} finds the hold unlocked.");
    const n = (await t.db.query<Any>(`select count(*)::int as n from episodes`)).rows[0].n;
    const refused = await book(me, { character_id: cass.id, partner_id: HOUSE_PARTNER_ID, roleplay: "stowaway", opening: "They wake up in bed together." });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ error: "opening_not_allowed", field: "roleplay" });
    expect((await t.db.query<Any>(`select count(*)::int as n from episodes`)).rows[0].n).toBe(n);
    // Left out, it's one of the card's by the date's id, as before.
    const plain = await book(me, { character_id: cass.id, partner_id: HOUSE_PARTNER_ID, roleplay: "stowaway" });
    expect(STOWAWAY.card.openings).toContain((await setupOf(plain.body.id)).roleplay.opening);
  });
});
