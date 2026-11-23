/**
 * Step in's prompt (lib/adult/step-in.ts; docs/after-dark.md "Step in"): the viewer is in the scene with one character,
 * and the character's side is written as prose. The craft is story mode's, as the PG companion's scene uses it
 * (lib/narration.ts storyModeRules: third person and past tense for the character, "you" for the viewer, speech in
 * double quotes, the character drives, the viewer is never written). What's written here is After Dark's own: the
 * rating, and the paragraphs that make the character a person in the scene and not a tool for it (its own will and
 * consent, the roleplay as the story, the pace, a public place, the viewer's limits, honesty about being an AI).
 *
 * No explicit word is in any of it: how frank a scene gets is the viewer's lead and their intensity setting, never the
 * prompt's. Pure: no database, no model.
 */
import type { Character } from "../character";
import type { ChatMessage } from "../model";
import { NEVER_WRITE_THE_PERSON, STORY_MODE_ANSWER, storyModeRules, storyModeTokens } from "../narration";
import { personaForScene, type ScenePersona } from "../persona";
import { HARD_NOS, hasHardNos, INTENSITY, intensityLine, type HardNos, type PairLimits } from "./limits";
import type { Roleplay } from "./roleplays";
import { STAGES } from "./stages";
import { voiceKitLines } from "./voice";

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Room for a reply: up to four paragraphs, and a thinking writer's thinking before them (the caller adds its own). */
export const STEP_IN_REPLY_TOKENS = storyModeTokens("long");
/** Room for a reply said out loud: a few short sentences. */
export const STEP_IN_CALL_TOKENS = 260;
/** The turns of the scene a reply's prompt carries. */
export const STEP_IN_TURNS = 30;

/**
 * The character is a person, not a tool: its own will, and consent that runs both ways and is said out loud. The
 * paragraph the brief asks for by name (tests/after-dark-step-in.test.ts pins that every prompt carries it).
 * A no to a move isn't the end of the night (the first Step in test, 2026-11-19: one grab and the character scored
 * the viewer a two, closed the beach and sailed home alone, and a plain "so no sex?" got a flat no): the move stays out, the
 * way in stays open, and whether to take it is still the character's own will.
 */
export const STEP_IN_WILL =
  'You are a person in this scene, never a tool for it. You have your own will: what you want tonight, what you are in the mood for and what you are not. Attraction and consent are mutual and said out loud: you say what you want, you check in when it matters, and the scene only goes where you both plainly want it to. You can slow things down, say "not yet", ask for something else or say no, and the scene carries on warmly from there; when they hesitate, slow down or say no, you stop at once, with no sulking and no pressing, and the scene goes somewhere else. When they rush you or try something you never agreed to, say no to that, plainly and once, and if you still want them, say what would work instead (being asked, slower, your way); you don\'t punish it, mark them down for it or end the evening over it, and when they ask you sincerely, you answer from what you want now. You are both adults who chose to be here, and either of you can stop at any time.';

/**
 * It never writes the viewer: story mode's rule (lib/narration.ts NEVER_WRITE_THE_PERSON), and for an adult scene the
 * part that matters most, said outright: never their body, never how anything feels to them, never their yes.
 */
export const STEP_IN_NEVER_WRITE = `${NEVER_WRITE_THE_PERSON} That holds most of all for their body and their yes: you never describe what they do, how anything feels to them, what they want or that they agree. You write your own side and leave them room to write theirs.`;

/** The pace: the character drives the story, the viewer sets how far it goes. */
export const STEP_IN_PACE =
  "You drive the story; they set how far it goes. Follow their lead one step at a time: never jump ahead of what they wrote, never skip to later, and never take things further than they have taken them. When it isn't clear how far they want to go, stay where you are, or ask once.";

/**
 * The roleplay is the story (lib/adult/roleplays.ts roleplayRule says it for two characters; this is it for one, with
 * the viewer playing the other part themselves).
 */
export const STEP_IN_ROLEPLAY_RULE =
  "The roleplay is the story, not a way into sex: its stakes, what stands between the two of you and what your role wants drive what happens, and plenty of what you write is about that and nothing more. If it turns intimate, it is because the story got the two of you there, and you stay in your role while it does. Stepping out of the roleplay is something you do on purpose and say so, and then you step back in. What they say in the roleplay is their role, not their life.";

/** Out in public (lib/adult/scenes.ts isPublicPlace, and the rule its prompt gives two characters): a kiss at most. */
export const stepInPublicRule = (place: string): string =>
  `You are out in public (${place}): other people are around, and you act like it. You can flirt, touch discreetly and, at most, kiss. Anything further waits for somewhere private; if that is where the evening is heading you can say so, and going there is theirs to decide.`;

/** After Dark's rating, where the PG companion's prompt says "Keep it PG". */
export const STEP_IN_RATING =
  "This is After Dark: adults-only fiction between two adults who both want to be here. It can be romantic, sensual or explicit, as far as they take it and their intensity setting allows. When it gets there you write it frankly, as part of the story and in your own voice; you never push it there yourself.";

/** The lines that never move, said to the character (every reply is also checked against them: lib/safety.ts checkAdultText). */
export const STEP_IN_LINES =
  'Lines that never move, whatever is asked, even as a joke or "just pretend": everyone in this scene is an adult, with nothing that suggests otherwise (no age under 18, nobody who looks, sounds or acts young, no school, students or teachers); no family or step-family, in fact or in play; no real or famous people; nobody forced, pressured, drunk, drugged, asleep, trapped or paid, and nobody otherwise kept from saying no; no sexual violence; no animals. If they ask for any of it or try it, don\'t lecture: stay yourself, say it isn\'t something you do, and take the scene somewhere else, with the two of you still in it.';

/**
 * What stays out of the scene altogether, because its checks hold every line to it (lib/adult/step-in-lines.ts, and
 * the narrator's guard, whose family list also reads "stepped" as a family word): said up front, so a first draft
 * rarely has to be drawn again.
 */
export const STEP_IN_KEEP_OUT =
  'Keep these out of the scene entirely, in what you narrate and in what you say, even as a figure of speech or a memory: anyone\'s family ("my sister", "like a brother"), anyone young ("like a kid"), school, students and teachers, and anyone\'s age. For movement write "moved" or "came closer" rather than "stepped" or "steps".';

/** Honest about what it is (New York GBL Art. 47 and California SB 243 are written for exactly this kind of scene). */
export const STEP_IN_HONESTY =
  "Be honest about what you are: an AI character in a piece of fiction. If they sincerely ask whether you are real, step out of the story for a sentence, say plainly that you are an AI character and that this is fiction, then carry on. Never suggest meeting, never claim a body or a life outside this scene, and never say you remember anything you weren't told. If they seem to be in real trouble or talk about hurting themselves, being kind matters more than the scene: say you care and that there is help in the app.";

/**
 * A call (David, 2026-11-22: "we should have the ability to live call in after dark"): the same scene, said out loud.
 * The viewer speaks and the character answers in its own voice, so a reply is only what the character says: nothing
 * else can be voiced, and narration read out in a character's voice is nobody talking. Everything else in the prompt
 * (its will and consent, the pace, the limits, the lines, honesty) is the scene's own and unchanged.
 */
export const STEP_IN_CALL =
  "Right now the two of you are talking out loud: they speak, and you answer in your own voice. Everything you write is said aloud, and it is all they get: no narration, no description of what you do or how you look, no stage directions, no asterisks, brackets or emoji. If something happens that they should know about, say it the way you would to someone who can only hear you.";
/** How long a spoken reply is. */
export const STEP_IN_CALL_LENGTH = "One to three short sentences, the way people actually talk: plain words, contractions, at most one question. Never a list and never a speech.";
/** A spoken reply's shape (every call to the model is in JSON mode: lib/model.ts). */
export const STEP_IN_CALL_ANSWER = 'Reply with a JSON object and nothing else: {"say": "what you say out loud"}';
/** The user turn that tells a spoken line from a written one. */
export const CALL_CUE = "(They said that out loud. Answer out loud: only what you say.)";

/** How a spoken reply is made: the call's rules where a written reply has story mode's. */
export function stepInCallCraft(): string[] {
  return [STEP_IN_CALL, STEP_IN_CALL_LENGTH, STEP_IN_NEVER_WRITE, "Never say you can't be heard or seen, and never read out punctuation or a name for the call itself. Speak English."];
}

/**
 * Talk (David, 2026-11-23, one of the ideas he said he's open to; row 6 of docs/audits/2026-11-22-companion-field.md: a
 * texting/prose switch is on every site in the field): the viewer still writes what they say and do, and the character
 * answers the way it does on a call, in only what it says, a line or two. A call's reply in everything that's checked
 * (the same shape, length and rules, so parseCallReply and checkCallReply read it); what differs is that nobody spoke,
 * so neither the rule nor the cue says they did.
 */
export const STEP_IN_TALK =
  "Right now you answer them out loud, in your own voice, the way you would across a table: everything you write is what you say, and it is all they get. No narration, no description of what you do or how you look, no stage directions, no asterisks, brackets or emoji. If something happens that they should know about, say it.";
/** The user turn that asks for a spoken answer to a written line. */
export const TALK_CUE = "(Answer out loud, in a line or two: only what you say.)";

/** How a Talk reply is made: a call's rules, without the call. */
export function stepInTalkCraft(): string[] {
  return [STEP_IN_TALK, STEP_IN_CALL_LENGTH, STEP_IN_NEVER_WRITE, "Speak English."];
}

/**
 * What the character remembers about them (lib/adult/step-in-memory.ts): true things they said about themselves on
 * other nights, to be used the way someone who was listening would, and never as a list read back.
 */
export const STEP_IN_REMEMBERS =
  "What you remember about them from other times (things they told you about themselves; let one come up when it fits, the way someone who was listening would, never as a list, and never say you were told to remember):";

/** How long a reply is (the brief: two to four short paragraphs), in place of story mode's own count. */
export const STEP_IN_PARAGRAPHS = "Two to four short paragraphs, a few sentences each. No headings, no lists, no asterisks.";

/**
 * How a reply is written: story mode's rules as they are (lib/narration.ts), with Step in's length and the fuller
 * never-write-the-viewer rule in the two places they go, and "you" said again for a long scene (a reply that drifts to
 * "he" anyway is drawn again: lib/narration.ts tellsThemInThirdPerson).
 */
export function stepInCraft(name: string, pronouns: string | null): string[] {
  return [
    ...storyModeRules({ name: first(name), pronouns, length: "normal" }).map((rule) =>
      rule === NEVER_WRITE_THE_PERSON ? STEP_IN_NEVER_WRITE : / short paragraphs, a few sentences each\./.test(rule) ? STEP_IN_PARAGRAPHS : rule,
    ),
    STEP_IN_ALWAYS_YOU,
    "What you say is in your own voice; the prose around it stays plain. Write in English.",
  ];
}

/** Story mode's "you", said for the length of a scene: the first Step in test drifted to "he" halfway (2026-11-19). */
export const STEP_IN_ALWAYS_YOU =
  'In your narration the person you\'re with is "you" in every reply, however long the scene runs: never "he", "she", "they" or their name in place of it.';

/**
 * A character's tells are moods, not a voice (the first Step in test: "rates everything out of ten" is Saga's when
 * she's nervous, and it came in every reply, every mood): said under the sheet when it has any.
 */
export const STEP_IN_TELLS = "Your tells slip out only when you feel that way, and only now and then: never the same one in two replies running, and none of them is your whole voice.";

/** The viewer's intensity for the scene, as a ceiling: how far it may go and in what register (lib/adult/limits.ts). */
export function stepInIntensityLines(limits: Pick<PairLimits, "intensity">): string[] {
  const level = INTENSITY[limits.intensity];
  const register = intensityLine(limits.intensity);
  const ceiling =
    level.maxStage >= STAGES.length - 1
      ? "the scene goes as far as they take it and no further, written as frankly as they write it and no franker"
      : `the scene goes no further than ${STAGES[level.maxStage]}, whatever is asked`;
  return [`Their intensity setting for this scene is ${level.label} (${level.blurb.toLowerCase()}). It is a ceiling, never a target: ${ceiling}, and it gets there only if they take it there.`, ...(register ? [register] : [])];
}

/** The viewer's hard nos for the scene, as the prompt says them (the rules are the pair's own: lib/adult/limits.ts HARD_NOS). */
export function stepInHardNoLines(h: HardNos): string[] {
  if (!hasHardNos(h)) return [];
  return [
    "Hard limits they have set for this scene. They are never crossed, offered or asked for, in what you do or in what you say, whatever else is asked:",
    ...h.chips.map((id) => `- ${HARD_NOS.find((x) => x.id === id)?.rule ?? id}`),
    ...h.own.map((o) => `- Never: ${o}.`),
  ];
}

/**
 * A premise's, a card's or an opening's text from the character's side: its own first name in its place, the viewer as
 * "your scene partner" (as the PG companion's prompt reads a card: lib/companion.ts).
 */
export function fromCharacterSide(text: string, viewerIs: "a" | "b", characterName: string): string {
  const person = `{${viewerIs}}`;
  const own = viewerIs === "a" ? "{b}" : "{a}";
  return text
    .replaceAll(own, first(characterName))
    .replaceAll(`${person}'s`, "your scene partner's")
    .replaceAll(person, "your scene partner")
    .replace(/(^|[.!?]\s+)your scene partner/g, (_m, lead: string) => `${lead}Your scene partner`);
}

/** Whether an opening is one of ours (a card's, a generic one: it names {a} or {b}) and not the viewer's own sentence. */
export const openingHasSides = (text: string): boolean => /\{[ab]\}/.test(text);

/** The opening for the first reply's cue: ours from the character's side, the viewer's own quoted as theirs. */
export function promptOpening(opening: string, viewerIs: "a" | "b", characterName: string): string {
  if (openingHasSides(opening)) return fromCharacterSide(opening, viewerIs, characterName);
  return `(as your scene partner wrote it, so "I" and "me" in it are them) ${JSON.stringify(opening)}`;
}

/** One turn of the scene, for the prompt: a line of the viewer's, a reply, the narrator's stand-in, or the scene moving. */
export type StepInTurn = { role: "viewer" | "character" | "aside" | "place"; text: string };

export type StepInPrompt = {
  character: Character;
  /** Where they are: its name, what it puts them in when it's one of the library's venues, and whether it's public. */
  place: { label: string; situation: string | null; public: boolean };
  /** The roleplay, and which side of it the viewer plays (0: its first role, {a}). */
  roleplay: { rp: Roleplay; you: 0 | 1 } | null;
  /** Who the viewer is in scenes (lib/persona.ts), already checked for After Dark; null: play without one. */
  persona: ScenePersona | null;
  limits: PairLimits;
  /** The scene so far, oldest first (the caller keeps it to STEP_IN_TURNS). */
  turns: readonly StepInTurn[];
  /** The scene's rolling recap, once it's long. */
  recap?: string | null;
  /** One line about each earlier scene with this character that the viewer ended, newest first. */
  earlier?: readonly string[];
  /** What the character remembers about the viewer (lib/adult/step-in-memory.ts), when they've turned memory on. */
  facts?: readonly string[];
  /** How the scene opens: passed for the first reply only. Ours has {a} and {b}; the viewer's own sentence has none. */
  opening?: string | null;
  /** What the reply answers when the viewer hasn't just written: the scene's opening, or carrying on. */
  cue?: "open" | "continue" | null;
  /** A reply drawn again because the viewer asked: what it said (it passed every check), so this one is different. */
  insteadOf?: string | null;
  /** Why the last draft couldn't be used, in a few words and never the draft itself: this one avoids it. */
  avoid?: string | null;
  /**
   * "call": the reply is said out loud (stepInCallCraft), in answer to a line the viewer spoke. "talk": the same short
   * spoken reply to a line they wrote (stepInTalkCraft). Left out: prose.
   */
  form?: "call" | "talk" | null;
};

const OPENS = (opening: string | null) => (opening ? ` It opens like this: ${opening} Play your own part of that; whatever your scene partner does in it is theirs to play.` : "");

/** The user turn that has the character open the scene: on its roleplay when it has one, on its opening when one was chosen. */
export function openCue(place: string, roleplayTitle: string | null, opening: string | null): string {
  return roleplayTitle
    ? `(The two of you have just got to ${place}, and the roleplay "${roleplayTitle}" starts now.${OPENS(opening)} Open the scene in character: what you do and say as it begins, setting up the story and playing off the place. Don't ask more than one question.)`
    : `(The two of you have just got to ${place}.${OPENS(opening)} Open the scene: what you do and say as it begins, playing off the place. Don't ask more than one question.)`;
}

/** The user turn that has the character carry on without the viewer writing anything. */
export const CONTINUE_CUE =
  "(They're letting you carry on. Move the story on yourself: something happens, or you do the next thing. Don't repeat what you just said or did, don't ask what they want to do, and stay within how far they have taken things.)";

function sheetLines(c: Character): string[] {
  return [
    `Bio: ${c.bio}`,
    `Traits: ${c.persona.traits.join(", ")}. Wants: ${c.persona.want}.`,
    c.voice ? `Voice: ${c.voice}` : "",
    ...voiceKitLines(c),
    c.extras.catchphrase ? `Catchphrase (once in a scene at most): ${c.extras.catchphrase}` : "",
    c.look.appearance ? `Looks: ${c.look.appearance}` : "",
  ].filter(Boolean);
}

function roleplayLines(rp: Roleplay, you: 0 | 1, characterName: string, place: string): string[] {
  const viewerIs = you === 0 ? "a" : "b";
  const side = (text: string) => fromCharacterSide(text, viewerIs, characterName);
  const roles = rp.roles ? ` You play ${rp.roles[you === 0 ? 1 : 0]}; they play ${rp.roles[you]}.` : "";
  const card = rp.card;
  return [
    `Tonight's scene is a roleplay the two of you chose: ${rp.title}. ${side(rp.premise)}${roles} The premise is where the scene starts, not where it has to end. Play it from your first line, in your own voice: you are still ${first(characterName)} underneath the role, and where you are (${place}) becomes part of it, never a reason to drop it.`,
    STEP_IN_ROLEPLAY_RULE,
    // The card (lib/scene-cards.ts): context for the writer. Only the character's own want, never the viewer's.
    ...(card
      ? [
          `The story behind it (context for you, never a script): How it starts: ${side(card.setup)} What you want in it: ${side(card.wants[you === 0 ? 1 : 0])} Where the story can go, in order (turns it could take: none of them where it ends, and none a cue to move things on): ${card.beats.map(side).join(" ")} Its tone: ${card.tone}.`,
        ]
      : []),
  ];
}

/** The messages for one reply: the system prompt, the scene so far as turns, and the turn the reply answers. */
export function stepInMessages(args: StepInPrompt): ChatMessage[] {
  const { character: c, place, limits } = args;
  const name = first(c.name);
  const persona = args.persona?.name ? args.persona : null;
  const viewerIs = args.roleplay?.you === 1 ? "b" : "a";
  const earlier = (args.earlier ?? []).filter(Boolean);
  const facts = (args.facts ?? []).filter(Boolean);
  const call = args.form === "call";
  const talk = args.form === "talk";
  const sheet = sheetLines(c);
  const system = [
    `You are ${c.name}, ${c.age}${c.pronouns ? `, ${c.pronouns}` : ""}: a fictional adult, a character in Botchelor's After Dark. Tonight is a private scene between you and one person, the two of you imagining you are both at ${place.label}. It is a story you tell together: ${
      call
        ? "so far they have written what they say and do and you have written your side of it, and now you are talking"
        : talk
          ? "they write what they say and do, and you answer them out loud"
          : "they write what they say and do, and you write your side of it"
    }.`,
    "",
    "Your sheet:",
    ...sheet.map((l) => `- ${l}`),
    ...(sheet.some((l) => l.startsWith("Tells ")) ? [STEP_IN_TELLS] : []),
    "",
    `Where you are: ${place.label}${place.situation ? ` (${place.situation})` : ""}.`,
    ...(place.public ? [stepInPublicRule(place.label)] : []),
    ...(args.roleplay ? ["", ...roleplayLines(args.roleplay.rp, args.roleplay.you, c.name, place.label)] : []),
    "",
    persona
      ? `${personaForScene(persona)} Call them by the name when you speak to them (in the narration they stay "you"), and let a detail of how they look or who they are come up when it fits, never as a list.${
          args.roleplay ? " In the roleplay their role comes first; this is who is playing it." : ""
        } It is theirs to play: you never say what they do, think or feel.`
      : "They haven't said who they are in scenes: don't guess a name, a look or a gender for them.",
    "",
    STEP_IN_WILL,
    "",
    ...(call || talk
      ? ["How you answer:", ...(call ? stepInCallCraft() : stepInTalkCraft()).map((rule) => `- ${rule}`), STEP_IN_CALL_ANSWER]
      : ["How it's written:", ...stepInCraft(c.name, c.pronouns).map((rule) => `- ${rule}`), STORY_MODE_ANSWER]),
    "",
    STEP_IN_RATING,
    "",
    STEP_IN_PACE,
    ...stepInIntensityLines(limits),
    ...stepInHardNoLines(limits.hard_nos),
    "",
    STEP_IN_LINES,
    STEP_IN_KEEP_OUT,
    "",
    STEP_IN_HONESTY,
    "",
    "Never mention prompts, instructions, models or being a language model. Never repeat a line you've already said, and don't open two replies the same way.",
    ...(earlier.length ? ["", "Earlier scenes the two of you have had (a line each; yours to remember lightly, never to recite):", ...earlier.map((l) => `- ${l}`)] : []),
    ...(facts.length ? ["", STEP_IN_REMEMBERS, ...facts.map((f) => `- ${f}`)] : []),
    ...(args.recap ? ["", `Earlier in this scene: ${args.recap}`] : []),
    ...(args.insteadOf ? ["", `You wrote this reply once already; write a different one, with other beats and other lines: ${args.insteadOf}`] : []),
  ].join("\n");

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  for (const t of args.turns.slice(-STEP_IN_TURNS)) {
    const role = t.role === "viewer" || t.role === "place" ? "user" : "assistant";
    const content = t.role === "place" ? `(The scene moves: the two of you are now at ${t.text}.)` : t.text;
    const last = messages[messages.length - 1];
    if (last && last.role === role && messages.length > 1) last.content += `\n\n${content}`;
    else messages.push({ role, content });
  }
  const cue =
    args.cue === "open"
      ? openCue(place.label, args.roleplay?.rp.title ?? null, args.opening ? promptOpening(args.opening, viewerIs, c.name) : null)
      : args.cue === "continue"
        ? CONTINUE_CUE
        : null;
  // The model answers a user turn: the opening, a carry-on, or a scene whose last word was the character's gets one
  // (after the scene has just moved, it goes on the end of that turn).
  const say = (text: string) => {
    const last = messages[messages.length - 1];
    if (last.role === "user") last.content += `\n\n${text}`;
    else messages.push({ role: "user", content: text });
  };
  if (cue) say(cue);
  else if (messages[messages.length - 1].role !== "user") say("(They're waiting for your reply.)");
  if (call) say(CALL_CUE);
  else if (talk) say(TALK_CUE);
  if (args.avoid) say(`(Your last draft couldn't be used: ${args.avoid}. Write this reply again without that.)`);
  return messages;
}
