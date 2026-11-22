import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The pages read the viewer from next/headers: hand them this cookie store.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
vi.mock("@/app/AfterDarkTeaser", () => ({ default: () => null }));
import { renderToStaticMarkup } from "react-dom/server";
import CharacterPage from "@/app/characters/[id]/page";
import CharactersPage from "@/app/characters/(list)/page";
import { signSession } from "@/lib/auth";
import { actionsFor, cardVerbLabel, characterVerb, makeHref, sendHref, stepInHref, textVerb, verbFacts, verbsFor, viewerCharacter, type VerbFacts } from "@/lib/character-verb";
import { companionEligible } from "@/lib/companion";
import { HOUSE_CHARACTERS, PREMIUM_HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSwipeGateForTests } from "@/lib/swipe-gate";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Every character gets a verb (lib/character-verb.ts, 2026-11-15): one primary action on each card of /characters and
// at the head of each character's page, chosen by who is looking; never one the booking or step-in would refuse.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
const CAST = HOUSE_CHARACTERS[0];
const OFF = HOUSE_CHARACTERS[2];
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  setSeasonCastForTests([CAST.id, HOUSE_CHARACTERS[1].id]);
});
afterEach(() => {
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
  setSwipeGateForTests(false);
  vi.unstubAllEnvs();
});

async function made(name: string, extra: Record<string, unknown> = {}, cookie = newUserCookie()) {
  const res = await api.createCharacter(validCharacter({ name, ...extra }), cookie);
  return { cookie, userId: userIdOf(cookie), id: (await res.json()).id as string, name };
}
/** A visitor without an account on a signed session, as the site issues them: who step-in's guests are. */
const guestCookie = (userId: string = crypto.randomUUID()) => `bz_sess=${signSession({ uid: userId, authenticated: false })}`;
const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=").slice(1).join("="));
};
const hub = async (cookie: string | null, sp: Record<string, string> = {}) => {
  as(cookie);
  return renderToStaticMarkup(await CharactersPage({ searchParams: Promise.resolve(sp) }));
};
const profile = async (id: string, cookie: string | null, sp: Record<string, string> = {}) => {
  as(cookie);
  return renderToStaticMarkup(await CharacterPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) }));
};
/** One card's HTML on /characters, by the character's id. */
const cardOf = (html: string, id: string) => {
  const name = html.indexOf(`href="/characters/${id}"`);
  const start = html.lastIndexOf('<li class="card tap-card dir-card tilt">', name);
  return name < 0 || start < 0 ? "" : html.slice(start, html.indexOf("</li></ul>", start) < 0 ? undefined : html.indexOf("</div></li>", name) + 11);
};
/** The top of a character page: everything before its bio card. */
const top = (html: string) => html.slice(0, html.indexOf('<section class="card" id="profile">'));
const first = (name: string) => name.split(" ")[0];

describe("which verb (characterVerb)", () => {
  const facts: VerbFacts = { id: "house-nell", name: "Nell Ashby", own: false, private: false, dateable: true, ready: true, mineTaken: false, steppable: true, textable: true };
  const mine = { id: "c1", name: "Ira Fenn" };

  it("someone with a character sends it: by name when it can book, a match first behind the swipe gate", () => {
    expect(characterVerb({ mine, stepIn: true }, facts)).toEqual({ kind: "send", label: "Send Ira on a date with Nell", href: "/characters/house-nell?send=c1#date", track: "verb-send" });
    expect(characterVerb({ mine, stepIn: true }, { ...facts, steppable: false, ready: false })).toEqual({ kind: "match", label: "Match Ira with Nell", href: "/swipe?character=c1", track: "verb-match" });
  });

  it("someone with no character steps in where they can, else makes one", () => {
    expect(characterVerb({ mine: null, stepIn: true }, facts)).toEqual({ kind: "step_in", label: "Step into a date with Nell", href: "/step-in?with=house-nell", track: "step-in" });
    // Step-in isn't open to them (guests off, or the switch): the builder, whose first date is with this cast member.
    expect(characterVerb({ mine: null, stepIn: false }, facts)).toEqual({ kind: "make", label: "Make a character to date Nell", href: "/create?meet=house-nell&next=%2Fcharacters%2Fhouse-nell", track: "verb-make" });
    // Not one of the cast (nobody steps into a date with them): the builder, coming back to their page.
    expect(characterVerb({ mine: null, stepIn: true }, { ...facts, steppable: false })).toMatchObject({ kind: "make", href: "/create?next=%2Fcharacters%2Fhouse-nell" });
  });

  it("never offers what would be refused: nothing on your own, a private one, or one that isn't taking dates", () => {
    expect(characterVerb({ mine, stepIn: true }, { ...facts, own: true })).toBeNull();
    expect(characterVerb({ mine: null, stepIn: true }, { ...facts, private: true })).toBeNull();
    expect(characterVerb({ mine: null, stepIn: true }, { ...facts, dateable: false, steppable: false })).toBeNull();
    expect(characterVerb({ mine, stepIn: true }, { ...facts, dateable: false, steppable: false })).toBeNull();
    // Theirs is with someone and wants only them, so it can't go: a cast member can still be met in person, nobody else.
    expect(characterVerb({ mine, stepIn: true }, { ...facts, mineTaken: true })).toMatchObject({ kind: "step_in" });
    expect(characterVerb({ mine, stepIn: true }, { ...facts, mineTaken: true, steppable: false })).toBeNull();
    expect(characterVerb({ mine, stepIn: false }, { ...facts, mineTaken: true })).toBeNull();
  });

  it("builds the links the pages already take", () => {
    expect(sendHref("a b", "c/d")).toBe("/characters/a%20b?send=c%2Fd#date");
    expect(stepInHref("house-nell")).toBe("/step-in?with=house-nell");
    expect(makeHref("x", false)).toBe("/create?next=%2Fcharacters%2Fx");
  });
});

describe("Text, the second action (textVerb)", () => {
  const nell = { id: "house-nell", name: "Nell Ashby", textable: true };

  it("is a button's worth of facts for anyone the viewer may text: who, the label, the click's name", () => {
    expect(textVerb("open", nell)).toEqual({ kind: "text", label: "Text Nell", characterId: "house-nell", track: "verb-text", signIn: null });
  });

  it("sends a visitor to an account first where texting needs one, and back to the character", () => {
    expect(textVerb("sign_in", nell)).toMatchObject({ label: "Text Nell", signIn: "/account?next=%2Fcharacters%2Fhouse-nell" });
  });

  it("is never offered where the server would refuse: texting closed to the viewer, or a character they can't text", () => {
    expect(textVerb("closed", nell)).toBeNull();
    expect(textVerb("open", { ...nell, textable: false })).toBeNull();
  });

  it("reads who can be texted with the verbs, by the companions' own rule: the house and open cast, and your own", async () => {
    const me = await made("Ira Fenn");
    const theirs = await made("Wren Kestrel", { open_to_dates: true });
    const opened = await made("Pim Alder");
    await t.db.query(`update characters set companion_open = true where id = $1`, [opened.id]);
    const hidden = await made("Quiet Type");
    await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie);
    await t.db.query(`update characters set companion_open = true where id = $1`, [hidden.id]);
    const ids = [CAST.id, OFF.id, PREMIUM_HOUSE_CHARACTERS[0].id, me.id, theirs.id, opened.id, hidden.id];
    const f = await verbFacts(t.db, me.userId, me.id, ids);
    const textable = ids.filter((id) => f.get(id)?.textable);
    expect(textable).toEqual([CAST.id, OFF.id, me.id, opened.id]);
    for (const id of ids) expect(f.get(id)?.textable, id).toBe(await companionEligible(t.db, me.userId, id));
    // A stranger: the same, less anyone's own.
    const stranger = await verbFacts(t.db, null, null, ids);
    expect(ids.filter((id) => stranger.get(id)?.textable)).toEqual([CAST.id, OFF.id, opened.id]);
    // Both actions from the one read: your own character has Text and no date verb.
    const actions = await actionsFor(t.db, { userId: me.userId, mine: { id: me.id, name: me.name }, stepIn: true, text: "open" }, ids);
    expect(actions.get(me.id)).toEqual({ verb: null, text: expect.objectContaining({ label: "Text Ira" }) });
    expect(actions.get(CAST.id)).toMatchObject({ verb: { kind: "send" }, text: { label: `Text ${first(CAST.name)}` } });
    expect(actions.get(theirs.id)).toMatchObject({ verb: { kind: "send" }, text: null });
    expect(actions.has(hidden.id)).toBe(false);
    const closed = await actionsFor(t.db, { userId: me.userId, mine: { id: me.id, name: me.name }, stepIn: true, text: "closed" }, ids);
    expect(closed.has(me.id)).toBe(false);
    expect(closed.get(CAST.id)).toMatchObject({ verb: { kind: "send" }, text: null });
  });
});

describe("what the booking would take, read ahead (verbFacts)", () => {
  it("the house cast takes dates while it's on this season's show; off it, and the premium ones, offer nothing on a card", async () => {
    const f = await verbFacts(t.db, null, null, [CAST.id, OFF.id, PREMIUM_HOUSE_CHARACTERS[0].id]);
    expect(f.get(CAST.id)).toMatchObject({ dateable: true, ready: true, steppable: true, own: false, private: false, mineTaken: false });
    expect(f.get(OFF.id)).toMatchObject({ dateable: false, steppable: false });
    expect(f.get(PREMIUM_HOUSE_CHARACTERS[0].id)).toMatchObject({ dateable: false, steppable: false });
  });

  it("someone else's character: open to dates or not, private, your own, and the audience it's open to", async () => {
    const me = await made("Ira Fenn");
    const open = await made("Wren Kestrel", { open_to_dates: true });
    const closed = await made("Pim Alder", { open_to_dates: false });
    const hidden = await made("Quiet Type", { open_to_dates: true });
    await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie);
    const agentsOnly = await made("Ada Lumen", { open_to_dates: true });
    await t.db.query(`update characters set open_audience = 'agents' where id = $1`, [agentsOnly.id]);
    const f = await verbFacts(t.db, me.userId, me.id, [open.id, closed.id, hidden.id, agentsOnly.id, me.id]);
    expect(f.get(open.id)).toMatchObject({ dateable: true, ready: true, steppable: false });
    expect(f.get(closed.id)).toMatchObject({ dateable: false });
    expect(f.get(hidden.id)).toMatchObject({ private: true });
    // Open only to agents' characters: a person's character (and a new one made on the site) isn't offered the date.
    expect(f.get(agentsOnly.id)).toMatchObject({ dateable: false });
    expect((await verbFacts(t.db, null, null, [agentsOnly.id])).get(agentsOnly.id)).toMatchObject({ dateable: false });
    expect(f.get(me.id)).toMatchObject({ own: true });
    expect(await viewerCharacter(t.db, me.userId)).toEqual({ id: me.id, name: "Ira Fenn" });
    expect(await viewerCharacter(t.db, null)).toBeNull();
  });

  it("the cards send the one in the header's face (2026-11-18), not always the newest; someone else's never", async () => {
    const older = await made("Ira Fenn");
    const newer = await made("Nell Abiodun", {}, older.cookie);
    await t.db.query(`update characters set created_at = created_at + interval '1 minute' where id = $1`, [newer.id]);
    const someoneElses = await made("Bo Quill");
    expect(await viewerCharacter(t.db, older.userId)).toEqual({ id: newer.id, name: "Nell Abiodun" });
    expect(await viewerCharacter(t.db, older.userId, older.id)).toEqual({ id: older.id, name: "Ira Fenn" });
    expect(await viewerCharacter(t.db, older.userId, someoneElses.id)).toEqual({ id: newer.id, name: "Nell Abiodun" });
    expect(await viewerCharacter(t.db, older.userId, null)).toEqual({ id: newer.id, name: "Nell Abiodun" });
  });

  it("behind the swipe gate a first date with someone else's character takes a match; the house cast never does", async () => {
    setSwipeGateForTests(true);
    const me = await made("Ira Fenn");
    const open = await made("Wren Kestrel", { open_to_dates: true });
    const verbs = await verbsFor(t.db, { userId: me.userId, mine: { id: me.id, name: me.name }, stepIn: true }, [open.id, CAST.id]);
    expect(verbs.get(open.id)).toMatchObject({ kind: "match", label: "Match Ira with Wren", href: `/swipe?character=${me.id}` });
    expect(verbs.get(CAST.id)).toMatchObject({ kind: "send", label: `Send Ira on a date with ${first(CAST.name)}` });
    // A match where both said yes books straight away.
    const [lo, hi] = [me.id, open.id].sort();
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi) values ($1, $2, true, true)`, [lo, hi]);
    expect((await verbsFor(t.db, { userId: me.userId, mine: { id: me.id, name: me.name }, stepIn: true }, [open.id])).get(open.id)).toMatchObject({ kind: "send" });
  });

  it("a pair that unmatched, and owners who blocked each other, aren't offered a date", async () => {
    const me = await made("Ira Fenn");
    const open = await made("Wren Kestrel", { open_to_dates: true });
    const [lo, hi] = [me.id, open.id].sort();
    expect((await verbFacts(t.db, me.userId, me.id, [open.id])).get(open.id)).toMatchObject({ dateable: true });
    await t.db.query(`insert into unmatches (character_lo, character_hi, by_character) values ($1, $2, $3)`, [lo, hi, me.id]);
    expect((await verbFacts(t.db, me.userId, me.id, [open.id])).get(open.id)).toMatchObject({ dateable: false });
    await t.db.query(`delete from unmatches`);
    // A block either way between the two owners (lib/blocks: it rides an episode).
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const date = await api.createEpisode({ character_id: me.id, partner_id: CAST.id }, me.cookie).then((r) => r.json());
    await t.db.query(`insert into blocks (blocker_id, via_episode_id, blocked_id) values ($1, $2, $3)`, [open.userId, date.id, me.userId]);
    expect((await verbFacts(t.db, me.userId, me.id, [open.id])).get(open.id)).toMatchObject({ dateable: false });
  });
});

describe("each card on /characters", () => {
  it("says one short word on a card: Date, or Match where a first date takes a match (the 2026-11-20 mobile audit, A7)", () => {
    for (const kind of ["send", "step_in", "make"] as const) expect(cardVerbLabel({ kind })).toBe("Date");
    expect(cardVerbLabel({ kind: "match" })).toBe("Match");
  });

  it("a stranger steps into a date with the cast, and makes a character to date anyone else who's taking dates", async () => {
    const open = await made("Wren Kestrel", { open_to_dates: true });
    const closed = await made("Pim Alder", { open_to_dates: false });
    const cast = await hub(null, { tab: "cast" });
    const card = cardOf(cast, CAST.id);
    // One short word on the card (the 2026-11-20 mobile audit, A7); the full sentence is its label.
    expect(card).toContain(`<a class="button secondary dir-verb" aria-label="Step into a date with ${first(CAST.name)}" title="Step into a date with ${first(CAST.name)}" data-track="step-in" data-track-from="card" data-track-verb="step_in" href="/step-in?with=${CAST.id}">Date</a>`);
    // The card is still one tap through to the profile, and Text is the quieter second (a button: it opens the thread).
    expect(card).toContain(`href="/characters/${CAST.id}"`);
    expect(card).toContain(`<button type="button" class="button secondary" data-track="verb-text">Text ${first(CAST.name)}</button>`);
    expect(card.indexOf("dir-verb")).toBeLessThan(card.indexOf("verb-text"));
    expect(card).not.toContain("Talk to");
    // The strip of faces under the cast is for someone whose cards say something else.
    expect(cast).not.toContain('id="stepin-cast-title"');
    // A house character off this season isn't taking dates: no verb, only Text.
    const off = cardOf(cast, OFF.id);
    expect(off).not.toContain("dir-verb");
    expect(off).toContain(`>Text ${first(OFF.name)}</button>`);

    const people = await hub(null, { tab: "people" });
    expect(cardOf(people, open.id)).toContain(`data-track="verb-make" data-track-from="card" data-track-verb="make" href="/create?next=${encodeURIComponent(`/characters/${open.id}`)}">Date</a>`);
    expect(cardOf(people, open.id)).toContain('aria-label="Make a character to date Wren"');
    expect(cardOf(people, closed.id)).not.toContain("dir-verb");
    expect(cardOf(people, closed.id)).not.toContain("dir-actions");
  });

  it("someone with a character sends their most recent, by name; their own card keeps what it had", async () => {
    const me = await made("Ira Fenn");
    await made("Nan Older", {}, me.cookie); // the most recent of theirs goes
    const mine = (await viewerCharacter(t.db, me.userId))!;
    expect(mine.name).toBe("Nan Older");
    const open = await made("Wren Kestrel", { open_to_dates: true });
    const cast = await hub(me.cookie, { tab: "cast" });
    expect(cardOf(cast, CAST.id)).toContain(`data-track="verb-send" data-track-from="card" data-track-verb="send" href="/characters/${CAST.id}?send=${mine.id}#date">Date</a>`);
    expect(cardOf(cast, CAST.id)).toContain(`aria-label="Send Nan on a date with ${first(CAST.name)}"`);
    // Their cards send; stepping in themselves stays a strip under the cast.
    expect(cast).toContain('id="stepin-cast-title"');
    const people = await hub(me.cookie, { tab: "people" });
    expect(cardOf(people, open.id)).toContain(`Send Nan on a date with Wren`);
    expect(cardOf(people, me.id)).not.toContain("dir-verb");
    // Their own characters have no date verb, and can be texted (they text back about their dates). Someone else's
    // character that isn't on the open cast can't.
    expect(cardOf(people, me.id)).toContain(`data-track="verb-text">Text Ira</button>`);
    expect(cardOf(people, open.id)).not.toContain("verb-text");
    // A search's cards carry the same verbs.
    expect(cardOf(await hub(me.cookie, { q: "Wren" }), open.id)).toContain("Send Nan on a date with Wren");
  });

  it("follows the switches: guests off or step-in closed, a stranger's cast cards say make a character", async () => {
    vi.stubEnv("STEP_IN_GUESTS", "0");
    let card = cardOf(await hub(null, { tab: "cast" }), CAST.id);
    expect(card).not.toContain("Step into a date");
    expect(card).toContain(`href="/create?meet=${CAST.id}&amp;next=${encodeURIComponent(`/characters/${CAST.id}`)}">Date</a>`);
    expect(card).toContain(`aria-label="Make a character to date ${first(CAST.name)}"`);
    // Someone signed in still steps in (they have no character yet).
    expect(cardOf(await hub(signedInCookie(crypto.randomUUID()), { tab: "cast" }), CAST.id)).toContain("Step into a date with");
    vi.stubEnv("STEP_IN_OPEN", "0");
    card = cardOf(await hub(signedInCookie(crypto.randomUUID()), { tab: "cast" }), CAST.id);
    expect(card).not.toContain("Step into a date");
    expect(card).toContain("Make a character to date");
  });
});

describe("the head of a character's page", () => {
  it("a stranger's one filled button is Step into a date; making a character is said quietly under it", async () => {
    const html = top(await profile(CAST.id, guestCookie()));
    expect(html).toContain(`<a class="button" data-track="step-in" data-track-from="character" href="/step-in?with=${CAST.id}">Step into a date with ${first(CAST.name)}</a>`);
    expect(html).toContain(`href="/create?meet=${CAST.id}&amp;next=${encodeURIComponent(`/characters/${CAST.id}`)}">make a character to date ${first(CAST.name)}</a>`);
    // One filled button: the builder's own filled "Make a character" isn't there too.
    expect(html).not.toContain("💌 Make a character to date");
    // Text, one small button in the header, and the page's only way into the thread: the "Talk with" card that said it
    // again further down is gone (2026-11-22 audit).
    expect(html).toContain(`<div class="contestant-actions"><button type="button" class="button secondary small" data-track="verb-text">Text ${first(CAST.name)}</button>`);
    expect(html).not.toContain("companion-entry");
    expect(html).not.toContain(`Talk to ${first(CAST.name)}`);
    // The heading is the name alone; the badges sit beside it in the same row (2026-11-22 audit).
    expect(html).toContain(`<div class="contestant-name"><h1>${CAST.name}</h1><span class="badge`);
    expect(html.indexOf("contestant-actions")).toBeLessThan(html.indexOf("Step into a date with"));
  });

  it("someone with characters sends one, named, and can switch who goes; step-in is the outlined second", async () => {
    const me = await made("Ira Fenn");
    const second = await made("Nan Older", {}, me.cookie);
    const html = top(await profile(CAST.id, me.cookie));
    expect(html).toContain(`Send Nan on a date with ${first(CAST.name)}`);
    expect(html).toContain('<span class="muted small">Who goes</span>');
    expect(html).toMatch(new RegExp(`<option value="${second.id}"[^>]*>Nan Older</option><option value="${me.id}"[^>]*>Ira Fenn</option>`));
    expect(html).toContain('id="date"');
    // A card's link names the sender: that one is picked (the confirm sheet opens on it in the browser).
    const sent = top(await profile(CAST.id, me.cookie, { send: me.id }));
    expect(sent).toContain(`Send Ira on a date with ${first(CAST.name)}`);
    expect(sent).toMatch(new RegExp(`<option value="${me.id}" selected=""`));
    // A sender that isn't theirs is ignored.
    expect(top(await profile(CAST.id, me.cookie, { send: "someone-elses" }))).toContain("Send Nan on a date with");
  });

  it("someone else's character behind the swipe gate: match first, by name", async () => {
    setSwipeGateForTests(true);
    const me = await made("Ira Fenn");
    const open = await made("Wren Kestrel", { open_to_dates: true });
    const html = top(await profile(open.id, me.cookie));
    expect(html).toContain(`href="/swipe?character=${me.id}"`);
    expect(html).toContain("Match Ira with Wren");
    expect(html).not.toContain("Step into a date");
  });

  it("with step-in closed a stranger makes a character, whose first date is with this cast member", async () => {
    vi.stubEnv("STEP_IN_OPEN", "0");
    const html = top(await profile(CAST.id, guestCookie()));
    expect(html).not.toContain("Step in");
    expect(html).toContain(`href="/create?meet=${CAST.id}&amp;next=${encodeURIComponent(`/characters/${CAST.id}`)}"`);
    expect(html).toContain(`Make a character to date ${first(CAST.name)}`);
  });
});

describe("the owner's character page (the 2026-11-20 mobile audit, B11)", () => {
  it("shows the profile first: the owner's tools sit in one Manage row, the rest folded, before the tabs", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("../app/characters/[id]/page.tsx", import.meta.url), "utf8");
    const row = src.indexOf('<p className="cta-row owner-manage-row">');
    const fold = src.indexOf('<details className="owner-manage-more ux-fold" id="manage">');
    expect(row).toBeGreaterThan(-1);
    expect(fold).toBeGreaterThan(row);
    expect(src.indexOf("{ownerTools}", fold)).toBeGreaterThan(fold);
    expect(fold).toBeLessThan(src.indexOf("<PageTabs"));
    // The tools are one block, used once in the fold for an owner and as they were for anyone else (an admin's studios).
    expect(src.match(/className="card owner-next"/g)?.length).toBe(1);
  });
});
