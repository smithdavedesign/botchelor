/**
 * Public sheet fields stay PG on the show (David 2026-11-02): Chud's dealbreaker "They're boring or not into exploring in
 * the bedroom" passed the sheet check, which only knew the explicit words. Saves are held to checkSheetText now; a sheet
 * saved before it shows the flagged field hidden to everyone else (nothing is rewritten), its owner is told which ones,
 * and the dealbreaker quiz leaves a flagged dealbreaker out as answer and as decoy.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";
import { getPublicCharacter } from "@/lib/game";
import { getDealbreakerQuiz } from "@/lib/mechanics";
import { handleMcpMessage } from "@/lib/mcp";
import { PG_HIDDEN_TEXT, pgExtras, pgFlags, pgPublic } from "@/lib/pg-public";
import { checkFields, checkSheetText, sheetPgIssue } from "@/lib/safety";
import { api, newUserCookie, setupEpisode, startTestDb, userIdOf, validCharacter } from "./helpers";

// Chud's public fields as they were saved on prod.
const CHUD = {
  dealbreaker: "They're boring or not into exploring in the bedroom",
  want: "A wild first night that he hopes will lead back to his place for what every guys wants",
  quirk: "trys to manipulate you into sleeping with him",
};

describe("the sheet check", () => {
  it("why Chud's passed: checkFields knows the explicit words only, and checkSheetText catches the innuendo", () => {
    expect(checkFields({ dealbreaker: CHUD.dealbreaker, want: CHUD.want })).toEqual({ ok: true });
    expect(checkSheetText({ dealbreaker: CHUD.dealbreaker })).toMatchObject({ ok: false, reason: "innuendo", field: "dealbreaker" });
    expect(checkSheetText({ bio: "Fine.", want: CHUD.want })).toMatchObject({ ok: false, reason: "innuendo", field: "want" });
    expect(sheetPgIssue(CHUD.quirk)).toBe("innuendo");
    for (const s of ["Good in bed, or so he says", "Looking for a hookup", "Wants to hook up with someone tall", "A sultry voice", "Seductive and knows it", "Would take you to bed on the first date",
      // The same sheet's details, found on the live check.
      "satisfying women at all costs", "eating ass", "making you moan", "try and sleep with their date",
      "drinks, fun, and straight back to my place for hooking up", "Let's take this conversation back to my place", "prudes",
      "you handling my sausage tonight gif"]) {
      expect(sheetPgIssue(s), s).toBe("innuendo");
    }
    // Explicit words still read as sexual.
    expect(sheetPgIssue("Into kinky stuff")).toBe("sexual");
  });

  it("touching oneself in its euphemisms, and a body part rated, read as innuendo too (2026-11-21)", () => {
    for (const s of [
      // A public profile's "When they're bored, they…" answer, served on its card and over MCP.
      "like playing with themselves discretely",
      "Plays with herself when nobody's home",
      "jerking off in the shower",
      "wanking",
      "rubbing one out",
      "spanking the monkey",
      "touching himself",
      "self-pleasure",
      // A test sheet's dealbreaker, quizzed on an aired date's page.
      "big ass",
      "Nice butt",
      "a bubble butt",
    ]) {
      expect(sheetPgIssue(s), s).toBe("innuendo");
    }
    for (const s of [
      "Kicks ass at trivia",
      "A total badass on the court",
      "Touched by small kindnesses",
      "Playing with friends on Sundays",
      "Plays with the dog for hours",
      "Talks to himself while cooking",
      "Keeps herself busy with puzzles",
      "A nice rack of lamb, slow-roasted",
      "A big butterfly collection",
      "A spanking new bike",
      "Chicken breasts on the grill",
      "Rubs one eye when tired",
    ]) {
      expect(sheetPgIssue(s), s).toBeNull();
    }
  });

  it("everyday sheets still pass", () => {
    for (const s of [
      "Loves physical touch and will treat you well.",
      "Breakfast in bed on Sundays is the dream",
      "A sculpture made out of clay and regret",
      "Back to my place for board games after",
      "Will hook up the speakers before anyone asks",
      "Repaints the bedroom every spring",
      "Naughty or nice? Mostly nice.",
      "A passionate cook who burns everything",
      "Wild about hiking and first nights at the opera",
      "Dominant at chess, terrible at losing",
      "Graduated magna cum laude, never mentions it",
      "Hooking up the TV is their love language",
      "Sleeps with the window open, even in winter",
      "Grandma's sausage rolls, still warm",
      "Makes you laugh until you snort",
      "Satisfying a craving for dumplings at 2am",
    ]) {
      expect(sheetPgIssue(s), s).toBeNull();
    }
    // And the whole house cast.
    expect(ALL_HOUSE_CHARACTERS.filter((c) => pgFlags(c).length > 0).map((c) => c.id)).toEqual([]);
  });
});

describe("a sheet saved before the check", () => {
  it("shows the flagged fields hidden and leaves out a flagged trait or detail, the rest as written", () => {
    const sheet = { bio: "A good listener.", want: CHUD.want, dealbreaker: CHUD.dealbreaker, traits: ["funny", "sensual", "loyal"], voice: null, extras: { quirk: CHUD.quirk, occupation: "Barista", hot_takes: ["Pineapple belongs on pizza."] } };
    expect(pgFlags(sheet)).toEqual(["want", "dealbreaker", "traits", "details"]);
    const shown = pgPublic(sheet);
    expect(shown).toMatchObject({ bio: "A good listener.", want: PG_HIDDEN_TEXT, dealbreaker: PG_HIDDEN_TEXT, traits: ["funny", "loyal"] });
    expect(shown.extras).toEqual({ occupation: "Barista", hot_takes: ["Pineapple belongs on pizza."] });
    // A clean one comes back as it was, the same object.
    const clean = { bio: "Fine.", want: "A kind person", traits: ["warm"], extras: { quirk: "Hums in lifts" } };
    expect(pgPublic(clean)).toBe(clean);
    expect(pgExtras(clean.extras)).toBe(clean.extras);
  });
});

describe("with a database", () => {
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

  it("a save or an edit with innuendo in a public field is refused, and says why", async () => {
    const cookie = newUserCookie();
    const bad = await api.createCharacter(validCharacter({ dealbreaker: CHUD.dealbreaker }), cookie);
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: "content_rejected", reason: "innuendo", field: "dealbreaker", message: expect.stringMatching(/PG/) });
    expect((await api.createCharacter(validCharacter({ extras: { quirk: CHUD.quirk } }), cookie)).status).toBe(422);
    const made = await (await api.createCharacter(validCharacter(), cookie)).json();
    const edit = await api.editCharacter(made.id, { want: CHUD.want }, cookie);
    expect(edit.status).toBe(422);
    expect(await edit.json()).toMatchObject({ reason: "innuendo", field: "want" });
    expect((await api.editCharacter(made.id, { want: "Someone who laughs at bad puns" }, cookie)).status).toBe(200);
  });

  it("a refusal lists every refused text, not just the first, with the words that did it", async () => {
    const cookie = newUserCookie();
    const bad = await api.createCharacter(validCharacter({ dealbreaker: CHUD.dealbreaker, extras: { quirk: CHUD.quirk, hobbies: ["Chess", "making you moan"] } }), cookie);
    expect(bad.status).toBe(422);
    const body = await bad.json();
    expect(body).toMatchObject({ error: "content_rejected", field: "dealbreaker" });
    expect(body.issues).toEqual([
      { field: "dealbreaker", index: 0, reason: "innuendo", phrase: "in the bedroom" },
      { field: "quirk", index: 0, reason: "innuendo", phrase: "sleeping with him" },
      { field: "hobbies", index: 1, reason: "innuendo", phrase: "making you moan" },
    ]);
    const made = await (await api.createCharacter(validCharacter(), cookie)).json();
    const edit = await (await api.editCharacter(made.id, { want: CHUD.want, dealbreaker: CHUD.dealbreaker }, cookie)).json();
    expect(edit.issues.map((i: { field: string }) => i.field)).toEqual(["want", "dealbreaker"]);
  });

  it("a flagged tell is left off the public card and get_character and search_characters, and kept for its owner (2026-11-21)", async () => {
    const owner = newUserCookie();
    const made = await (await api.createCharacter(validCharacter({ name: "Sweet Thang" }), owner)).json();
    const line = "like playing with themselves discretely";
    // As it was saved before the check caught it (no write path allows it now).
    await t.db.query(`update characters set extras = coalesce(extras, '{}'::jsonb) || $2::jsonb where id = $1`, [made.id, JSON.stringify({ tells: { bored: line, nervous: "hums show tunes" } })]);
    const card = (await getPublicCharacter(t.db, made.id))!;
    expect(card.extras?.tells).toEqual({ nervous: "hums show tunes" });
    const call = async (name: string, args: Record<string, unknown>) =>
      JSON.stringify(await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {}));
    const got = await call("get_character", { character_id: made.id });
    expect(got).toContain("hums show tunes");
    expect(got).not.toContain("playing with themselves");
    const found = await call("search_characters", { query: "Sweet Thang" });
    expect(found).toContain(made.id);
    expect(found).not.toContain("playing with themselves");
    const own = await call("get_character", { character_id: made.id, agent_id: userIdOf(owner) });
    expect(own).toContain("playing with themselves");
  });

  it("an old row is shown softened, its owner told which fields, and its dealbreaker is never quizzed on", async () => {
    const { episode, character } = await setupEpisode("friends");
    // As it was saved before the check (no write path allows it now).
    await t.db.query(`update characters set dealbreaker = $2, want = $3, traits = $4 where id = $1`, [character.id, CHUD.dealbreaker, CHUD.want, ["funny", "sensual"]]);
    const c = (await getPublicCharacter(t.db, character.id))!;
    expect(c).toMatchObject({ want: PG_HIDDEN_TEXT, traits: ["funny"], pg_flags: ["want", "dealbreaker", "traits"] });
    expect("dealbreaker" in c).toBe(false);
    expect(await getDealbreakerQuiz(t.db, episode.id, null)).toBeNull();

    // As a decoy on someone else's date: left out, and the quiz still has its four.
    await t.db.query(`update characters set dealbreaker = 'People who hate surprises' where id = $1`, [character.id]);
    const other = await setupEpisode("friends");
    await t.db.query(`update characters set dealbreaker = $2 where id = $1`, [character.id, CHUD.dealbreaker]);
    await (await api.createCharacter(validCharacter({ name: "Decoy One", dealbreaker: "Loud chewers" }), newUserCookie())).json();
    await (await api.createCharacter(validCharacter({ name: "Decoy Two", dealbreaker: "Never on time" }), newUserCookie())).json();
    await (await api.createCharacter(validCharacter({ name: "Decoy Three", dealbreaker: "Hates dogs" }), newUserCookie())).json();
    const quiz = (await getDealbreakerQuiz(t.db, other.episode.id, userIdOf(newUserCookie())))!;
    expect(quiz.options).not.toContain(CHUD.dealbreaker);
    expect(quiz.options).toHaveLength(4);
  });
});
