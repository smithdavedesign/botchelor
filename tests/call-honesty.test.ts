// Live calls get the same honesty as the rest of the site (an outside review, 2026-11-15): /costs prices a call minute
// part by part from numbers that can be traced, the call screen says what happens to the caller's audio and words
// before the microphone comes on, and the privacy notice and the FAQ state the same facts. The facts themselves are
// pinned against the code that makes them true, so the copy can't drift from what a call does.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import CallNotice, { CALL_NOTICE } from "@/app/companion/[id]/CallNotice";
import { PRIVACY_HEADINGS } from "@/app/legal/sections";
import PrivacyPage from "@/app/privacy/page";
import { CALL_MEASURED, CALL_PRICES, callEstimateBasis, callMinuteParts, callMinuteTotals, cents, TALKATIVE_CHARS_PER_MINUTE } from "@/lib/call-costs";
import { deleteThread } from "@/lib/companion";
import { deleteMessage } from "@/lib/companion-message-delete";
import { pruneLiveCalls, sttUrl } from "@/lib/companion-live";
import { answerText, faqs } from "@/lib/faq";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { startTestDb } from "./helpers";

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("what a minute of a live call costs (lib/call-costs.ts)", () => {
  const parts = callMinuteParts();
  const part = (id: string) => parts.find((p) => p.id === id)!;

  it("has the four parts, each a published price times what our calls used", () => {
    expect(parts.map((p) => p.id)).toEqual(["speech", "reply", "voice", "face"]);
    // Speech in: Deepgram's price a minute, English to multilingual.
    expect([part("speech").low, part("speech").high]).toEqual([CALL_PRICES.speechPerMinute.english, CALL_PRICES.speechPerMinute.multilingual]);
    // The reply: what a reply cost on our calls, times how many a minute.
    const reply = (CALL_MEASURED.repliesUsd / CALL_MEASURED.replies) * (CALL_MEASURED.turns / CALL_MEASURED.minutes);
    expect(part("reply").low).toBeCloseTo(reply, 10);
    expect(part("reply").high).toBe(part("reply").low);
    // The voice: Aura's price per 1,000 characters, at what our calls voiced a minute and at a talkative minute.
    expect(part("voice").low).toBeCloseTo(((CALL_MEASURED.voicedChars / CALL_MEASURED.minutes) * CALL_PRICES.voicePer1kChars) / 1000, 10);
    expect(part("voice").high).toBeCloseTo((TALKATIVE_CHARS_PER_MINUTE * CALL_PRICES.voicePer1kChars) / 1000, 10);
    // The face: a rented GPU's hour, by the minute.
    expect(part("face").low).toBeCloseTo(CALL_PRICES.gpuPerHour.low / 60, 10);
    expect(part("face").high).toBeCloseTo(CALL_PRICES.gpuPerHour.high / 60, 10);
  });

  it("shows them in cents, and the totals are the parts added up", () => {
    expect(parts.map((p) => cents(p.low, p.high))).toEqual(["0.5–0.6¢", "about 0.1¢", "0.4–1.1¢", "1.3–2.2¢"]);
    const totals = callMinuteTotals(parts);
    const sum = (ids: string[], end: "low" | "high") => ids.reduce((n, id) => n + part(id)[end], 0);
    expect(totals.voiceOnly.low).toBeCloseTo(sum(["speech", "reply", "voice"], "low"), 10);
    expect(totals.voiceOnly.high).toBeCloseTo(sum(["speech", "reply", "voice"], "high"), 10);
    expect(totals.withFace.low).toBeCloseTo(sum(["speech", "reply", "voice", "face"], "low"), 10);
    expect(totals.withFace.high).toBeCloseTo(sum(["speech", "reply", "voice", "face"], "high"), 10);
    expect(cents(totals.voiceOnly.low, totals.voiceOnly.high)).toBe("1.1–1.8¢");
    expect(cents(totals.withFace.low, totals.withFace.high)).toBe("2.3–4¢");
  });

  it("names every price and measure it used, so a reader can check the sum", () => {
    expect(part("speech").note).toContain("$0.0048");
    expect(part("speech").note).toContain("$0.0058");
    expect(part("reply").note).toContain(`${CALL_MEASURED.replies} replies`);
    expect(part("reply").note).toContain("$0.07");
    expect(part("reply").note).toContain("about 1.4 a minute");
    expect(part("voice").note).toContain("$0.030 per 1,000 characters");
    expect(part("voice").note).toContain("about 150 a minute");
    expect(part("voice").note).toContain(`${TALKATIVE_CHARS_PER_MINUTE} in a talkative one`);
    expect(part("face").note).toContain("$0.75–1.34 an hour");
    expect(part("face").note).toContain("Runpod");
    expect(callEstimateBasis()).toContain(CALL_PRICES.readOn);
    expect(callEstimateBasis()).toContain(`${CALL_MEASURED.minutes} minutes`);
  });

  it("prices the models a call really uses", () => {
    // The speech model the rates are for (Nova-3: English, else its multilingual model), opted out of training.
    expect(sttUrl({}, "en-GB")).toMatch(/model=nova-3&language=en&/);
    expect(sttUrl({}, "fr-FR")).toMatch(/model=nova-3&language=multi&/);
    expect(sttUrl({}, "en-US")).toContain("mip_opt_out=true");
    // The voice the rate is for: Aura-2, asked on the server, opted out of training too.
    const live = readFileSync("lib/companion-live.ts", "utf8");
    expect(live).toMatch(/aura-2-thalia-en/);
    expect(live).toMatch(/\/v1\/speak\?/);
    expect(live.match(/mip_opt_out/g)!.length).toBeGreaterThanOrEqual(3);
  });
});

describe("the line above the button that starts a call", () => {
  const render = (mode: "live" | "classic") => renderToStaticMarkup(createElement(CallNotice, { mode }));

  it("says where the audio goes, that the words are kept as messages, and how they're deleted, with the fuller page a tap away", () => {
    const live = strip(render("live"));
    expect(live).toContain("Your audio isn't kept: Deepgram turns it into words, and the words are saved as messages in this chat.");
    // Where both deletes live (one message, or the whole conversation): true whatever COMPANION_MESSAGE_DELETE is.
    expect(live).toContain("You can delete them later, in this chat's ⚙️ Settings.");
    const classic = strip(render("classic"));
    // Taking turns, the browser's own recognizer hears it: Chrome sends the audio to Google, Safari to Apple (the privacy notice).
    expect(classic).toContain("Your browser's speech service (Google in Chrome, Apple in Safari) hears you; we get only the words, as messages.");
    expect(classic).not.toContain("your browser turns it into words");
    expect(classic).toContain("You can delete them later, in this chat's ⚙️ Settings.");
    // And the menu it points at has them: one message at a time (when on), and the conversation.
    const chat = readFileSync("app/companion/[id]/CompanionChat.tsx", "utf8");
    const menu = chat.slice(chat.indexOf('<div className="companion-menu-body">'), chat.indexOf("</details>", chat.indexOf('<div className="companion-menu-body">')));
    expect(menu).toContain("Delete messages…");
    expect(menu).toContain("Delete this conversation");
    for (const html of [render("live"), render("classic")]) {
      // A new tab, so reading it doesn't close the call screen.
      expect(html).toMatch(/<a href="\/privacy#calls" target="_blank" rel="noopener"[^>]*>What a call keeps<\/a>/);
    }
    // Short enough for a phone: a few lines of small text at 390 px.
    for (const mode of ["live", "classic"] as const) expect(`${CALL_NOTICE[mode]} ${CALL_NOTICE.remove}`.length).toBeLessThan(170);
  });

  it("sits on the ready screen above the Call button, always, and never waits for a tap of its own", () => {
    const src = readFileSync("app/companion/[id]/CompanionCall.tsx", "utf8");
    const ready = src.slice(src.indexOf('<div className="companion-call-ready">'), src.indexOf('data-track="companion-call-start"'));
    expect(ready).toContain("<CallNotice mode={canLive && mode === \"live\" ? \"live\" : \"classic\"} />");
    // After the folded "How calls work", so it's the last thing read before the button; and outside it, so it's never folded.
    expect(ready.indexOf("</details>")).toBeLessThan(ready.indexOf("<CallNotice"));
    expect(ready.slice(ready.indexOf("<details"), ready.indexOf("</details>"))).not.toContain("<CallNotice");
    // The button still starts the call in one tap: nothing to tick, nothing to dismiss.
    expect(src).toContain('onClick={start} ref={mainButton} data-track="companion-call-start"');
    expect(readFileSync("app/companion/[id]/CallNotice.tsx", "utf8")).not.toMatch(/useState|onClick|<button|<input/);
  });

  it("is true to where the microphone goes: Deepgram's socket on a live call, the browser's recognition taking turns, never our server", () => {
    const src = readFileSync("app/companion/[id]/CompanionCall.tsx", "utf8");
    // Live: the microphone's samples go to the Deepgram socket and nowhere else.
    expect(src).toContain("await mic.current.start(audio, (pcm) => socket.current?.send(pcm));");
    const audio = readFileSync("app/companion/[id]/live-audio.ts", "utf8");
    expect(audio).toContain('new WebSocket(url, ["bearer", token])');
    expect(audio).not.toMatch(/MediaRecorder|fetch\(/);
    // What our server gets on a turn is text.
    expect(src).toContain('body: JSON.stringify({ action: "turn", call_id: id, text, frags: face.current?.frags() === true })');
    // Taking turns: the browser's own recognition.
    expect(src).toMatch(/w\.SpeechRecognition \?\? w\.webkitSpeechRecognition/);
  });
});

describe("the privacy notice's calls section", () => {
  const page = () => strip(renderToStaticMarkup(createElement(PrivacyPage)));
  const calls = (all: string) => all.slice(all.indexOf("Calls with a companion A call is"), all.indexOf("If you sign up for the Sunday letter"));
  const html = page();
  const section = calls(html);
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on the page, in its contents, where the call screen and /costs link to", () => {
    expect(PRIVACY_HEADINGS.map((h) => h.id)).toContain("calls");
    expect(renderToStaticMarkup(createElement(PrivacyPage))).toContain('<h2 id="calls">Calls with a companion</h2>');
    expect(section.length).toBeGreaterThan(500);
  });

  it("says what happens to the audio, the words, the voice and the face, and who gets each", () => {
    expect(section).toContain("We never receive it and never keep it.");
    expect(section).toContain("Chrome sends the audio to Google, Safari to Apple");
    expect(section).toContain("your browser sends your voice straight to Deepgram");
    expect(section).toContain("We ask Deepgram to leave it out of training");
    expect(section).toContain("is kept in the conversation as a message, marked 📞");
    expect(section).toContain("isn't kept. The transcript on the call screen lives only in that page.");
    expect(section).toContain("Deepgram makes it from the reply's words. The audio passes through our server to your browser and isn't kept.");
    expect(section).toContain("each reply is made as a voice note instead (by Venice or Replicate, from the reply's words)");
    expect(section).toContain("on GPUs we rent from Runpod. It is sent the character's portrait and the character's voice: never your voice, your words or who you are.");
  });

  it("says what's kept, for how long, and how to delete it, without promising what the code doesn't do", () => {
    expect(section).toContain("It's deleted after 90 days, or sooner with your account. Deleting the conversation doesn't delete it.");
    expect(section).toContain("deletes every message in it, said or typed");
    expect(html).toContain("The record of a live call with a companion (its times, minutes and turns; never sound or words): 90 days.");
    // The processors list names the renderer's host too.
    expect(html).toContain("our own renderer draws it on GPUs rented from Runpod");
    expect(html).toMatch(/Earlier the same day: what happens on a call with a companion now has a section of its own/);
  });

  it("says one message can be deleted on its own, what that removes and what it leaves (lib/companion-message-delete.ts)", () => {
    expect(section).toContain("“Delete messages”, in the same menu, deletes one message at a time, yours or the companion's, said or typed: its words are gone for good, with its voice note and any earlier version of a reply you had written again.");
    expect(section).toContain("A fact the companion already noted from it stays on its memory page until you change or delete it there, and the companion's running notes on the conversation are written again without it.");
    expect(section).toContain("The “AI character” notices and a scene's opening line go only with the conversation.");
    expect(section).toContain("we keep a blank marker of what it was about (which date or scene, and when), with none of its words, so the same text isn't sent again.");
    expect(section).not.toContain("no way yet");
    // How long, and the rights: a message is one of the things a person can delete.
    expect(html).toContain("A companion conversation and what the companion remembers: until you delete a message, the conversation, the memory (a fact at a time, or all of it), or your account.");
    expect(html).toContain("The blank marker a deleted text leaves (what it was about and when, never its words) goes with the conversation.");
    expect(html).toContain("a companion conversation or one message in it from the conversation's menu, or ask us");
    expect(html).toMatch(/Before that \(15 November\): you can delete one message of a companion conversation on its own, and your account export now has your companion conversations, what each companion remembers about you, and the record of your live calls\./);
  });

  it("says the export has the conversations and the call records", () => {
    expect(section).toContain("Deleting the conversation doesn't delete it. It's in your account export.");
    expect(html).toContain("Your conversations, what each companion remembers and the record of your live calls are in your account export.");
    expect(html).toContain("get a copy of your data (your account page has an export, which includes your companion conversations, what each companion remembers about you and the record of your live calls) and take it elsewhere");
  });

  it("COMPANION_MESSAGE_DELETE=0: says what's true then, that only the whole conversation can be deleted", () => {
    vi.stubEnv("COMPANION_MESSAGE_DELETE", "0");
    const off = page();
    expect(calls(off)).toContain("You can rewrite your last message, but there's no way yet to delete one message on its own. Deleting your account deletes all of it.");
    expect(off).not.toContain("Delete messages");
    expect(off).not.toContain("one message in it");
    expect(off).not.toContain("blank marker");
    expect(off).toContain("A companion conversation and what the companion remembers: until you delete the conversation, the memory (a fact at a time, or all of it), or your account.");
    expect(off).toContain("a companion conversation from the conversation's menu, or ask us");
  });
});

describe("the FAQ's call answer", () => {
  it("is there while companions are open, says the same, and links to the section", () => {
    expect(faqs({}).map((f) => f.id)).not.toContain("calls");
    const f = faqs({ COMPANION_OPEN: "1" }).find((x) => x.id === "calls")!;
    expect(f.q).toBe("What happens to my voice on a call with a companion?");
    expect(answerText(f.a)).toContain("We never receive or keep your audio.");
    expect(answerText(f.a)).toContain("the same as ones you typed: you can delete one message at a time, or the whole conversation, from the conversation's Settings.");
    expect(f.a).toContainEqual({ text: "What a call keeps", href: "/privacy#calls" });
    // Switched off, it says what's left.
    const off = faqs({ COMPANION_OPEN: "1", COMPANION_MESSAGE_DELETE: "0" });
    expect(answerText(off.find((x) => x.id === "calls")!.a)).toContain("the same as ones you typed, and deleting the conversation deletes them.");
    expect(answerText(off.find((x) => x.id === "calls")!.a)).not.toContain("one message");
  });

  it("the delete answer says where a conversation or one message is deleted, and that the export has them", () => {
    const answer = (env: Record<string, string>) => answerText(faqs(env).find((x) => x.id === "delete")!.a);
    expect(answer({ COMPANION_OPEN: "1" })).toContain("A conversation with a companion, or one message in it, is deleted from that conversation's Settings.");
    expect(answer({ COMPANION_OPEN: "1" })).toContain("Your account page also has an export of your data, your companion conversations and call records included.");
    expect(answer({ COMPANION_OPEN: "1", COMPANION_MESSAGE_DELETE: "0" })).toContain("A conversation with a companion is deleted from that conversation's Settings.");
    // Before companions open, nothing about them.
    expect(answer({})).not.toContain("companion");
    expect(answer({})).toContain("Your account page also has an export of your data. The privacy notice says");
  });
});

describe("what the copy says is kept, in the code", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("a call's words are messages that go one at a time or with the conversation; its record stays 90 days", async () => {
    const now = new Date("2026-11-15T12:00:00Z");
    const ago = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
    await t.db.query(`insert into companion_threads (id, user_id, character_id) values ('th-1', 'u-1', $1)`, [HOUSE_CHARACTERS[0].id]);
    await t.db.query(
      `insert into companion_messages (id, thread_id, role, text, on_call) values ('m-1', 'th-1', 'user', 'said on a call', true), ('m-2', 'th-1', 'character', 'said back', true)`,
    );
    for (const [id, days] of [["c-new", 1], ["c-89", 89], ["c-91", 91]] as const) {
      await t.db.query(`insert into companion_live_calls (id, user_id, thread_id, started_at, last_at, ended_at, minutes, turns) values ($1, 'u-1', 'th-1', $2, $2, $2, 1, 1)`, [id, ago(days)]);
    }
    // The record holds no words and no sound: only these columns exist.
    const cols = (await t.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'companion_live_calls' order by column_name`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(["ended_at", "face_provider", "face_seconds", "first_ticket", "id", "last_at", "minutes", "started_at", "thread_id", "tts_chars", "turns", "user_id"]);

    // "Delete messages… deletes one message at a time, said or typed": a call's line goes on its own, for its person only.
    expect(await deleteMessage(t.db, "someone-else", "th-1", "m-1")).toMatchObject({ ok: false, status: 404 });
    expect(await deleteMessage(t.db, "u-1", "th-1", "m-1")).toMatchObject({ ok: true });
    expect((await t.db.query<{ id: string }>(`select id from companion_messages where thread_id = 'th-1'`)).rows.map((r) => r.id)).toEqual(["m-2"]);
    expect((await t.db.query(`select 1 from companion_live_calls where thread_id = 'th-1'`)).rows).toHaveLength(3);

    expect(await deleteThread(t.db, "u-1", "th-1")).toEqual({ ok: true });
    expect((await t.db.query(`select 1 from companion_messages where thread_id = 'th-1'`)).rows).toHaveLength(0);
    // "Deleting the conversation doesn't delete it."
    expect((await t.db.query(`select 1 from companion_live_calls where thread_id = 'th-1'`)).rows).toHaveLength(3);
    // "It's deleted after 90 days."
    await pruneLiveCalls(t.db, now);
    expect((await t.db.query<{ id: string }>(`select id from companion_live_calls order by id`)).rows.map((r) => r.id)).toEqual(["c-89", "c-new"]);
  });
});
