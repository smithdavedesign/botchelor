// "The character asks you the rest" (lib/character-questions.ts, lib/character-question-fields.ts; 2026-11-15, with
// one-sentence create): after its first date a character asks its owner about its own sheet, one question a day, five in
// all, never after two went unanswered. The answer box saves through the edit route's own checks. Templates only: a
// model call here would be a bug.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as companionPost } from "@/app/api/companion/[id]/route";
import { sendAfterDateText } from "@/lib/after-date-text";
import { signSession } from "@/lib/auth";
import {
  ackLines,
  characterQuestionsOn,
  fieldState,
  hobbiesFrom,
  MAX_QUESTIONS,
  nextQuestion,
  openQuestion,
  plainAckLines,
  QUESTION_FIELDS,
  questionLines,
  QUESTIONS,
  saidBack,
  withAnswer,
} from "@/lib/character-question-fields";
import { sendCharacterQuestions } from "@/lib/character-questions";
import { getThread, openThread, setCompanionModelForTests } from "@/lib/companion";
import { crisisIntent } from "@/lib/crisis";
import { ExtrasInput, normaliseExtras, type CharacterExtras } from "@/lib/extras";
import { fillProfile } from "@/lib/profile-fill";
import { checkFamilyTalk } from "@/lib/safety";
import { api, BASE_URL, setupEpisode, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
  setCompanionModelForTests({
    async complete() {
      throw new Error("the model must not be called for a question or an answer");
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const HOUR = 3_600_000;
/** The "Hear from" tap happened here; the job's days are counted from it. */
const T0 = new Date("2026-11-13T20:00:00Z");
const day = (n: number) => new Date(T0.getTime() + n * 24 * HOUR);

/** A person's own date: a character with a name of their own (validCharacter's "Mira Quell" is one of OUR_TEST_NAMES, so its owner counts as ours). */
async function personsDate(extras?: CharacterExtras) {
  const r = await setupEpisode("friends");
  await t.db.query(`update characters set name = 'Lexi Marlowe', extras = $2::jsonb where id = $1`, [r.character.id, JSON.stringify(extras ?? {})]);
  return r;
}
/** The "Hear from" tap: the after-date text, and the thread's proactive texts on (what the route does). */
async function optIn(creator: string, episodeId: string) {
  const r = await sendAfterDateText(t.db, { userId: userIdOf(creator), episodeId, now: T0 });
  if (!r.ok) throw new Error(r.error);
  await t.db.query(`update companion_threads set muted_proactive = false where id = $1`, [r.thread_id]);
  return r.thread_id;
}
/** A creator whose character has dated and who opted in to its texts. */
async function owner(extras?: CharacterExtras) {
  const r = await personsDate(extras);
  const threadId = await optIn(r.creator, r.episode.id);
  const me = userIdOf(r.creator);
  return { ...r, me, threadId, cookie: `bz_sess=${signSession({ uid: me, authenticated: false })}; bz_adult=1` };
}

const questions = async (threadId: string) =>
  (await t.db.query<{ id: string; text: string; action: string; offers: Any }>(`select id, text, action, offers from companion_messages where thread_id = $1 and action like 'question:%' order by created_at, id`, [threadId])).rows;
const said = async (threadId: string, prefix: string) =>
  (await t.db.query<{ text: string }>(`select text from companion_messages where thread_id = $1 and role = 'character' and action like $2 order by created_at, id`, [threadId, `${prefix}%`])).rows.map((r) => r.text);
const extrasOf = async (id: string) => (await t.db.query<{ extras: CharacterExtras }>(`select extras from characters where id = $1`, [id])).rows[0].extras;
const boxes = async (me: string, threadId: string) => {
  const v = await getThread(t.db, me, threadId);
  if (!v.ok) throw new Error("no thread");
  return v.view.messages.filter((m) => m.question).map((m) => ({ id: m.id, ...m.question! }));
};
const answer = async (cookie: string, threadId: string, messageId: string, text?: string) => {
  const res = await companionPost(
    new Request(`${BASE_URL}/api/companion/${threadId}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ action: "offer", offer: "answer", message_id: messageId, ...(text === undefined ? {} : { text }) }) }),
    { params: Promise.resolve({ id: threadId }) },
  );
  return { status: res.status, body: (await res.json()) as Any };
};

const SHEET = { traits: ["wry", "patient", "guarded"], want: "Someone who stays up for the shipping forecast" };

describe("the fields and the words (pure)", () => {
  it("asks only about what is empty or the show's own fill, in order, each once", () => {
    // A bare sheet: everything is empty, the job comes first.
    expect(nextQuestion({ extras: {}, ...SHEET }, [])).toBe("occupation");
    expect(QUESTION_FIELDS.map((f) => fieldState({ extras: {}, ...SHEET }, f))).toEqual(QUESTION_FIELDS.map(() => "empty"));
    // A first character as Create leaves it (lib/profile-fill.ts): the interests and the profile answer are the show's.
    const filled = fillProfile({}, SHEET);
    const c = { extras: filled, ...SHEET };
    expect(fieldState(c, "hobbies")).toBe("auto");
    expect(fieldState(c, "dating_me_is_like")).toBe("auto");
    expect(nextQuestion(c, ["occupation"])).toBe("hobbies");
    // The owner's own words are never asked about: one changed interest, one rewritten answer.
    const theirs = { ...c, extras: { ...filled, occupation: "Lighthouse keeper", hobbies: ["Shortwave radio", filled.hobbies![1]], prompts: filled.prompts!.map((p) => (p.id === "dating_me_is_like" ? { ...p, answer: "A radio that only gets the weather." } : p)) } };
    expect(fieldState(theirs, "occupation")).toBe("filled");
    expect(fieldState(theirs, "hobbies")).toBe("filled");
    expect(fieldState(theirs, "dating_me_is_like")).toBe("filled");
    expect(nextQuestion(theirs, [])).toBe("ideal_first_date");
    // Each once, and nothing when everything is asked or theirs.
    expect(nextQuestion(theirs, ["ideal_first_date", "hometown"])).toBe("go_to_order");
    expect(nextQuestion(theirs, [...QUESTION_FIELDS])).toBeNull();
    // A full profile of the owner's own three answers has no room for a fourth: not asked.
    const full = { ...SHEET, extras: { prompts: [{ id: "geek_out" as const, answer: "Maps." }, { id: "win_me_over" as const, answer: "Snacks." }, { id: "fall_for_you" as const, answer: "You ask twice." }] } };
    expect(fieldState(full, "dating_me_is_like")).toBe("filled");
  });

  it("puts an answer where an edit of that field would, and never over the owner's own words", () => {
    const filled = fillProfile({}, SHEET);
    const c = { extras: filled, ...SHEET };
    expect(withAnswer(c, "occupation", "  Lighthouse   keeper ")!.occupation).toBe("Lighthouse keeper");
    // The show's guess is replaced by the list they typed.
    expect(hobbiesFrom("night swims, bad karaoke and old radios")).toEqual(["night swims", "bad karaoke", "old radios"]);
    expect(withAnswer(c, "hobbies", "night swims, bad karaoke")!.hobbies).toEqual(["night swims", "bad karaoke"]);
    // Their own interests, written since, are kept, with the answer beside them.
    const own = { ...c, extras: { ...filled, hobbies: ["Chess", "Tarot"] } };
    expect(withAnswer(own, "hobbies", "chess, night swims")!.hobbies).toEqual(["Chess", "Tarot", "night swims"]);
    const prompt = withAnswer(c, "dating_me_is_like", "A long walk that turns into a whole day")!.prompts!;
    expect(prompt.find((p) => p.id === "dating_me_is_like")!.answer).toBe("A long walk that turns into a whole day");
    expect(prompt).toHaveLength(filled.prompts!.length);
    expect(withAnswer(c, "hello", "You're on time. I like that.")!.lines).toEqual({ hello: "You're on time. I like that." });
    // No room: null, and the route says it's already on the sheet.
    const full = { ...SHEET, extras: { prompts: [{ id: "geek_out" as const, answer: "Maps." }, { id: "win_me_over" as const, answer: "Snacks." }, { id: "fall_for_you" as const, answer: "You ask twice." }] } };
    expect(withAnswer(full, "dating_me_is_like", "A storm")).toBeNull();
    // Every result is something the sheet's own schema takes.
    for (const f of QUESTION_FIELDS) expect(ExtrasInput.safeParse(normaliseExtras(withAnswer(c, f, "night swims")!)).success).toBe(true);
  });

  it("every question is one bubble in the character's voice, PG, and never nags; the thanks too", () => {
    expect(questionLines("occupation")).toEqual(["Random question. What do I do for work? I feel like I should know."]);
    for (const f of QUESTION_FIELDS) {
      const lines = [...questionLines(f), ...ackLines(f, "Lighthouse keeper"), ...ackLines(f, "x".repeat(90)), ...plainAckLines()];
      expect(questionLines(f)).toHaveLength(1);
      expect(questionLines(f)[0]).toMatch(/\?/);
      // First person: the character is asking about itself.
      expect(questionLines(f)[0]).toMatch(/\b(I|me|my)\b/);
      for (const l of lines) {
        expect(checkFamilyTalk(l).ok).toBe(true);
        expect(crisisIntent(l)).toBe(false);
        expect(l).not.toMatch(/miss you|where were you|you never|haven't heard|been quiet|please answer|still waiting|you didn't/i);
        expect(l.length).toBeLessThanOrEqual(160);
      }
      // The box knows the sheet's own limit for the field.
      expect(QUESTIONS[f].max).toBeGreaterThan(0);
      expect(QUESTIONS[f].placeholder.length).toBeLessThanOrEqual(QUESTIONS[f].max);
    }
    expect(ackLines("occupation", "lighthouse keeper.")).toEqual(["Lighthouse keeper. Of course. That explains a lot about me."]);
    // Too long to say back: the plain thanks.
    expect(saidBack("x".repeat(61))).toBeNull();
    expect(ackLines("occupation", "x".repeat(61))).toEqual(plainAckLines());
  });

  it("the box is on the newest question only, and only until it's answered", () => {
    const q = (id: string, field: string, taken = false) => ({ id, role: "character", offers: { kinds: ["answer"], field, ...(taken ? { taken: { kind: "answer", at: "2026-11-14T00:00:00Z" } } : {}) } });
    const chips = { id: "m0", role: "character", offers: { episode_id: "e1", partner_id: "p1", partner: "Teo", kinds: ["advice"] } };
    expect(openQuestion([chips])).toBeNull();
    expect(openQuestion([chips, q("m1", "occupation")])).toMatchObject({ messageId: "m1", view: { field: "occupation", label: "Their job", max: 60 } });
    expect(openQuestion([q("m1", "occupation"), q("m2", "hobbies")])?.messageId).toBe("m2");
    expect(openQuestion([q("m1", "occupation"), q("m2", "hobbies", true)])).toBeNull();
    expect(openQuestion([q("m1", "not_a_field")])).toBeNull();
    expect(characterQuestionsOn({})).toBe(true);
    expect(characterQuestionsOn({ CHARACTER_QUESTIONS: "0" })).toBe(false);
  });
});

describe("who gets one (the daily job's step)", () => {
  it("an opted-in owner whose character has dated gets one question, with its answer box, and the date's chips stay", async () => {
    const o = await owner();
    // The day of the date the character already texted about it: nothing more today.
    expect(await sendCharacterQuestions(t.db, new Date(T0.getTime() + HOUR))).toMatchObject({ sent: 0 });
    expect(await sendCharacterQuestions(t.db, day(1))).toMatchObject({ sent: 1, stopped: 0 });
    const [q] = await questions(o.threadId);
    expect(q.text).toBe("Random question. What do I do for work? I feel like I should know.");
    expect(q.action).toBe("question:occupation");
    expect(q.offers).toEqual({ kinds: ["answer"], field: "occupation" });
    expect(await boxes(o.me, o.threadId)).toEqual([{ id: q.id, field: "occupation", label: "Their job", placeholder: "Lighthouse keeper", max: 60 }]);
    // The question is not a date's menu: the chips under the text about the date are still there.
    const v = await getThread(t.db, o.me, o.threadId);
    if (!v.ok) throw new Error("no thread");
    expect(v.view.messages.filter((m) => m.offers).length).toBe(1);
    // The tag is bookkeeping, never a stage direction on the page.
    expect(v.view.messages.find((m) => m.id === q.id)!.action).toBeNull();
    // The person is told, like any text from their character.
    const kinds = (await t.db.query<{ kind: string }>(`select kind from notifications where user_id = $1`, [o.me])).rows.map((r) => r.kind);
    expect(kinds.filter((k) => k === "character_texted_you").length).toBe(2);
  });

  it("nobody else does: not opted in, paused, no date yet, ours, or with the switch off", async () => {
    // Opened from Talk (never tapped "Hear from"): muted, so nothing.
    const quiet = await personsDate();
    const opened = await openThread(t.db, userIdOf(quiet.creator), quiet.character.id, T0, { opener: false });
    expect(opened.ok).toBe(true);
    // Paused (the crisis resources are up).
    const paused = await owner();
    await t.db.query(`update companion_threads set paused_at = now() where id = $1`, [paused.threadId]);
    // Opted in, but the character has never been on a date.
    const undated = `bz_uid=${crypto.randomUUID()}`;
    const fresh = await (await api.createCharacter(validCharacter({ name: "Odile Ferrant" }), undated)).json();
    const freshThread = await openThread(t.db, userIdOf(undated), fresh.id, T0, { opener: false });
    if (!freshThread.ok) throw new Error("no thread");
    await t.db.query(`update companion_threads set muted_proactive = false where id = $1`, [freshThread.thread_id]);
    // Ours: a test-named character's owner (lib/our-traffic.ts OUR_TEST_NAMES) is skipped even when opted in.
    const ours = await setupEpisode("friends");
    await optIn(ours.creator, ours.episode.id);
    expect(await sendCharacterQuestions(t.db, day(1))).toMatchObject({ sent: 0 });
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from companion_messages where action like 'question:%'`)).rows[0].n).toBe(0);

    // The switch: CHARACTER_QUESTIONS=0 sends none, even to someone who would get one.
    const o = await owner();
    vi.stubEnv("CHARACTER_QUESTIONS", "0");
    expect(await sendCharacterQuestions(t.db, day(1))).toEqual({ sent: 0, stopped: 0, candidates: 0 });
    vi.stubEnv("CHARACTER_QUESTIONS", "1");
    expect(await sendCharacterQuestions(t.db, day(1))).toMatchObject({ sent: 1 });
    expect((await questions(o.threadId)).length).toBe(1);
  });

  it("asks only about what the owner left empty or the show filled, and nothing when the sheet is theirs", async () => {
    const mine: CharacterExtras = {
      occupation: "Lighthouse keeper",
      hometown: "Lisbon",
      ideal_first_date: "A long walk",
      go_to_order: "Black coffee",
      pet_peeve: "Whistling indoors",
      hobbies: ["Chess", "Tarot"],
      prompts: [{ id: "dating_me_is_like", answer: "A radio that only gets the weather." }, { id: "geek_out", answer: "Maps." }],
      lines: { hello: "You're on time." },
    };
    const done = await owner(mine);
    expect(await sendCharacterQuestions(t.db, day(1))).toMatchObject({ sent: 0 });
    expect(await questions(done.threadId)).toEqual([]);
    // Only the hello line is missing: that is the question.
    await t.db.query(`update characters set extras = extras - 'lines' where id = $1`, [done.character.id]);
    expect(await sendCharacterQuestions(t.db, day(1))).toMatchObject({ sent: 1 });
    expect((await questions(done.threadId)).map((q) => q.action)).toEqual(["question:hello"]);
  });
});

describe("one a day, five in all, and it stops when nobody answers", () => {
  it("asks one a day while they answer, never twice in a day, and at most five ever", async () => {
    const o = await owner();
    const asked: string[] = [];
    for (let d = 1; d <= MAX_QUESTIONS + 2; d++) {
      const run = await sendCharacterQuestions(t.db, day(d));
      // The same day again (the job run twice, or an hour later): nothing more.
      expect(await sendCharacterQuestions(t.db, new Date(day(d).getTime() + HOUR))).toMatchObject({ sent: 0 });
      if (d > MAX_QUESTIONS) {
        expect(run.sent).toBe(0);
        continue;
      }
      expect(run.sent).toBe(1);
      const all = await questions(o.threadId);
      expect(all).toHaveLength(d);
      const q = all[all.length - 1];
      asked.push(q.action);
      // Answered within the hour: the next day's question is due 20 hours after the thanks.
      const text = q.action === "question:hobbies" ? "night swims, bad karaoke" : `Answer number ${d}`;
      vi.useFakeTimers({ now: new Date(day(d).getTime() + 2 * HOUR), toFake: ["Date"] });
      try {
        expect((await answer(o.cookie, o.threadId, q.id, text)).status).toBe(200);
      } finally {
        vi.useRealTimers();
      }
    }
    expect(asked).toEqual(["question:occupation", "question:hobbies", "question:ideal_first_date", "question:hometown", "question:dating_me_is_like"]);
    expect(await questions(o.threadId)).toHaveLength(MAX_QUESTIONS);
  });

  it("stops for good after two in a row go unanswered, and a late answer never restarts it", async () => {
    const o = await owner();
    expect(await sendCharacterQuestions(t.db, day(1))).toMatchObject({ sent: 1 });
    // One unanswered is not two: the next day it asks the next thing.
    expect(await sendCharacterQuestions(t.db, day(2))).toMatchObject({ sent: 1, stopped: 0 });
    // Two in a row with no answer: nothing is sent, and the last one is marked.
    expect(await sendCharacterQuestions(t.db, day(3))).toMatchObject({ sent: 0, stopped: 1 });
    let all = await questions(o.threadId);
    expect(all.map((q) => q.action)).toEqual(["question:occupation", "question:hobbies"]);
    expect(all[1].offers.stopped).toBe(true);
    // Silence is never answered with another text: not the next day, not next week, not next month.
    for (const d of [4, 5, 10, 40]) expect(await sendCharacterQuestions(t.db, day(d))).toEqual({ sent: 0, stopped: 0, candidates: 0 });
    expect(await questions(o.threadId)).toHaveLength(2);
    // The box stays on the last one, and answering it saves; the character says thanks, and still asks nothing more.
    expect((await boxes(o.me, o.threadId)).map((b) => b.field)).toEqual(["hobbies"]);
    expect((await answer(o.cookie, o.threadId, all[1].id, "night swims, bad karaoke")).status).toBe(200);
    expect((await extrasOf(o.character.id)).hobbies).toEqual(["night swims", "bad karaoke"]);
    for (const d of [41, 42, 80]) expect(await sendCharacterQuestions(t.db, day(d))).toMatchObject({ sent: 0 });
    all = await questions(o.threadId);
    expect(all).toHaveLength(2);
    expect(all[1].offers).toMatchObject({ stopped: true, taken: { kind: "answer" } });
  });

  it("an answer in between starts the count again", async () => {
    const o = await owner();
    await sendCharacterQuestions(t.db, day(1));
    await sendCharacterQuestions(t.db, day(2));
    const second = (await questions(o.threadId))[1];
    vi.useFakeTimers({ now: new Date(day(2).getTime() + HOUR), toFake: ["Date"] });
    try {
      expect((await answer(o.cookie, o.threadId, second.id, "night swims, bad karaoke")).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    // Unanswered, answered: not two in a row, so the third goes out.
    expect(await sendCharacterQuestions(t.db, day(3))).toMatchObject({ sent: 1, stopped: 0 });
    expect((await questions(o.threadId)).map((q) => q.action)).toEqual(["question:occupation", "question:hobbies", "question:ideal_first_date"]);
  });
});

describe("the answer (POST /api/companion/:id {action: offer, offer: answer})", () => {
  async function asked(extras?: CharacterExtras) {
    const o = await owner(extras);
    await sendCharacterQuestions(t.db, day(1));
    const [q] = await questions(o.threadId);
    return { ...o, q };
  }

  it("saves to the sheet through the edit route, closes the box, and the character says thanks", async () => {
    const o = await asked();
    const r = await answer(o.cookie, o.threadId, o.q.id, "lighthouse keeper");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ answered: "occupation", said: true });
    expect((await extrasOf(o.character.id)).occupation).toBe("lighthouse keeper");
    expect(await said(o.threadId, "answer:")).toEqual(["Lighthouse keeper. Of course. That explains a lot about me."]);
    // The reply carries the thread: the box is gone, the thanks is in it.
    expect(r.body.view.messages.some((m: Any) => m.question)).toBe(false);
    expect(r.body.view.messages.at(-1).text).toBe("Lighthouse keeper. Of course. That explains a lot about me.");
    expect((await questions(o.threadId))[0].offers.taken.kind).toBe("answer");
    // Once: a second answer is refused and changes nothing.
    const again = await answer(o.cookie, o.threadId, o.q.id, "baker");
    expect(again.status).toBe(409);
    expect((await extrasOf(o.character.id)).occupation).toBe("lighthouse keeper");
  });

  it("an over-long answer gets the edit route's own words, saves nothing and keeps the box", async () => {
    const o = await asked();
    const r = await answer(o.cookie, o.threadId, o.q.id, "x".repeat(61));
    expect(r.status).toBe(422);
    expect(r.body.message).toBe("At most 60 characters.");
    expect((await extrasOf(o.character.id)).occupation).toBeUndefined();
    expect((await boxes(o.me, o.threadId)).map((b) => b.field)).toEqual(["occupation"]);
    expect(await said(o.threadId, "answer:")).toEqual([]);
    // Exactly at the limit is fine.
    expect((await answer(o.cookie, o.threadId, o.q.id, "x".repeat(60))).status).toBe(200);
  });

  it("an unsafe answer gets the sheet's own refusal, saves nothing and keeps the box", async () => {
    const o = await asked();
    const sexual = await answer(o.cookie, o.threadId, o.q.id, "porn star");
    expect(sexual.status).toBe(422);
    expect(sexual.body).toMatchObject({ error: "content_rejected", message: "Keep the character sheet free of sexual content." });
    const minor = await answer(o.cookie, o.threadId, o.q.id, "high school student");
    expect(minor.status).toBe(422);
    expect(minor.body.message).toBe("Characters must be adults, with nothing suggesting they are under 18.");
    const person = await answer(o.cookie, o.threadId, o.q.id, "Taylor Swift's stylist");
    expect(person.status).toBe(422);
    expect(person.body.message).toBe("Characters must be original: no real people.");
    expect((await extrasOf(o.character.id)).occupation).toBeUndefined();
    expect((await boxes(o.me, o.threadId)).length).toBe(1);
    expect(await said(o.threadId, "answer:")).toEqual([]);
  });

  it("a list of interests replaces the show's guess, under the sheet's own limits", async () => {
    const guess = fillProfile({ occupation: "Lighthouse keeper" }, { traits: validCharacter().traits as string[], want: validCharacter().want as string });
    const o = await asked(guess);
    expect(o.q.action).toBe("question:hobbies");
    const many = await answer(o.cookie, o.threadId, o.q.id, "a, b, c, d, e, f");
    expect(many.status).toBe(422);
    expect(many.body.message).toBe("At most 5 hobbies.");
    expect((await extrasOf(o.character.id)).hobbies).toEqual(guess.hobbies);
    const r = await answer(o.cookie, o.threadId, o.q.id, "Night swims, bad karaoke and old radios");
    expect(r.status).toBe(200);
    const after = await extrasOf(o.character.id);
    expect(after.hobbies).toEqual(["Night swims", "bad karaoke", "old radios"]);
    // The rest of the sheet is untouched.
    expect(after.occupation).toBe("Lighthouse keeper");
    expect(after.prompts).toEqual(guess.prompts);
  });

  it("is the owner's only, needs words, and never writes self-harm onto a sheet", async () => {
    const o = await asked();
    const stranger = `bz_sess=${signSession({ uid: crypto.randomUUID(), authenticated: false })}; bz_adult=1`;
    expect((await answer(stranger, o.threadId, o.q.id, "baker")).status).toBe(404);
    expect((await answer(o.cookie, o.threadId, o.q.id, "   ")).status).toBe(400);
    expect((await answer(o.cookie, o.threadId, o.q.id)).status).toBe(400);
    // A text that isn't a question has nothing to answer (the date's chips are not a box).
    const chips = (await t.db.query<{ id: string }>(`select id from companion_messages where thread_id = $1 and action like 'after_date:%' order by created_at limit 1`, [o.threadId])).rows[0];
    expect((await answer(o.cookie, o.threadId, chips.id, "baker")).status).toBe(404);
    const crisis = await answer(o.cookie, o.threadId, o.q.id, "I want to kill myself");
    expect(crisis.status).toBe(422);
    expect(crisis.body.crisis_resources).toBeTruthy();
    expect((await extrasOf(o.character.id)).occupation).toBeUndefined();
    // The character changed hands: its new owner edits its sheet, not this thread's person.
    await t.db.query(`update characters set owner_id = $2 where id = $1`, [o.character.id, crypto.randomUUID()]);
    expect((await answer(o.cookie, o.threadId, o.q.id, "baker")).status).toBe(403);
  });
});
