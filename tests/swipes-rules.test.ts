import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getSwipes, POST as postSwipes } from "@/app/api/swipes/route";
import { deleteAccount, exportAccount } from "@/lib/account";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage } from "@/lib/mcp";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { deckFor, swipe } from "@/lib/swipes";
import { sendText } from "@/lib/texting";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, jsonRequest, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
/** Two house characters on the season for the deck test, and one off it. */
const [ON_SEASON, OFF_SEASON] = HOUSE_CHARACTERS.filter((c) => c.id !== HOUSE_PARTNER_ID).map((c) => c.id);

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setSeasonCastForTests([HOUSE_PARTNER_ID]);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSeasonCastForTests(null);
  vi.restoreAllMocks();
});

type Who = { cookie: string; userId: string; id: string; name: string };

/** A person and their character: open to dates (to `audience`) with a dating profile, unless told otherwise. */
async function person(name: string, opts: { profile?: boolean; open?: boolean; audience?: string } = {}): Promise<Who> {
  const cookie = newUserCookie();
  const body = validCharacter({
    name,
    ...(opts.profile === false ? {} : { extras: PROFILE }),
    ...(opts.open === false ? {} : { open_to_dates: true }),
    ...(opts.audience ? { open_audience: opts.audience } : {}),
  });
  const character = await (await api.createCharacter(body, cookie)).json();
  return { cookie, userId: userIdOf(cookie), id: character.id as string, name };
}

/** An agent and its character (made over MCP), open to dates, with a dating profile. */
async function agent(name: string): Promise<Omit<Who, "cookie">> {
  const res = (await handleMcpMessage(
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_character", arguments: { ...validCharacter({ name }), extras: PROFILE, open_to_dates: true } } },
    {},
  )) as Any;
  const made = res.result.structuredContent;
  return { userId: made.agent_id as string, id: made.character.id as string, name };
}

async function deckIds(who: Pick<Who, "userId" | "id">): Promise<string[]> {
  const deck = await deckFor(t.db, who.userId, who.id, 30);
  if (!deck.ok) throw new Error(deck.message);
  return deck.cards.map((c) => c.id);
}

describe("the swipe routes (app/api/swipes)", () => {
  const get = (cookie: string | null, id: string, limit?: number) =>
    getSwipes(new Request(`${BASE_URL}/api/swipes?character_id=${id}${limit ? `&limit=${limit}` : ""}`, { headers: cookie ? { cookie } : {} }));

  it("GET deals one of your characters' deck, a page at a time, and says what a profile is missing", async () => {
    const me = await person("Wren Kestrel");
    const other = await person("Pim Alder");
    const ok = await get(me.cookie, me.id);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.for).toEqual({ id: me.id, name: "Wren Kestrel" });
    expect(body.cards.map((c: Any) => c.id)).toEqual(expect.arrayContaining([HOUSE_PARTNER_ID, other.id]));
    expect((await (await get(me.cookie, me.id, 1)).json()).cards).toHaveLength(1);
    // Someone else's character, or none at all: not yours.
    expect((await get(other.cookie, me.id)).status).toBe(404);
    expect((await get(null, me.id)).status).toBe(404);
    // No dating profile yet: what's missing, by field.
    const bare = await person("Bare Fenn", { profile: false });
    const res = await get(bare.cookie, bare.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "profile_incomplete", missing: [expect.stringMatching(/\(extras\.prompts\)$/), expect.stringMatching(/\(extras\.hobbies\)$/)] });
  });

  it("POST swipes: a like on a house character is a match, a pass is final, and bad input is refused", async () => {
    const me = await person("Wren Kestrel");
    const other = await person("Pim Alder");
    const post = (body: Record<string, unknown>, cookie = me.cookie) => postSwipes(jsonRequest("/api/swipes", body, { cookie }));
    const liked = await post({ character_id: me.id, target_id: HOUSE_PARTNER_ID, like: true });
    expect(liked.status).toBe(200);
    expect(await liked.json()).toMatchObject({ liked: true, match: { lo: expect.any(String), hi: expect.any(String), agreed: expect.any(Boolean) } });
    // Matched now, so they've left the deck.
    expect(await (await post({ character_id: me.id, target_id: HOUSE_PARTNER_ID, like: true })).json()).toMatchObject({ error: "not_in_deck" });
    // A pass is final: no second swipe on them.
    expect(await (await post({ character_id: me.id, target_id: other.id, like: false })).json()).toEqual({ liked: false, match: null });
    const again = await post({ character_id: me.id, target_id: other.id, like: true });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "already_swiped" });
    expect((await post({ character_id: me.id, target_id: me.id, like: true })).status).toBe(422);
    expect(await (await post({ character_id: me.id, target_id: other.id })).json()).toMatchObject({ error: "invalid_request" }); // `like` is required
    expect((await post({ character_id: me.id, target_id: HOUSE_PARTNER_ID, like: true }, newUserCookie())).status).toBe(404);
  });
});

describe("who's in a deck", () => {
  it("the audience: a character open only to people's characters is never in an agent's deck, and the other way round", async () => {
    const forPeople = await person("Ola Peoplesworth", { audience: "people" });
    const forAgents = await person("Ola Agentsworth", { audience: "agents" });
    const human = await person("Wren Kestrel");
    const bot = await agent("Ada Lumen");
    const humans = await deckIds(human);
    expect(humans).toContain(forPeople.id);
    expect(humans).not.toContain(forAgents.id);
    const bots = await deckIds(bot);
    expect(bots).toContain(forAgents.id);
    expect(bots).not.toContain(forPeople.id);
    expect(await swipe(t.db, bot.userId, bot.id, forPeople.id, true)).toMatchObject({ ok: false, error: "not_in_deck" });
  });

  it("never across a block, never someone taken or already dated, and only this season's house cast", async () => {
    setSeasonCastForTests([HOUSE_PARTNER_ID, ON_SEASON]);
    const me = await person("Wren Kestrel");
    const blocked = await person("Bo Blockley");
    const taken = await person("Ty Takenhall");
    const partner = await person("Pat Partridge");
    const dated = await person("Dee Datewell");
    // A block between the owners (made from any date of either one's).
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const ep = await (await api.createEpisode({ character_id: me.id, partner_id: HOUSE_PARTNER_ID }, me.cookie)).json();
    await t.db.query(`insert into blocks (blocker_id, via_episode_id, blocked_id) values ($1, $2, $3)`, [blocked.userId, ep.id, me.userId]);
    // Taken: wants one partner, and is dating someone else.
    await t.db.query(`update characters set partner_style = 'one' where id = $1`, [taken.id]);
    const [tlo, thi] = [taken.id, partner.id].sort();
    // computed_at set, so the graph doesn't recompute these hand-made edges from (no) episodes.
    await t.db.query(`insert into relationships (character_a, character_b, dates, second_dates, stage, computed_at) values ($1, $2, 3, 2, 'dating', now())`, [tlo, thi]);
    // Already dated.
    const [dlo, dhi] = [me.id, dated.id].sort();
    await t.db.query(`insert into relationships (character_a, character_b, dates, stage, computed_at) values ($1, $2, 1, 'just_met', now())`, [dlo, dhi]);

    const ids = await deckIds(me);
    expect(ids).toContain(partner.id); // more than one partner is theirs to choose: not taken
    expect(ids).toContain(ON_SEASON);
    for (const gone of [blocked.id, taken.id, dated.id, HOUSE_PARTNER_ID, OFF_SEASON]) expect(ids).not.toContain(gone); // HOUSE_PARTNER_ID: dated above
    expect(await swipe(t.db, me.userId, me.id, blocked.id, true)).toMatchObject({ ok: false, error: "not_in_deck" });
    expect(await swipe(t.db, me.userId, me.id, OFF_SEASON, true)).toMatchObject({ ok: false, error: "not_in_deck" });
    // A taken character can't swipe either: it's out of the deck both ways.
    expect(await deckFor(t.db, taken.userId, taken.id)).toMatchObject({ ok: false, error: "taken" });
  });
});

describe("their data: the account export, and deleting it", () => {
  it("the export has their characters' own swipes (never anyone's likes on them), matches and texts; deleting the account removes them", async () => {
    const me = await person("Wren Kestrel");
    const them = await person("Pim Alder");
    await swipe(t.db, them.userId, them.id, me.id, true); // their like on me: secret, and theirs
    await swipe(t.db, me.userId, me.id, them.id, true); // mine: a match
    await swipe(t.db, me.userId, me.id, HOUSE_PARTNER_ID, false); // a pass
    expect(await sendText(t.db, { userId: me.userId, from: me.id, to: them.id, text: "Hello from the deck." })).toMatchObject({ ok: true });

    const out = (await exportAccount(t.db, me.userId)) as Any;
    expect(out.swipes.map((s: Any) => [s.swiper, s.target, s.liked])).toEqual(
      expect.arrayContaining([
        [me.id, them.id, true],
        [me.id, HOUSE_PARTNER_ID, false],
      ]),
    );
    expect(out.swipes.some((s: Any) => s.swiper === them.id)).toBe(false);
    expect(out.matches).toHaveLength(1);
    expect(out.couple_texts.map((x: Any) => x.text)).toContain("Hello from the deck.");
    // The other owner's export has their own like, not mine.
    const theirs = (await exportAccount(t.db, them.userId)) as Any;
    expect(theirs.swipes.map((s: Any) => s.swiper)).toEqual([them.id]);

    await deleteAccount(t.db, me.userId);
    for (const table of ["swipes", "matches", "couple_texts"]) {
      expect((await t.db.query<{ n: number }>(`select count(*)::int as n from ${table}`)).rows[0].n, table).toBe(0);
    }
  });
});
