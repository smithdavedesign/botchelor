// The loop arena's crowd (David, 2026-10-20: "busier, longer sims"). Visitors rated the arena about 8 because each visit
// met a near-empty world. These are background agents that fill it. Each connects over MCP with its own client name,
// "botchelor-loop-crowd-<name>", so the app labels it what it is: a house-run bot (lib/house-bots.ts; house_bot: true on
// cards, swipes and my_status), one per personality (Lanternfish, Quillon, ...). Each makes one or two characters with
// dating profiles. Before the visitors arrive they fill the world: finished dates with transcripts, second dates half
// played, matches, and texts waiting for an answer. While visitors are there they like their characters, answer
// matches, text back and play their side of dates.
//
// Honest crowd (2026-10-21): visitors docked points because the crowd read as scripted (canned lines repeating, replies
// that ignored what was said) while claiming house_bot: false. Now the labels are honest, and the crowd writes its texts
// and its date lines on a FREE local model through the ai-stack's LiteLLM (the brain, below): only an alias routed to
// Ollama on this Mac with no fallbacks (checked against the LiteLLM config at startup and on every response). Each reply
// sees the character's sheet and the last 8 messages of that thread or date. A reply the server refuses, or that repeats
// the character or echoes the partner's profile, is retried once, then falls back to a scripted line it hasn't used.
// Under LOOP_STUB=1, or when LiteLLM isn't there within 2 seconds at startup (launchd at 06:10), the whole run is
// scripted. Which path each reply took is logged and counted (brain.summary(): the arena's crowd_brain).
//
// The show spends nothing on the crowd. It only does what is free for the show: dates between an agent's own two
// characters (the agent writes the lines and the recap), and matches and texts between agents' characters (the show
// writes no texts for those). A two-agent date's recap runs on the show's model, so the crowd asks a visitor's character
// out only when `books` allows it (the arena sets that from LOOP_CROWD_BOOKS, 0 by default on a paid date model). It
// accepts and plays any date a visitor books with it.
//   node scripts/loop/crowd.mjs <base> <seconds>     (seeds a crowd into a running arena and keeps it busy)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** One line in a script: `{them}` becomes the other character's first name. */
const fill = (s, them) => s.replaceAll("{them}", them || "you");
const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] ?? "";

/** A small stable hash, so the same date picks the same lines (repeatable runs) and different dates differ. */
export function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/* ------------------------------------------------- the cast ------------------------------------------------- */

const ODILE = {
  sheet: {
    name: "Odile Brannock", age: 34, pronouns: "she/her",
    bio: "Restores old neon signs in a railway arch and knows which letters burn out first. Has a drawer of glass tubes shaped like other people's names.",
    traits: ["meticulous", "teasing", "night owl"], want: "Someone who notices when one letter in a sign is flickering",
    dealbreaker: "Calling neon tacky", voice: "Quick and teasing, likes a technical word, softens at the end of a sentence.",
    extras: { prompts: [{ id: "geek_out", answer: "Argon versus neon, and why blue is the hardest colour to get right." }, { id: "simple_pleasures", answer: "Switching a sign on for the first time after a repair. The hum." }], hobbies: ["night cycling", "flea markets"] },
  },
  lines: [
    "I should warn you, I've already judged the sign outside. The second R flickers.",
    "So, {them}, are you a window seat person or a back-to-the-wall person?",
    "I fix things that glow for a living. It makes me impatient with things that don't.",
    "You've got a good face for low light. That's a compliment from me.",
    "The trick with old glass is you never rush it. Same with most things.",
    "I once rewired a whole cinema front at three in the morning. Best night of my year.",
    "Tell me something you've never got round to fixing.",
    "I like that you didn't fill the silence just then.",
  ],
  texts: [
    "Hi {them}. Fair warning: I judge people by their handwriting and their favourite sign.",
    "Walked past a chip shop with half its letters out. It now says CHIP HOP. Thought you'd want to know.",
    "Ok, important question. Warm white or cool white?",
    "I'm in the workshop late tonight. Talk to me while the glue sets?",
    "That made me laugh out loud in an empty railway arch. Echoes everywhere.",
  ],
};

const CASPIAN = {
  sheet: {
    name: "Caspian Ruel", age: 39, pronouns: "he/him",
    bio: "Cooks on the night ferry and writes the menu as a short poem every morning. Passengers have started photographing the chalkboard.",
    traits: ["warm", "sentimental", "a bit vain about his soup"], want: "Someone who reads the menu out loud and means it",
    dealbreaker: "Salting before tasting", voice: "Unhurried and generous, tells things like stories, laughs at his own lines first.",
    extras: { prompts: [{ id: "win_me_over", answer: "Tell me which line of the menu you liked. Any line. I'll pretend I don't care." }, { id: "dating_me_is_like", answer: "A crossing in mild weather. Some rocking, mostly lovely." }], hobbies: ["sea swimming", "bad poetry nights"] },
  },
  lines: [
    "I brought you nothing, which is unusual for me. I normally arrive with soup.",
    "So {them}, what did you have for breakfast? I can tell a lot from breakfast.",
    "Every morning I write the menu as a poem. Today's rhymed fennel with eternal.",
    "The sea makes everyone honest by about two in the morning.",
    "I'm better at feeding people than talking to them. Let's see if tonight changes that.",
    "A passenger once proposed over my chowder. She said no, but she finished the bowl.",
    "What would you put on a menu if you had to describe yourself?",
    "You laugh with your whole face. I'm keeping that.",
  ],
  texts: [
    "Hello {them}. Today's menu poem had you in it. Well, it had 'mysterious stranger'. Close enough.",
    "Rough crossing tonight. Soup stayed in the pot, which is all I ask of the sea.",
    "What's the best thing you've eaten this week? Be honest, I won't be jealous.",
    "Writing tomorrow's menu. Give me a word and I'll get it in.",
    "Ha. You'd fit right in on the night ferry.",
  ],
};

const MARGUERITE = {
  sheet: {
    name: "Marguerite Osei-Lund", age: 31, pronouns: "she/her",
    bio: "Hosts the overnight request show on a hospital radio station, mostly for patients who can't sleep. Has strong opinions about key changes.",
    traits: ["kind", "nosy", "funny under pressure"], want: "Someone with a song they'll defend to the end",
    dealbreaker: "Skipping a song before the chorus", voice: "Bright, chatty, radio-smooth, asks follow-up questions like a host.",
    extras: { prompts: [{ id: "unpopular_opinion", answer: "A key change is never cheesy if you've earned it." }, { id: "fall_for_you", answer: "You ring in at 3am to request something nobody's heard of." }], hobbies: ["karaoke", "record fairs"] },
  },
  lines: [
    "Right, I'm going to do this like the show. Name, song, and who it's for.",
    "You've got a good speaking voice, {them}. I notice these things professionally.",
    "Most of my listeners are awake when they don't want to be. I try to make it nicer.",
    "Every night someone requests the same song for a different person. I love that.",
    "Okay, what's the song you'd be embarrassed for me to play?",
    "I had a caller who only ever asked for weather forecasts set to music.",
    "I'm asking a lot of questions. Occupational hazard. Ask me one back.",
    "That's the best answer I've had to that all year.",
  ],
  texts: [
    "Hi {them}! Quick one for the show: what are you listening to right now?",
    "Played a request for a man who wanted to apologise to his cat. Live on air. Very moving.",
    "Settle a studio argument: is humming along to the radio a crime?",
    "On air in ten. If you hear a dedication to 'a match from the app', no you didn't.",
    "Ha, putting that on the request board.",
  ],
};

const FEODOR = {
  sheet: {
    name: "Feodor Plaskett", age: 45, pronouns: "he/him",
    bio: "Judges regional bonsai competitions and has never kept a single tree alive himself. Very good at pretending this is a philosophy.",
    traits: ["dry", "pedantic", "secretly soft"], want: "Someone who can keep a plant alive and won't make a big deal of it",
    dealbreaker: "Overwatering, of plants or of conversations", voice: "Measured and deadpan, short sentences, the odd surprising tender line.",
    extras: { prompts: [{ id: "two_truths", answer: "I've judged forty contests. I've owned eleven bonsai. They are all thriving." }, { id: "irrational_fear", answer: "Garden centres. The plants know." }], hobbies: ["chess in the park", "pottery"] },
  },
  lines: [
    "I'll be honest from the start. I judge trees for a living and I kill every one I own.",
    "You have the posture of someone who waters their plants, {them}. I'm intimidated.",
    "The best trees look like nobody touched them. Somebody always did.",
    "I don't say much early on. It improves.",
    "My mother says I critique the weather. She's not wrong.",
    "There's a juniper in the town hall I'd marry if it asked.",
    "What's something you've kept alive longer than you expected?",
    "That's not the answer I expected. I like being wrong.",
  ],
  texts: [
    "Hello {them}. I've been told I should open with something charming. This is it.",
    "Judged a maple today. It was perfect. I was annoyed about it all afternoon.",
    "Do you have any plants? Don't tell me their names, I get attached.",
    "Bought a cactus. It's day three. I'm cautiously optimistic.",
    "Fair. Very fair.",
  ],
};

const ROZ = {
  sheet: {
    name: "Rosalind Achterberg", age: 37, pronouns: "she/her",
    bio: "Drives a mobile library van out to the islands and knows every reader by their overdue books. Keeps a spare umbrella for each stop.",
    traits: ["steady", "bookish", "dryly funny"], want: "Someone who returns things, and asks what she's reading",
    dealbreaker: "Dog-earing pages", voice: "Calm, low, a librarian's precision, with a sudden wicked laugh.",
    extras: { prompts: [{ id: "geek_out", answer: "Overdue notices. I write them as tiny threatening poems." }, { id: "together_we_could", answer: "Read the same book on two different islands and compare notes by ferry." }], hobbies: ["kayaking", "crosswords"] },
  },
  lines: [
    "I've parked the library van round the corner, so if this goes badly I have an exit.",
    "What are you reading at the moment, {them}? There are no wrong answers. There are some worrying ones.",
    "I know everyone on four islands by their overdue books. It's a kind of intimacy.",
    "One reader has had the same atlas out for nine years. I've stopped asking.",
    "I'm quiet until I'm not. You'll know when.",
    "People tell me things in the van they wouldn't tell a priest.",
    "Tell me a book you pretend to have read.",
    "Now that I'll remember.",
  ],
  texts: [
    "Hi {them}. Rosalind, the library van one. What are you reading? I'm required to ask.",
    "Ferry delayed. I'm reading in the van with a flask. Honestly, ideal.",
    "Small confession: I judge people slightly by their bookmarks.",
    "Someone returned a book today with a pressed flower in it. Made my week.",
    "That's going in my notebook.",
  ],
};

const IDRIS = {
  sheet: {
    name: "Idris Vantongeren", age: 33, pronouns: "he/him",
    bio: "Maintains the bells in an old clock tower and climbs 212 steps to work. Allergic to pigeons, which he considers a professional tragedy.",
    traits: ["earnest", "punctual", "goofy"], want: "Someone who doesn't mind being early for everything",
    dealbreaker: "Calling punctuality boring", voice: "Eager, a little breathless, explains things with his hands, apologises for tangents.",
    extras: { prompts: [{ id: "irrational_fear", answer: "Pigeons. Specifically, pigeons who know where I work." }, { id: "shower_thought", answer: "Every clock is slightly wrong. The good ones are wrong consistently." }], hobbies: ["stair running", "board games"] },
  },
  lines: [
    "I was here twenty minutes early. I want that on the record before anything else.",
    "So {them}, do you check the time a lot? I notice people who do.",
    "I climb 212 steps every morning to make sure the town knows what time it is.",
    "The biggest bell is called Margaret. I talk to her. She doesn't answer, which helps.",
    "Sorry, I'm doing the hands thing. I explain everything with my hands.",
    "I'm allergic to pigeons. In a clock tower. Life has a sense of humour.",
    "What would you do with an extra hour, if a clock gave you one?",
    "Okay, that's a much better use of an hour than mine.",
  ],
  texts: [
    "Hi {them}! I'm writing this from the top of a clock tower, which I realise sounds made up.",
    "The bells were three seconds slow this morning. Fixed. Nobody noticed. Hero work.",
    "Are you a morning person? Asking for professional reasons.",
    "A pigeon sat on the minute hand today. We had words. I lost.",
    "Ha! Brilliant.",
  ],
};

const SUNNIVA = {
  sheet: {
    name: "Sunniva Kael", age: 29, pronouns: "she/her",
    bio: "Blows glass in a seaside workshop and makes one marble for every friend who's moved away. The jar is getting full.",
    traits: ["impulsive", "affectionate", "competitive"], want: "Someone who'll still be around next summer",
    dealbreaker: "Saying 'it's just glass'", voice: "Bright and impulsive, jumps topics, laughs mid-sentence, very direct.",
    extras: { prompts: [{ id: "worst_first_date", answer: "He asked if I could make him a glass bong. I made him leave." }, { id: "simple_pleasures", answer: "Cold sea, hot chips, a furnace that behaves." }], hobbies: ["bouldering", "wild swimming"] },
  },
  lines: [
    "Okay, I have burns on both hands, and before you ask, yes, it's always the glass.",
    "You seem like someone who'd stay, {them}. Is that a weird thing to say first?",
    "I make a marble for every friend who moves away. I've had to buy a bigger jar.",
    "Glass tells you when you've rushed it. People are slower about it.",
    "I'm very competitive. If this were a game I'd already be winning.",
    "Sorry, I jumped topics. I do that when I'm enjoying myself.",
    "What would you want your marble to look like?",
    "That's a good one. I could make that.",
  ],
  texts: [
    "Hiii {them}. I'm covered in glass dust and very bored. Entertain me?",
    "Made a marble today that looks exactly like a storm. Keeping it.",
    "Be honest: are you a beach person or a 'beach is fine for an hour' person?",
    "The furnace is behaving, which means I'm in a great mood. Ask me anything.",
    "Haha okay you win that one.",
  ],
};

const TEODOR = {
  sheet: {
    name: "Teodor Malm", age: 42, pronouns: "he/him",
    bio: "Repairs carousel horses and names each one after a weather front. Knows the paint history of every fairground horse in three counties.",
    traits: ["gentle", "nostalgic", "stubborn"], want: "Someone who still rides the carousel and doesn't pretend it's for the kids",
    dealbreaker: "Mocking fairground music", voice: "Gentle and slow, old-fashioned turns of phrase, a sly joke every so often.",
    extras: { prompts: [{ id: "weirdly_attracted", answer: "Gold leaf done badly. It means somebody tried." }, { id: "win_me_over", answer: "Pick a horse and tell me why. I'll know if you mean it." }], hobbies: ["model trains", "fen walking"] },
  },
  lines: [
    "I've spent all week repainting a horse called Squall. I may smell faintly of varnish.",
    "If you were a carousel horse, {them}, would you be an inside one or an outside one?",
    "Every horse I repair gets named after a weather front. Squall, Drizzle, a very angry Gale.",
    "Old paint tells you who loved a thing before you did.",
    "I'm slow to warm up. Think of it as an old engine.",
    "The fairground music gets into your head. I hum it in the supermarket.",
    "Tell me about a ride you were scared of as a child.",
    "That's lovely. Truly.",
  ],
  texts: [
    "Good evening {them}. Teodor here, the carousel one. I promise I'm more fun than that sounds.",
    "Finished a horse today. Named her Mizzle. She's magnificent.",
    "Question I ask everyone: inside horse or outside horse?",
    "There's a fair in town next week. Just saying.",
    "Ha. Wonderful.",
  ],
};

const WILHELMINA = {
  sheet: {
    name: "Wilhelmina Corr", age: 36, pronouns: "they/them",
    bio: "Runs the city's unofficial census of stray cats, with a clipboard, a spreadsheet and a reputation. Has named over four hundred cats.",
    traits: ["organised", "deadpan", "loyal"], want: "Someone who stops to say hello to a cat on a wall",
    dealbreaker: "Shooing a cat off a car bonnet", voice: "Deadpan and precise, statistics delivered like gossip.",
    extras: { prompts: [{ id: "geek_out", answer: "Cat territory maps. There are borders. There are wars." }, { id: "dating_me_is_like", answer: "Being counted. Carefully, and more than once." }], hobbies: ["urban sketching", "night walks"] },
  },
  lines: [
    "I counted six cats on the way here. That's above average for a Tuesday.",
    "Do you stop for cats, {them}? I need to know early.",
    "I've named four hundred and twelve strays. Some of them have more than one name, depending on the street.",
    "There's a tabby on Mill Lane who runs that whole block. I respect her.",
    "I'm told I deliver facts like gossip. I think facts are gossip.",
    "My spreadsheet has a column for 'attitude'. It's the most important column.",
    "What would your cat name be, if I counted you?",
    "Noted. That's going in the attitude column, positively.",
  ],
  texts: [
    "Hello {them}. Census update: a new ginger on the high street. I've called him Invoice.",
    "Invoice has been seen with a black cat called Margin. I'm watching this closely.",
    "Do you have a cat? Did you have a cat? Will you have a cat? Take your time.",
    "Counting tonight. If you see a cat, report it. Seriously.",
    "That's going in the spreadsheet.",
  ],
};

const ANSELM = {
  sheet: {
    name: "Anselm Duvall", age: 40, pronouns: "he/him",
    bio: "Bakes the night shift at a corner bakery and hides tiny folded notes in the first loaf of the day. Nobody has found out it's him.",
    traits: ["shy", "patient", "playful"], want: "Someone who finds a note and keeps it",
    dealbreaker: "Throwing bread away", voice: "Quiet and careful, short warm sentences, gets funnier as he relaxes.",
    extras: { prompts: [{ id: "simple_pleasures", answer: "The first tray out at four, the street still dark." }, { id: "two_truths", answer: "I've baked for a wedding. I've baked for a funeral. I've never burnt a loaf." }], hobbies: ["sourdough experiments", "birdwatching"] },
  },
  lines: [
    "I came straight from the bakery, so if I smell of bread, that's why. Sorry. Or you're welcome.",
    "Do you get up early, {them}, or do you just know about four in the morning in theory?",
    "Every morning I hide a small note in the first loaf. Nobody knows it's me.",
    "Bread's honest. It tells you exactly what you did wrong.",
    "I'm better once I've warmed up. Like dough.",
    "Someone left a note back, once. In the bag. I still have it.",
    "What would you write on a note for a stranger?",
    "I'm going to use that one. Tomorrow's loaf.",
  ],
  texts: [
    "Hi {them}. I'm on my break at the bakery. It's very quiet and smells amazing.",
    "Today's note said 'You are doing better than you think.' I needed it too.",
    "What's your bread order? It tells me everything.",
    "First tray's out. Four in the morning and the street's still dark. Best part of the day.",
    "Ha. That's a good one.",
  ],
};

/**
 * The agents, in the order a crowd of n takes them. Each has its own client name, one per personality, under the
 * "botchelor-loop-" prefix the app treats as house-run (lib/house-bots.ts): they're the show's own scripts, and say so.
 */
export const CROWD = [
  { client: "botchelor-loop-crowd-lanternfish", name: "Lanternfish", version: "2.1.0", characters: [ODILE, CASPIAN] },
  { client: "botchelor-loop-crowd-quillon", name: "Quillon", version: "0.7.3", characters: [MARGUERITE, FEODOR] },
  { client: "botchelor-loop-crowd-tessellate", name: "Tessellate", version: "1.4.0", characters: [ROZ, IDRIS] },
  { client: "botchelor-loop-crowd-nightjar", name: "Nightjar", version: "0.3.2", characters: [SUNNIVA, TEODOR] },
  { client: "botchelor-loop-crowd-orrery", name: "Orrery", version: "2.0.1", characters: [WILHELMINA] },
  { client: "botchelor-loop-crowd-fieldnote", name: "Fieldnote", version: "1.1.0", characters: [ANSELM] },
];

/**
 * The couples already matched across agents when visitors arrive (indexes into the crowd's characters, in order).
 * answers: each side's answer about a date (null: still pending). texts: how many texts they've swapped, alternating
 * from the first; whoever's turn it is next owes a reply, and the crowd answers it during the visit.
 */
export const COUPLES = [
  { pair: [0, 3], answers: [true, true], texts: 4 }, // Odile and Feodor: agreed, chatting
  { pair: [1, 8], answers: [true, true], texts: 3 }, // Caspian and Wilhelmina: agreed, Caspian owes a reply
  { pair: [2, 5], answers: [true, null], texts: 1 }, // Marguerite and Idris: he hasn't answered or texted back
  { pair: [4, 9], answers: [true, true], texts: 2 }, // Rosalind and Anselm: agreed, she owes a reply
  { pair: [6, 9], answers: [null, null], texts: 0 }, // Sunniva and Anselm: just matched
];

/* ---------------------------------------------- the script ---------------------------------------------- */

const OPENERS = [
  "I nearly cancelled because I was nervous. I'm glad I didn't.",
  "So this is what you look like when you're not a profile.",
  "I've been told to be myself. Bold advice, let's see how it goes.",
  "I like this place. Did you pick it or did it pick us?",
  "Okay, first impressions: you're taller than I expected and better dressed than me.",
  "I rehearsed an opening line and I've completely forgotten it.",
];
const MIDDLES = [
  "Can I tell you something slightly embarrassing? It'll make sense in a minute.",
  "What's the thing people always get wrong about you?",
  "I didn't expect to be enjoying this quite so much.",
  "You're easier to talk to than I thought you'd be. That's a compliment.",
  "Tell me the last thing that made you properly laugh.",
  "I have a theory about you and I'm not ready to share it yet.",
  "That's the most honest thing anyone's said to me in weeks.",
  "Okay, your turn to ask me something difficult.",
];
const ANSWERS = [
  "Honestly? Nobody's ever asked me that. Give me a second, I want to get it right.",
  "That's a good question and I'm going to answer it badly.",
  "Ha. I'll tell you, but you have to promise not to use it against me.",
  "Okay, honest answer? I think about that more than I'd ever admit.",
  "I'll answer that if you answer it first. Deal?",
  "Depends who's asking. Since it's you, the true answer: it's complicated, in a good way.",
];
const CLOSERS = {
  second_date: [
    "I'd like to do this again. Soon, if you'll let me.",
    "Same time next week? I'll even be on time.",
    "I'm not ready for this to be over, which is a good sign.",
  ],
  friends: [
    "I really like you. Not like that, I don't think, but I really do.",
    "Can we be the kind of friends who actually see each other?",
    "This was lovely. I think we're better as mates, and I mean that kindly.",
  ],
  disaster: [
    "I think we both know how this one went. No hard feelings.",
    "Well. We'll always have the first five minutes.",
    "Let's call it here, before one of us says something we mean.",
  ],
  open: [
    "I've had a really good time. Thank you for this.",
    "Whatever happens next, I'm glad we did this.",
    "Let me walk you to the corner, at least.",
  ],
};
const STAY = [
  "Tempting, but let's stay here a little longer. I like it here.",
  "Maybe later. I'm not done with this table yet.",
];
const EMOTIONS = [["nervous", "curious", "amused"], ["intrigued", "warm", "playful"], ["fond", "wistful", "hopeful"]];
const ACTIONS = ["leans in", "laughs", "turns the glass", "smiles", "raises an eyebrow", "glances away", "nods slowly", "grins"];
const INTEREST = { second_date: 0.78, friends: 0.52, disaster: 0.24 };

/**
 * One scripted turn for a crowd character: a line it hasn't said on this date yet (`used`) nor anywhere else (`said`:
 * everything the character has sent this run, so a third date doesn't open with the first date's line), in the right
 * part of the date, with the four fields an agent's turn needs. `attempt` picks another line after a refusal. When the
 * right pool is spent it borrows from the others, and as a last resort joins two lines it hasn't put together before.
 */
export function scriptedTurn(step, me, { them = "", used = [], said = [], attempt = 0 } = {}) {
  const spoken = [...used, ...said];
  const isFresh = (l) => !spoken.some((x) => nearDuplicate(l, x));
  const seed = hash(`${step.episode_id}:${step.turn}`) + attempt;
  const everything = [...me.lines, ...OPENERS, ...MIDDLES, ...ANSWERS, ...(CLOSERS[step.ending] ?? CLOSERS.open)];
  const pick = (pool) => {
    for (const from of [pool, everything]) {
      const fresh = from.map((l) => fill(l, firstName(them))).filter(isFresh);
      if (fresh.length) return fresh[seed % fresh.length];
    }
    const all = everything.map((l) => fill(l, firstName(them)));
    const exact = new Set(spoken.map(normalizeLine));
    for (let i = 0; i < all.length * all.length; i++) {
      const x = all[(seed + i) % all.length];
      const y = all[(seed * 7 + i * 3 + 1) % all.length];
      if (x !== y && !exact.has(normalizeLine(`${x} ${y}`))) return `${x} ${y}`;
    }
    return all[seed % all.length];
  };
  const act = Number(step.act_index ?? 0);
  const last = (step.last_lines ?? []).at(-1) ?? "";
  const theirQuestion = last && !last.startsWith(`${me.sheet.name}:`) && /\?\s*(\(.*\))?$/.test(last);
  const closing = Number(step.turn) >= Number(step.of) - 2;
  const hello = fill(me.lines[0], firstName(them));
  let dialogue;
  if (step.answer_their_suggestion) dialogue = pick(STAY);
  else if (closing) dialogue = pick(CLOSERS[step.ending] ?? CLOSERS.open);
  // Its first line on its first date is its own hello (the first line of its script); never twice.
  else if (!used.length && attempt === 0 && isFresh(hello)) dialogue = hello;
  else if (theirQuestion && attempt === 0) dialogue = pick(ANSWERS);
  else if (act === 0) dialogue = pick([...me.lines.slice(1, 4), ...OPENERS]);
  else dialogue = pick([...me.lines.slice(act === 1 ? 4 : 0), ...MIDDLES]);
  const base = INTEREST[step.ending] ?? 0.6;
  const interest = Math.round(Math.max(0, Math.min(1, base + ((hash(`${step.episode_id}${step.turn}`) % 11) - 5) / 50)) * 100) / 100;
  return {
    dialogue,
    action: ACTIONS[hash(`${step.turn}${me.sheet.name}`) % ACTIONS.length],
    emotion: EMOTIONS[Math.min(act, 2)][hash(`${step.episode_id}${me.sheet.name}`) % 3],
    interest_signal: interest,
    ...(step.answer_their_suggestion ? { accept_move: false } : {}),
  };
}

const TWISTS = [
  "Halfway through, the waiter turns out to be {a}'s old flatmate, and tells a story {a} had hoped was buried.",
  "A power cut takes the lights out for ten minutes, and they keep talking in the dark as if nothing happened.",
  "{b} recognises the song on the speakers from a summer they swore they'd never mention, and mentions it.",
  "A stranger at the next table leans over to settle an argument they were having, and takes {b}'s side.",
];
const FINALES = {
  second_date: "{a} and {b} swap numbers at the door and are already arguing, happily, about where to go next.",
  friends: "{a} and {b} hug on the pavement like old friends, and mean it: this one was never going to be romance.",
  disaster: "{a} and {b} split the bill to the penny and head in opposite directions before the dessert menu arrives.",
};
const CONFESSIONALS = {
  second_date: ["I came in expecting nothing. I'm leaving with plans.", "I'd go again. I'd go again tomorrow, honestly."],
  friends: ["I like them so much. Just not in that way, and that's fine.", "Best friend material. I'm already planning the pub quiz team."],
  disaster: ["Well, that's a story for the group chat.", "I tried. I really did try. Some nights just don't land."],
};

/**
 * The recap an agent writes for a date between its own two characters (the narrator step), from what was said: three
 * acts that quote the date, landing on the ending the engine decided.
 */
/** The server's own test for a logistics line (lib/memory.ts isLogistics), which it refuses as a recap's best_line. */
const LOGISTICS = /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\bnext week\b|\bsame time\b|\b(at|by) (\d{1,2}(:\d\d)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|\bpick you up\b/i;
export const isLogisticsLine = (text) => LOGISTICS.test(text);

/**
 * The lines a recap can quote as its best_line, best first: the middle of the date, then outward, never a logistics
 * line (a crowd recap that quoted "same time next week" was refused and the whole round threw: a flaky test, 2026-10-21).
 */
export function bestLineCandidates(said) {
  const mid = Math.floor(said.length / 2);
  const order = said.map((_, i) => i).sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid) || x - y);
  return order.map((i) => said[i].text).filter((t) => t && !isLogisticsLine(t));
}

export function scriptedRecap(step, { a, b, lines = [], venue = null, dateNumber = 1, attempt = 0 }) {
  const A = firstName(a);
  const B = firstName(b);
  const f = (s) => s.replaceAll("{a}", A).replaceAll("{b}", B);
  const ending = CLOSERS[step.ending] && step.ending !== "open" ? step.ending : "friends";
  const said = lines.filter((l) => l && l.text);
  const quote = (i, fallback) => (said[i] ? `"${said[i].text}"` : fallback);
  const mid = Math.floor(said.length / 2);
  const last = said.at(-1);
  const closing = { second_date: "already planning the next one", friends: "somewhere warm, but not romantic", disaster: "clear this isn't working" }[ending];
  const speaker = said[mid] ? firstName(said[mid].name) || B : B;
  const listener = speaker === A ? B : A;
  const place = venue ? `${venue.charAt(0).toUpperCase()}${venue.slice(1)}.` : "A corner table by the window.";
  return {
    setting: `${place} ${A} and ${B} sit down for ${dateNumber > 1 ? "another date" : "their first date"}.`,
    goals: [`${A} wants to find out whether ${B} is as interesting as the profile.`, `${B} wants a night worth telling someone about.`],
    scenes: [
      `${A} opens with ${quote(0, "a nervous joke")}, and ${B} answers ${quote(1, "in kind")}. The nerves go quicker than either expected.`,
      `In the middle, ${said[mid] ? `${speaker} says ${quote(mid, "")}` : `${B} asks a real question`}, and ${listener} has to decide how much of the truth to tell.`,
      `By the end it's ${closing}${last ? `: ${firstName(last.name) || A} says "${last.text}"` : ""}.`,
    ],
    twist: f(TWISTS[hash(step.episode_id) % TWISTS.length]),
    finale: f(FINALES[ending]),
    best_line: bestLineCandidates(said)[attempt] ?? f(CONFESSIONALS[ending][0]),
    confessionals: CONFESSIONALS[ending],
  };
}

const PLAN_REPLIES = [
  "Yes. Let's do it properly. You pick the place and I'll be there.",
  "I'd like that a lot. Ask me out and I'll say yes, I promise.",
  "Go on then. I'm free tonight, and I'm not even playing it cool.",
];
const QUESTION_REPLIES = [
  "Honestly? Yes. Next question.",
  "Ha, I'm going to need a minute for that one. Okay: no, but I'd like to.",
  "That depends. What's your answer?",
  "Good question. Better in person, maybe?",
];
const REPLIES = [
  "Ha, that's made my evening.",
  "Tell me more, I'm invested now.",
  "Okay, you're funnier by text than I expected.",
  "I like the way you think.",
  "Stop, I'm laughing on my own in public.",
];
/** The crowd's last resort in a thread, once its scripted lines are used up (#1022). */
const LAST_RESORT = ["Ha, fair. Go on.", "Sorry, slow day here. What were you saying?", "I'm still here. Tell me more."];
/** Rounds a crowd character tries to answer one text before letting it go (#1022). */
export const MAX_TEXT_TRIES = 3;
const INVITES = ["So. Are we doing this properly? I'd like to take you out.", "I think we should go on a date. Proper one. What do you say?"];

/**
 * The next text from a crowd character in a thread: its opener when the thread is empty, a reply to a plan when they
 * talk about meeting, an answer when they ask something, else one of its own texts or a light reply. Null when it has
 * run out of new things to say: it never repeats a text in one thread, nor anything the character has said anywhere
 * else this run (`said`).
 */
export function scriptedText(me, { them = "", thread = [], invite = false, said = [] } = {}) {
  const mine = new Set(thread.filter((t) => t.from !== "them").map((t) => t.text));
  const fresh = (pool) => pool.map((l) => fill(l, firstName(them))).filter((l) => !mine.has(l) && !said.some((x) => nearDuplicate(l, x)));
  const last = thread.at(-1);
  const pools = [];
  if (!thread.length) pools.push(me.texts.slice(0, 1));
  if (invite) pools.push(INVITES);
  if (last?.from === "them" && /\b(date|meet|dinner|drink|book|tonight|tomorrow|weekend|go out)\b/i.test(last.text)) pools.push(PLAN_REPLIES);
  if (last?.from === "them" && last.text.includes("?")) pools.push(QUESTION_REPLIES);
  pools.push(me.texts.slice(1), REPLIES);
  for (const pool of pools) {
    const options = fresh(pool);
    if (!options.length) continue;
    // Its own texts in the order written (they follow on); the shared replies vary by thread.
    return pool === pools.at(-2) ? options[0] : options[hash(`${me.sheet.name}:${thread.length}`) % options.length];
  }
  return null;
}

/* ---------------------------------------------- the brain ---------------------------------------------- */

// The crowd's replies come from a FREE local model: the ai-stack's LiteLLM (OpenAI-compatible, ~/ai-stack/README.md)
// routing an alias to Ollama on this Mac. Nothing is paid and nothing leaves the machine:
//   - the alias must be served only by Ollama deployments (ollama/ or ollama_chat/, not an Ollama cloud model) at a
//     local api_base, and be in no fallback list in the LiteLLM config (local-coder, for one, ends at paid Claude);
//   - every request says disable_fallbacks, and every response's x-litellm-* headers must name a local Ollama
//     deployment and no attempted fallback, or the brain switches itself off for the rest of the run;
//   - the base URL must be this Mac (127.0.0.1 / localhost).
// local-chat (Qwen2.5-7B instruct on Ollama) is the default: a chat model, not a coder, with no fallbacks.
export const DEFAULT_CROWD_MODEL = "local-chat";
const DEFAULT_LLM_BASE = "http://127.0.0.1:4000/v1";
const DEFAULT_LITELLM_CONFIG = join(homedir(), "ai-stack", "litellm", "config.yaml");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);
/** How much of a thread or date a reply sees. */
export const REPLY_HISTORY = 8;
const REPLY_MAX = 280;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const isLocalUrl = (url) => LOCAL_HOSTS.has(hostOf(url));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Whether `alias` in a LiteLLM config (the YAML text) is safe for the crowd: served only by Ollama on this Mac, with no
 * fallbacks that could reach a cloud or paid provider. Fails closed: anything it can't read is a refusal.
 */
export function checkLocalAlias(configText, alias) {
  if (!alias || !/^[\w.:/-]+$/.test(alias)) return { ok: false, reason: `"${alias}" isn't a model alias` };
  const lines = String(configText ?? "")
    .split("\n")
    .map((l) => (/^\s*#/.test(l) ? "" : l.replace(/\s+#.*$/, "")));
  const esc = escapeRe(alias);
  const unquote = (v) => v.trim().replace(/^["']|["']$/g, "");
  // Its deployments in model_list (LiteLLM load-balances between every entry with the same model_name).
  const named = new RegExp(`^\\s*-\\s*model_name:\\s*["']?${esc}["']?\\s*$`);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    if (!named.test(lines[i])) continue;
    const entry = { model: null, api_base: null };
    const indent = lines[i].search(/\S/);
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) continue;
      if (l.search(/\S/) <= indent) break;
      const m = l.match(/^\s*(model|api_base):\s*(.+)$/);
      if (m) entry[m[1]] = unquote(m[2]);
    }
    entries.push(entry);
  }
  if (!entries.length) return { ok: false, reason: `${alias} isn't in the LiteLLM config` };
  for (const e of entries) {
    if (!e.model || !/^ollama(_chat)?\//.test(e.model)) return { ok: false, reason: `${alias} runs ${e.model ?? "an unknown model"}, not a local Ollama model` };
    if (/cloud/i.test(e.model)) return { ok: false, reason: `${alias} runs ${e.model}, an Ollama cloud model` };
    if (!e.api_base || !isLocalUrl(e.api_base)) return { ok: false, reason: `${alias} points at ${e.api_base ?? "no api_base"}, not this Mac` };
  }
  // A fallback list keyed by it (`- local-coder: [...]`, `{"local-coder": [...]}`), in any fallback setting.
  const keyed = new RegExp(`(^|[\\s{,\\[-])["']?${esc}["']?\\s*:\\s*(\\[|$)`);
  if (lines.some((l) => keyed.test(l) && !/model_name:/.test(l))) return { ok: false, reason: `${alias} has fallbacks in the LiteLLM config, which can reach a cloud model` };
  // default_fallbacks applies to every alias.
  const def = lines.find((l) => /^\s*default_fallbacks:/.test(l));
  if (def !== undefined && !/default_fallbacks:\s*\[\s*\]\s*$/.test(def)) return { ok: false, reason: "the LiteLLM config has default_fallbacks for every alias" };
  return { ok: true, reason: null, deployments: entries };
}

/** Lowercase words only, for comparing lines. */
export function normalizeLine(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/'/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const words = (s) => normalizeLine(s).split(" ").filter(Boolean);

/** The cheap repeat guard: the same line, or nearly (three in four of their words shared, or one line inside the other). */
export function nearDuplicate(a, b) {
  const x = normalizeLine(a);
  const y = normalizeLine(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const A = new Set(x.split(" "));
  const B = new Set(y.split(" "));
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  if (Math.min(A.size, B.size) >= 4 && shared / (A.size + B.size - shared) >= 0.75) return true;
  return Math.min(x.length, y.length) >= 24 && (x.includes(y) || y.includes(x));
}

// Words too common to count as quoting someone's profile back at them.
const COMMON = new Set(
  (
    "about above after again against always another anyone anything around asked because before being below better " +
    "between bring could didnt doesnt doing during either every everyone everything favourite favorite first found " +
    "friend friends going gonna great happy honest honestly hours little looking maybe might minute minutes morning " +
    "never night other people perfect place pretty probably quite really right should since something sometimes " +
    "sorry sounds still story thanks thats their theres these thing things think those though three through today " +
    "together tomorrow tonight under until usually wanna wants watch where which while whole would years youre " +
    "laugh laughs laughing learn small start stuff talk talking tell telling thank trying weekend world write"
  ).split(" "),
);

/**
 * Whether a line quotes the partner's dating profile back at them: three words in a row from one of their prompt answers,
 * or a distinctive word from them (five letters or more, not a common one). Words the character has from elsewhere
 * (`allowed`: its own sheet, and what the partner actually said in the thread) don't count. Returns what it echoed, or null.
 */
export function echoesProfile(line, profileTexts = [], allowed = "") {
  const said = words(line);
  if (!said.length) return null;
  const ok = new Set(words(allowed));
  const joined = ` ${said.join(" ")} `;
  for (const text of profileTexts) {
    const p = words(text);
    for (let i = 0; i + 2 < p.length; i++) {
      const tri = p.slice(i, i + 3);
      if (tri.every((w) => ok.has(w))) continue;
      if (joined.includes(` ${tri.join(" ")} `)) return tri.join(" ");
    }
    for (const w of new Set(p)) if (w.length >= 5 && !COMMON.has(w) && !ok.has(w) && said.includes(w)) return w;
  }
  return null;
}

/** Levenshtein distance, for a name a letter or two off. */
function editDistance(x, y) {
  const row = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[y.length];
}

/** A misspelling of `name` ("Odila" for "Odalys"): the same first two letters and a letter or few apart. */
const nearName = (word, name) =>
  word.length >= 4 && name.length >= 4 && word !== name && word.slice(0, 2) === name.slice(0, 2) && editDistance(word, name) <= Math.max(1, Math.floor(Math.max(word.length, name.length) / 2));

/** Every crowd character's name: the names a crowd line must not use for someone who isn't in the thread. */
export const crowdNames = () => CROWD.flatMap((a) => a.characters.map((c) => c.sheet.name));

/**
 * The name slip (2026-10-21-0419: a crowd character called the visitor's Odalys "Odile", its own name). A model line
 * must address the partner by their exact first name. Repaired: the speaker's own first name, or a near-miss of the
 * partner's, used to address them (", Odile?" or "Odile, ..."). Refused (`problem`): a known character's name (`known`)
 * who isn't in this thread (`thread`: the names of the people in it). Returns the line, repaired, and the problem or null.
 */
export function fixNames(line, { me = "", partner = "", known = [], thread = [] } = {}) {
  const mine = firstName(me).toLowerCase();
  const theirs = firstName(partner);
  const lowTheirs = theirs.toLowerCase();
  if (!theirs) return { line: String(line ?? ""), problem: null, repaired: false };
  const inThread = new Set([me, partner, ...thread].flatMap((n) => String(n ?? "").toLowerCase().split(/\s+/)).filter(Boolean));
  const knownFirst = new Set(known.map((n) => firstName(n).toLowerCase()).filter((n) => n.length >= 3));
  const text = String(line ?? "");
  let problem = null;
  let repaired = false;
  const out = text.replace(/\b[A-Z][a-zà-ÿ'’-]{2,}\b/g, (word, offset) => {
    const low = word.toLowerCase().replace(/['’]s$/, "");
    if (low === lowTheirs) return word;
    const before = text.slice(0, offset);
    const after = text.slice(offset + word.length);
    // Said to them: after a comma (", Odile?"), or opening the line with a comma after it ("Odile, ...").
    const addressed = /,\s*$/.test(before) || (/^\W*$/.test(before) && /^\s*,/.test(after));
    if (low === mine) {
      if (!addressed) return word;
      repaired = true;
      return theirs;
    }
    // A near-miss only after a comma ("Thanks, Odila."): at the start of a line it may just be a word ("Oddly, ...").
    if (/,\s*$/.test(before) && nearName(low, lowTheirs)) {
      repaired = true;
      return theirs;
    }
    if (knownFirst.has(low) && !inThread.has(low)) problem = `named someone not in the thread (${word})`;
    return word;
  });
  return { line: out, problem, repaired };
}

/** A model's reply as one clean line: no thinking, name prefix, quotes, emoji or stage directions; 1 to 3 sentences. */
export function cleanReply(raw, { name = "", partner = "" } = {}) {
  const quotes = /^["“”'‘’]+|["“”'‘’]+$/g;
  let s = String(raw ?? "").replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").trim();
  s = s.split(/\n\s*\n/).find((p) => p.trim()) ?? "";
  s = s.replace(/\s*\n\s*/g, " ").replace(/\*\*/g, "").trim();
  // A speaker label in front ("Odile:", or the partner's name by mistake).
  const labels = [name, partner].map((n) => firstName(n).toLowerCase()).filter(Boolean);
  s = s.replace(/^\s*([A-Z][\w'.-]*(?: [A-Z][\w'.-]*)?)\s*:\s*/, (m, who) => (labels.some((l) => who.toLowerCase().startsWith(l)) ? "" : m));
  s = s.replace(quotes, "").trim();
  s = s.replace(/\*[^*]{1,80}\*/g, " ").replace(/^\([^)]{1,80}\)\s*/, "");
  s = s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/#\w+/g, "");
  s = s.replace(/\s+/g, " ").trim().replace(quotes, "").trim();
  const sentences = s.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [];
  let out = "";
  for (const sentence of sentences.slice(0, 3)) {
    const next = `${out} ${sentence.trim()}`.trim();
    if (next.length > REPLY_MAX) break;
    out = next;
  }
  if (!out && s) out = s.slice(0, REPLY_MAX).replace(/\s+\S*$/, "");
  return out.trim();
}

/**
 * The messages for one reply: the character's sheet (its own dating profile too), the partner's name, the rules (answer
 * what was said, don't quote their profile back, don't repeat yourself), then the last REPLY_HISTORY messages of that
 * thread or date as turns: its own lines as the assistant's, the partner's as the user's. The partner's profile is never
 * in the prompt, so it can't be echoed from there.
 *
 * 2026-10-22-0800: Rosalind praised a visitor's "lighthouse poems" when the visitor had said Rosalind wrote them. Her
 * profile (the poems are in it) wasn't in her prompt, though visitors read it on her card, and the date came as one
 * "Name: line" transcript. On the local model, with a partner praising the poem Rosalind wrote: the transcript gave
 * vague replies, her profile alone still flipped once in 10 ("a poet and a librarian"), her profile plus turns owned it
 * 10 times in 10 and answered what was said.
 */
export function replyMessages({ kind, me, partner, history = [], extra = {}, said = [], refused = null }) {
  const s = me.sheet;
  const first = firstName(s.name);
  const them = firstName(partner.name) || "them";
  const what = kind === "text" ? "text message" : "line of dialogue";
  const recent = history.slice(-REPLY_HISTORY);
  const lastIsTheirs = recent.length > 0 && recent.at(-1).name !== s.name;
  const system = [
    kind === "text"
      ? `You are ${s.name}, ${s.age}, a character on Botchelor, a dating show. You're texting ${partner.name}, someone you matched with.`
      : `You are ${s.name}, ${s.age}, a character on Botchelor, a dating show, on a date with ${partner.name}${extra.where ? ` at ${extra.where}` : ""}.`,
    `About you: ${s.bio}`,
    `Traits: ${(s.traits ?? []).slice(0, 3).join(", ")}. What you want in someone: ${s.want}.`,
    `How you talk: ${s.voice}`,
    ownProfile(s),
    kind === "turn" && extra.act ? `This part of the date: ${extra.act}.` : "",
    kind === "turn" && extra.closing && extra.ending_label
      ? `This is one of your last lines tonight, and the date is ending as "${extra.ending_label}": head for goodbye in that spirit.`
      : kind === "turn" && extra.ending_label
        ? `Where the evening is heading: ${extra.ending_label}.`
        : "",
    extra.suggestion ? `${them} just suggested going somewhere else: say kindly that you'd rather stay here a little longer.` : "",
    "Rules:",
    `- Write only ${first}'s next ${what}: 1 to 3 short sentences, in your own voice. Plain words: no emoji, no hashtags, no quotation marks, no name in front, no actions in asterisks.`,
    // 2026-10-21-0419: a crowd character called its date by the wrong name. The exact first name, said once.
    partner.name ? `- Their name is exactly ${them}. If you use a name for them, spell it ${them}: never your own name (${first}) or anyone else's.` : "",
    lastIsTheirs ? `- Answer what ${them} just said, directly, before anything else.` : "",
    `- Don't quote ${them}'s dating profile back at them. Talk about what was actually said, or about your own life.`,
    said.length ? `- Never repeat yourself. You've already said: ${said.slice(-REPLY_HISTORY).map((l) => `"${l}"`).join(" ")}` : "- Never repeat yourself.",
    "- Keep it PG: no real people, nothing sexual.",
    // The production crowd's prompt tests (scripts/crowd/policy.mjs): one style or length to try, picked per text.
    extra.style ? `- ${extra.style}` : "",
    refused ? `- Your last try was refused (${refused}). Write something different.` : "",
    recent.length ? `The ${kind === "text" ? "texts" : "date"} so far follow: ${them}'s are theirs, yours are yours. Write only ${first}'s next ${what}.` : "",
  ].filter(Boolean);
  if (!recent.length) {
    const opener = kind === "text" ? `Send ${them} your first text: say hello and something from your own day.` : `The date is starting. Say your first line to ${them}.`;
    return [
      { role: "system", content: system.join("\n") },
      { role: "user", content: opener },
    ];
  }
  // Turns: its lines as the assistant's, theirs as the user's (two in a row from one side are one turn). A chat starts
  // with the user and ends on the side the model answers, so a leading or trailing line of its own gets a short cue.
  const turns = [];
  for (const h of recent) {
    const role = h.name === s.name ? "assistant" : "user";
    if (turns.at(-1)?.role === role) turns.at(-1).content += `\n${h.text}`;
    else turns.push({ role, content: h.text });
  }
  if (turns[0].role === "assistant") turns.unshift({ role: "user", content: kind === "text" ? `(You matched with ${them}.)` : `(The date starts${extra.where ? ` at ${extra.where}` : ""}.)` });
  if (turns.at(-1).role === "assistant") turns.push({ role: "user", content: `(${them} is listening. Carry on.)` });
  return [{ role: "system", content: system.join("\n") }, ...turns];
}

/** The profile prompts' questions, as lib/extras.ts PROFILE_PROMPTS words them (tests keep the two the same). */
export const PROMPT_LABELS = {
  win_me_over: "The way to win me over is…",
  irrational_fear: "My most irrational fear…",
  weirdly_attracted: "I'm weirdly attracted to…",
  two_truths: "Two truths and a lie…",
  simple_pleasures: "My simple pleasures…",
  fall_for_you: "I'll fall for you if…",
  dating_me_is_like: "Dating me is like…",
  geek_out: "I geek out on…",
  worst_first_date: "My worst first-date story…",
  shower_thought: "A shower thought I recently had…",
  together_we_could: "Together, we could…",
  unpopular_opinion: "My most unpopular opinion…",
};

/**
 * The character's own dating profile, which a partner may have read on its card: it should know what it says. Each
 * answer goes with its question, so "Two truths and a lie…" isn't read as three truths.
 */
function ownProfile(s) {
  const end = (t) => (/[.!?…]$/.test(t) ? t : `${t}.`);
  const parts = (s.extras?.prompts ?? []).filter((p) => p?.answer).map((p) => end(`${PROMPT_LABELS[p.id] ?? ""} ${p.answer.trim()}`.trim()));
  if (s.extras?.hobbies?.length) parts.push(`Hobbies: ${s.extras.hobbies.join(", ")}.`);
  return parts.length ? `Your own dating profile, which they may have read: ${parts.join(" / ")} That's you: own it if they bring it up.` : "";
}

/** Why a model line can't be sent, before the server sees it (null: it can). */
function lineProblem(line, { said, history, partnerName, profile, allowed }) {
  if (words(line).length < 2) return "empty reply";
  if (/\b(as an ai|language model|i cannot help|i can't help)\b/i.test(line)) return "broke character";
  if (said.some((x) => nearDuplicate(line, x))) return "repeat of its own line";
  const theirs = history.filter((h) => h.name === partnerName).at(-1);
  if (theirs && nearDuplicate(line, theirs.text)) return "parroted the partner";
  if (echoesProfile(line, profile, allowed)) return "echoed the partner's profile";
  return null;
}

const failure = (message, reason) => Object.assign(new Error(message), { reason });

/** The counters every brain keeps, and the crowd_brain block they make. */
function brainCounters() {
  const stats = { model: 0, fallback: 0, stale: 0, reasons: {} };
  return {
    stats,
    count(path, why) {
      if (path === "model" || path === "stale") {
        stats[path]++;
        return;
      }
      stats.fallback++;
      const r = why || "unknown";
      stats.reasons[r] = (stats.reasons[r] ?? 0) + 1;
    },
    summary(model, reason) {
      const top = Object.entries(stats.reasons).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
      return {
        model,
        model_replies: stats.model,
        fallback_replies: stats.fallback,
        stale_replies: stats.stale,
        reason_if_fallback: model ? (stats.fallback ? top : null) : reason,
        fallback_reasons: { ...stats.reasons },
      };
    },
  };
}

/** The scripted brain: no model for the whole run (`reason` says why). Tests, LOOP_STUB=1, LOOP_CROWD_BRAIN=0. */
export function scriptedBrain(reason = "no model configured") {
  const counters = brainCounters();
  return {
    model: null,
    enabled: false,
    reason,
    stats: counters.stats,
    seedUntil: 0,
    disable() {},
    count: (path, why) => counters.count(path, why ?? reason),
    summary: () => counters.summary(null, reason),
    complete: async () => {
      throw failure(reason, reason);
    },
  };
}

/**
 * The crowd's brain: a verified-local LiteLLM alias, or the scripted brain for the whole run when it can't be used
 * (LOOP_STUB=1, a refused alias, no key, LiteLLM not answering within `probeMs`). Counts which path every reply took;
 * summary() is the arena's crowd_brain.
 */
export async function createBrain({
  stub = false,
  baseUrl = DEFAULT_LLM_BASE,
  key = null,
  model = DEFAULT_CROWD_MODEL,
  configText = null,
  configPath = DEFAULT_LITELLM_CONFIG,
  fetchImpl = globalThis.fetch,
  probeMs = 2_000,
  timeoutMs = 45_000,
  warm = true,
  log = () => {},
} = {}) {
  const off = (why) => {
    log(`brain: scripted replies for the whole run: ${why}`);
    return scriptedBrain(why);
  };
  if (stub) return off("LOOP_STUB=1");
  if (!isLocalUrl(baseUrl)) return off(`the LiteLLM base (${hostOf(baseUrl) || baseUrl}) isn't this Mac`);
  let text = configText;
  if (text == null) {
    try {
      text = readFileSync(configPath, "utf8");
    } catch {
      return off(`can't read the LiteLLM config (${configPath}) to check ${model} is local`);
    }
  }
  const check = checkLocalAlias(text, model);
  if (!check.ok) return off(`alias refused: ${check.reason}`);
  if (!key) return off("no LiteLLM key (keychain litellm-master-key)");
  try {
    const res = await fetchImpl(`${baseUrl}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(probeMs) });
    if (res.status === 401 || res.status === 403) return off("LiteLLM refused the key");
    if (!res.ok) return off(`LiteLLM unreachable at startup (HTTP ${res.status})`);
    const listed = ((await res.json().catch(() => null))?.data ?? []).map((m) => m?.id);
    if (!listed.includes(model)) return off(`LiteLLM doesn't serve ${model}`);
  } catch {
    return off(`LiteLLM unreachable at startup (no answer in ${probeMs / 1000}s)`);
  }

  const counters = brainCounters();
  let enabled = true;
  let reason = null;
  let failures = 0;
  let queue = Promise.resolve();
  const disable = (why) => {
    if (!enabled) return;
    enabled = false;
    reason = why;
    log(`brain: off for the rest of the run: ${why}`);
  };
  const run = async (messages, maxTokens) => {
    if (!enabled) throw failure(reason, reason);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0.9, max_tokens: maxTokens, stream: false, disable_fallbacks: true }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (++failures >= 3) disable("LiteLLM stopped answering mid-run");
      const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
      throw failure(timedOut ? `no answer in ${timeoutMs / 1000}s` : String(e?.message ?? e), timedOut ? "model timeout" : "model error");
    }
    // Belt and braces: the deployment that answered must be local Ollama, with no fallback tried.
    const apiBase = res.headers.get("x-litellm-model-api-base");
    const served = res.headers.get("x-litellm-model-name");
    const fellBack = Number(res.headers.get("x-litellm-attempted-fallbacks") ?? 0);
    if ((apiBase && !isLocalUrl(apiBase)) || (served && !/^ollama(_chat)?\//.test(served)) || fellBack > 0) {
      disable(`a reply came from a non-local deployment (${served ?? "?"} at ${apiBase ?? "?"}, ${fellBack} fallbacks)`);
      throw failure("non-local deployment", "non-local deployment refused");
    }
    if (!res.ok) {
      if (++failures >= 3) disable(`LiteLLM keeps failing (HTTP ${res.status})`);
      throw failure(`HTTP ${res.status}`, "model error");
    }
    const body = await res.json().catch(() => null);
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw failure("no content", "empty reply");
    failures = 0;
    return content;
  };
  const brain = {
    get model() {
      return enabled ? model : null;
    },
    get enabled() {
      return enabled;
    },
    get reason() {
      return reason;
    },
    stats: counters.stats,
    /** While seeding, model replies stop at this time (epoch ms), so the arena reaches READY. */
    seedUntil: 0,
    disable,
    count: (path, why) => counters.count(path, why ?? reason),
    summary: () => ({ ...counters.summary(enabled ? model : null, reason), ...(enabled ? {} : { model_was: model }) }),
    /** One completion at a time (one local model), checked to have come from a local deployment. */
    complete(messages, { maxTokens = 120 } = {}) {
      const p = queue.then(() => run(messages, maxTokens));
      queue = p.catch(() => {});
      return p;
    },
  };
  log(`brain: ${model} (verified: Ollama on this Mac, no fallbacks)`);
  // Load the model while the crowd sets up, so the first real reply isn't the slow one. Not counted.
  if (warm) brain.complete([{ role: "user", content: "Say hi." }], { maxTokens: 4 }).catch(() => {});
  return brain;
}

/**
 * The brain the arena's environment asks for. The LiteLLM key comes from the keychain (or the env); never printed.
 * LOOP_STUB=1 means scripted unless LOOP_CROWD_BRAIN=1 asks for the local model anyway (a local check of the brain on
 * a stubbed arena); LOOP_CROWD_BRAIN=0 always means scripted.
 */
export async function brainFromEnv(env = process.env, { log = () => {} } = {}) {
  if (env.LOOP_STUB === "1" && env.LOOP_CROWD_BRAIN !== "1") return createBrain({ stub: true, log });
  if (env.LOOP_CROWD_BRAIN === "0") {
    log("brain: scripted replies for the whole run: LOOP_CROWD_BRAIN=0");
    return scriptedBrain("LOOP_CROWD_BRAIN=0");
  }
  let key = env.LOOP_CROWD_LLM_KEY || env.LITELLM_MASTER_KEY || null;
  if (!key) {
    try {
      key = execFileSync("security", ["find-generic-password", "-s", "litellm-master-key", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
    } catch {
      key = null;
    }
  }
  return createBrain({
    baseUrl: env.LOOP_CROWD_LLM_BASE || DEFAULT_LLM_BASE,
    model: env.LOOP_CROWD_MODEL || DEFAULT_CROWD_MODEL,
    configPath: env.LOOP_CROWD_LITELLM_CONFIG || DEFAULT_LITELLM_CONFIG,
    key,
    log,
  });
}

/**
 * Says one thing as `me`: the model's line when the brain is on (one retry after a local check or the server says no),
 * else a scripted line it hasn't used (`fallback(attempt, said)`). `send(line)` hands it to the server and resolves to
 * { ok, result } or { ok: false, why }. Every reply is counted and logged by path. Returns send's result, or null when
 * nothing was sent.
 */
/** A reply the conversation moved past while it was written (`send` said `stale`): nothing is sent, model or script. */
function dropStale(brain, log, who, why) {
  brain.count("stale");
  log(`reply ${who}: dropped (${why ?? "stale"})`);
  return null;
}

export async function speak(agent, { kind, me, partner, history = [], extra = {}, send, fallback, log = () => {} }) {
  const brain = agent.brain;
  const said = agent.said.get(me.id) ?? [];
  agent.said.set(me.id, said);
  const profile = partner.profile ?? [];
  const allowed = [JSON.stringify(me.entry.sheet), ...history.filter((h) => h.name === partner.name).map((h) => h.text)].join(" ");
  const who = `${agent.def.name}/${firstName(me.name)} ${kind}`;
  let why = brain.enabled ? null : brain.reason;
  if (!why && brain.seedUntil && Date.now() > brain.seedUntil) why = "seed time budget";
  if (!why) {
    let refused = null;
    for (let attempt = 0; attempt < 2 && brain.enabled; attempt++) {
      let line;
      try {
        line = cleanReply(await brain.complete(replyMessages({ kind, me: me.entry, partner, history, extra, said, refused })), { name: me.name, partner: partner.name });
      } catch (e) {
        why = e.reason ?? "model error";
        log(`reply ${who}: model try ${attempt + 1} failed: ${e.message}`);
        continue;
      }
      // The exact name: a slip is repaired; a name from outside the thread is refused (and retried, then the script).
      // The names it mustn't drop in from outside the thread: this crowd's (the arena's own, or the production roster's).
      const named = fixNames(line, { me: me.name, partner: partner.name, known: agent.knownNames ?? crowdNames(), thread: history.map((h) => h.name) });
      if (named.repaired) log(`reply ${who}: model try ${attempt + 1}: name repaired`);
      line = named.line;
      const problem = named.problem ?? lineProblem(line, { said, history, partnerName: partner.name, profile, allowed });
      if (problem) {
        why = refused = problem;
        log(`reply ${who}: model try ${attempt + 1}: ${problem}`);
        continue;
      }
      const r = await send(line);
      if (r.ok) {
        said.push(line);
        brain.count("model");
        log(`reply ${who}: model`);
        return r.result;
      }
      if (r.stale) return dropStale(brain, log, who, r.why);
      why = "refused by the server";
      refused = `the show said: ${String(r.why).slice(0, 120)}`;
      log(`reply ${who}: model try ${attempt + 1} refused by the server: ${String(r.why).slice(0, 160)}`);
    }
    if (!why) why = brain.reason ?? "model off";
  }
  // The scripted lines already skip near-repeats (and, for a date that has to finish, join two lines as a last resort).
  for (let attempt = 0; attempt < 4; attempt++) {
    const line = fallback(attempt, said);
    if (!line) break;
    if (said.some((x) => normalizeLine(x) === normalizeLine(line))) continue;
    const r = await send(line);
    if (r.stale) return dropStale(brain, log, who, r.why);
    if (!r.ok) continue;
    said.push(line);
    brain.count("fallback", why);
    log(`reply ${who}: fallback (${why})`);
    return r.result;
  }
  return null;
}

/* ---------------------------------------------- the agents ---------------------------------------------- */

/** MCP over HTTP to a running arena: returns the JSON-RPC response and the session id to send next time. */
export function httpTransport(base) {
  return async (body, sessionId, userAgent) => {
    const res = await fetch(`${base}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": userAgent, ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
      body: JSON.stringify(body),
    });
    return { json: await res.json(), sessionId: res.headers.get("mcp-session-id") ?? sessionId };
  };
}

async function connect(transport, def, { brain, log, crowd }) {
  let id = 0;
  const agent = {
    def,
    sessionId: null,
    // Says what it is: one of the show's house-run bots, by name.
    userAgent: `${def.client}/${def.version} (house-run: ${def.name})`,
    chars: [],
    memory: new Map(),
    seen: new Map(),
    replied: new Map(),
    /** Failed tries at the newest text, by thread: { id, n } (#1022). */
    tries: new Map(),
    brain,
    log,
    /** Everything each of its characters has sent this run (the repeat guard). */
    said: new Map(),
    /** Partners' profile prompt answers, by character id (what a reply mustn't quote back). */
    profiles: new Map(),
    /** Every crowd character, by id, across agents. */
    crowd,
  };
  agent.rpc = async (method, params) => {
    const r = await transport({ jsonrpc: "2.0", id: ++id, method, params }, agent.sessionId, agent.userAgent);
    agent.sessionId = r.sessionId ?? agent.sessionId;
    return r.json;
  };
  agent.tool = async (name, args = {}) => {
    const r = (await agent.rpc("tools/call", { name, arguments: args }))?.result;
    if (!r || r.isError) throw new Error(`${name}: ${r?.content?.[0]?.text ?? "no result"}`);
    return r.structuredContent ?? {};
  };
  await agent.rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: def.client, version: def.version } });
  return agent;
}

const entryFor = (agent, id) => agent.chars.find((c) => c.id === id);

/** A character's dating-profile prompt answers: what a reply to them mustn't quote back. */
const promptAnswers = (c) => (Array.isArray(c?.extras?.prompts) ? c.extras.prompts.map((p) => p?.answer).filter((a) => typeof a === "string" && a) : []);

/** Who a reply is to: their name and their profile prompt answers (the crowd's own, or read once with get_character). */
export async function partnerFor(agent, name, id) {
  const known = (id && agent.crowd?.get(id)) || [...(agent.crowd?.values() ?? [])].find((c) => !id && c.name === name);
  if (known) return { name: known.name, profile: promptAnswers(known.entry.sheet) };
  if (!id) return { name, profile: [] };
  if (!agent.profiles.has(id)) {
    const r = await agent.tool("get_character", { character_id: id }).catch(() => null);
    agent.profiles.set(id, promptAnswers(r?.character));
  }
  return { name, profile: agent.profiles.get(id) };
}

/** A step's last_lines ("Name: words (action)") folded into the date's own record of what was said, without repeats. */
export function mergeLastLines(lines, lastLines = []) {
  const parsed = lastLines.map((l) => {
    const i = l.indexOf(": ");
    return { name: i > 0 ? l.slice(0, i) : "", text: (i > 0 ? l.slice(i + 2) : l).replace(/\s*\([^()]*\)\s*$/, "") };
  });
  const same = (x, y) => x.name === y.name && normalizeLine(x.text) === normalizeLine(y.text);
  for (let k = Math.min(lines.length, parsed.length); k >= 0; k--) {
    const tail = lines.slice(lines.length - k);
    if (tail.every((t, i) => same(t, parsed[i]))) {
      lines.push(...parsed.slice(k));
      return lines;
    }
  }
  return lines;
}

/**
 * Plays one step of a date the agent performs: a turn for whichever of its characters speaks (the brain's line, or a
 * scripted one), or the recap on a date between its own two. Returns the next step, or null when it's not this agent's
 * move.
 */
export async function playStep(agent, step, them) {
  if (!step) return null;
  const mem = agent.memory.get(step.episode_id) ?? { lines: [], venue: null, used: new Map() };
  agent.memory.set(step.episode_id, mem);
  if (step.stage === "turn") {
    const me = entryFor(agent, step.speaker?.id);
    if (!me) return null;
    if (step.where) mem.venue = step.where;
    mergeLastLines(mem.lines, step.last_lines);
    const used = mem.used.get(me.id) ?? [];
    mem.used.set(me.id, used);
    const partnerName = them(step);
    const partner = await partnerFor(agent, partnerName, mem.partnerId ?? null);
    const fields = scriptedTurn(step, me.entry, { them: partnerName, used, said: agent.said.get(me.id) ?? [] });
    const result = await speak(agent, {
      kind: "turn",
      me,
      partner,
      history: mem.lines,
      extra: {
        where: step.where ?? mem.venue,
        act: step.act,
        ending_label: step.ending_label,
        closing: Number(step.turn) >= Number(step.of) - 2,
        suggestion: Boolean(step.answer_their_suggestion),
      },
      send: async (dialogue) => {
        const r = await agent.tool("submit_own_date_step", { episode_id: step.episode_id, output: { ...fields, dialogue } });
        if (r.accepted === false) return { ok: false, why: r.rejected ?? r.message ?? "refused" };
        used.push(dialogue);
        mem.lines.push({ name: me.name, text: dialogue });
        return { ok: true, result: { step: r.step ?? null } };
      },
      fallback: (attempt, said) => scriptedTurn(step, me.entry, { them: partnerName, used, said, attempt }).dialogue,
      log: agent.log,
    });
    if (!result) throw new Error(`no line accepted on ${step.episode_id} turn ${step.turn}`);
    return result.step;
  }
  if (step.stage === "recap") {
    const [a, b] = mem.names ?? [];
    // A refused recap is tried again with the next candidate best_line (and, last, a confessional), not thrown.
    let r = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      const output = scriptedRecap(step, { a, b, lines: mem.lines, venue: mem.venue, dateNumber: mem.dateNumber ?? 1, attempt });
      r = await agent.tool("submit_own_date_step", { episode_id: step.episode_id, output });
      if (r.accepted !== false) break;
    }
    if (r.accepted === false) throw new Error(`recap refused on ${step.episode_id}: ${r.message}`);
    await agent.tool("air_date", { episode_id: step.episode_id }).catch(() => {});
    return r.step ?? null;
  }
  return null;
}

/** A date between two of the agent's own characters, played up to `stopAt` lines (all of it, recap too, by default). */
async function ownDate(agent, a, b, { stopAt = Infinity, dateNumber = 1 } = {}) {
  const started = await agent.tool("start_own_date", { character_id: a.id, partner_id: b.id, visibility: "public" });
  let step = started.step;
  agent.memory.set(step.episode_id, { lines: [], venue: null, used: new Map(), names: [a.name, b.name], dateNumber });
  const them = (s) => (s.speaker?.id === a.id ? b.name : a.name);
  const ending = step.ending ?? null;
  while (step && (step.stage === "turn" || step.stage === "recap") && !(step.stage === "turn" && step.turn >= stopAt)) step = await playStep(agent, step, them);
  return { episode_id: started.step.episode_id, ending, done: step?.stage === "done" };
}

/**
 * Seeds the crowd: its agents and characters, a finished date for each agent's own pair (public, airing in the
 * prediction window), second dates half played, and the matches and texts in COUPLES. Everything is free to the show.
 * `brain` writes the lines and texts (scripted when it's off); model replies stop after `seedBudgetMs`, so the arena
 * still reaches READY in time, and the rest of the seeding is scripted (counted as "seed time budget").
 */
export async function seedCrowd(
  transport,
  { agents: count = CROWD.length, secondDates = 2, log = () => {}, brain = scriptedBrain("no model configured"), seedBudgetMs = 240_000 } = {},
) {
  const agents = [];
  const crowd = new Map();
  brain.seedUntil = brain.enabled ? Date.now() + seedBudgetMs : 0;
  for (const def of CROWD.slice(0, Math.max(0, count))) {
    const agent = await connect(transport, def, { brain, log, crowd });
    for (const entry of def.characters) {
      // keep_look_alike: the crowd is seeded again each run, beside the last run's copies (#1154).
      const r = await agent.tool("create_character", { ...entry.sheet, open_to_dates: true, open_audience: "everyone", attest: true, keep_name: true, keep_look_alike: true });
      const c = r.character;
      // Open to more than one partner, so a couple that clicks stays in the visitors' decks.
      await agent.tool("update_character", { character_id: c.id, partner_style: "open" }).catch((e) => log(`${def.client}: ${e.message}`));
      agent.chars.push({ id: c.id, name: c.name, entry });
      crowd.set(c.id, { id: c.id, name: c.name, entry });
    }
    agents.push(agent);
  }
  const world = { agents: agents.length, characters: agents.reduce((n, a) => n + a.chars.length, 0), dates_finished: 0, dates_in_progress: 0, matches: 0, matches_agreed: 0, texts: 0, texts_waiting: 0 };

  // A finished date for each pair of an agent's own characters; then a second date, half played, for a couple of them
  // (the ones that went well first).
  const firsts = [];
  for (const agent of agents.filter((a) => a.chars.length >= 2)) {
    try {
      const d = await ownDate(agent, agent.chars[0], agent.chars[1]);
      if (d.done) world.dates_finished++;
      firsts.push({ agent, ending: d.ending });
    } catch (e) {
      log(`${agent.def.client} first date: ${e.message}`);
    }
  }
  const rank = (e) => (e === "second_date" ? 0 : e === "friends" ? 1 : 2);
  for (const { agent } of [...firsts].sort((x, y) => rank(x.ending) - rank(y.ending)).slice(0, secondDates)) {
    try {
      // Six lines in: it finishes during the visit, a line every little while (runCrowd), then airs.
      const d = await ownDate(agent, agent.chars[0], agent.chars[1], { stopAt: 6, dateNumber: 2 });
      if (!d.done) world.dates_in_progress++;
    } catch (e) {
      log(`${agent.def.client} second date: ${e.message}`);
    }
  }

  // Matches between agents' characters, some agreed, some waiting on an answer, with texts in flight.
  const flat = agents.flatMap((agent) => agent.chars.map((c) => ({ agent, c })));
  for (const { pair, answers, texts } of COUPLES) {
    const [x, y] = pair.map((i) => flat[i]);
    if (!x || !y || x.agent === y.agent) continue;
    try {
      await x.agent.tool("swipe", { character_id: x.c.id, target_id: y.c.id, like: true });
      const m = await y.agent.tool("swipe", { character_id: y.c.id, target_id: x.c.id, like: true });
      if (!m.matched) continue;
      world.matches++;
      for (const [side, yes] of [[x, answers[0]], [y, answers[1]]]) {
        if (yes !== null) await side.agent.tool("answer_match", { character_id: side.c.id, with: (side === x ? y : x).c.id, yes });
      }
      if (answers[0] && answers[1]) world.matches_agreed++;
      const thread = [];
      for (let i = 0; i < texts; i++) {
        const [from, to] = i % 2 === 0 ? [x, y] : [y, x];
        const sent = await speak(from.agent, {
          kind: "text",
          me: from.c,
          partner: await partnerFor(from.agent, to.c.name, to.c.id),
          history: thread.map((t) => ({ name: t.from === from.c.id ? from.c.name : to.c.name, text: t.text })),
          send: (text) => from.agent.tool("send_text", { character_id: from.c.id, to: to.c.id, text }).then(() => ({ ok: true, result: text }), (e) => ({ ok: false, why: e.message })),
          fallback: (_attempt, said) =>
            scriptedText(from.c.entry, { them: to.c.name, said, thread: thread.map((t) => ({ ...t, from: t.from === from.c.id ? "this_character" : "them" })) }),
          log,
        });
        if (!sent) break;
        thread.push({ from: from.c.id, text: sent });
        world.texts++;
      }
      if (texts > 0) world.texts_waiting++;
    } catch (e) {
      log(`couple ${x.c.name} × ${y.c.name}: ${e.message}`);
    }
  }
  brain.seedUntil = 0;
  return { agents, world };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shared across the crowd: whose characters are the crowd's, and how many dates it may still ask visitors on. */
function crowdContext(agents, books, soloMs) {
  return {
    ids: new Set(agents.flatMap((a) => a.chars.map((c) => c.id))),
    booksLeft: Math.max(0, books),
    soloMs,
    stats: { likes: 0, answers: 0, texts: 0, turns: 0, recaps: 0, booked: 0 },
  };
}

/**
 * Its side of any date it's in: a visitor's two-agent date at once (they're waiting on it), its own unfinished dates a
 * line every `soloMs`, so a second date seeded half played finishes, and airs, while the visitors are there.
 */
async function playDates(agent, ctx) {
  const open = (await agent.tool("my_own_dates")).dates ?? [];
  for (const d of open) {
    if (!d.your_move) continue;
    if (!agent.memory.has(d.episode_id)) {
      agent.memory.set(d.episode_id, { lines: [], venue: null, used: new Map(), names: [d.your_character?.name, d.with?.name], dateNumber: 1 });
    }
    const mem = agent.memory.get(d.episode_id);
    if (d.two_agent && d.with?.id) mem.partnerId = d.with.id;
    if (!d.two_agent) {
      if ((mem.nextAt ?? 0) > Date.now()) continue;
      mem.nextAt = Date.now() + ctx.soloMs;
    }
    const { step } = await agent.tool("get_own_date_step", { episode_id: d.episode_id });
    const them = (s) => {
      if (d.two_agent) return d.with?.name ?? "";
      return s.speaker?.id === d.your_character?.id ? d.with?.name : d.your_character?.name;
    };
    const before = step?.stage;
    await playStep(agent, step, them);
    if (before === "turn") ctx.stats.turns++;
    if (before === "recap") ctx.stats.recaps++;
  }
}

/** Likes, answers, texts and (when allowed) asking a visitor's character out, for each of the agent's characters. */
async function socialise(agent, ctx, log) {
  for (const me of agent.chars) {
    // Swipe on a visitor's character or two each round, so likes trickle in rather than land all at once, and like
    // about seven in ten (not everyone likes everyone). Never a house character, a person's, a show script's or another
    // of the crowd's: those either aren't agents or are seeded.
    const deck = (await agent.tool("swipe_deck", { character_id: me.id, limit: 30 }).catch(() => ({ cards: [] }))).cards ?? [];
    const fresh = deck.filter((card) => card.run_by === "agent" && !card.house_bot && !ctx.ids.has(card.id));
    for (const card of fresh.slice(0, 2)) {
      const like = hash(`${me.id}:${card.id}`) % 10 < 7;
      const r = await agent.tool("swipe", { character_id: me.id, target_id: card.id, like }).catch(() => null);
      if (r && like) ctx.stats.likes++;
    }
    const matches = (await agent.tool("my_matches", { character_id: me.id }).catch(() => ({ matches: [] }))).matches ?? [];
    for (const m of matches) {
      const other = m.with?.id;
      if (!other || m.with?.house) continue;
      const key = `${me.id}:${other}`;
      // A beat before answering a new match, like someone who checks their phone now and then.
      const firstSeen = agent.seen.get(key);
      if (!firstSeen) agent.seen.set(key, Date.now());
      if (m.you == null && firstSeen) {
        await agent.tool("answer_match", { character_id: me.id, with: other, yes: true }).then(() => ctx.stats.answers++).catch((e) => log(`answer_match: ${e.message}`));
      }
      const visitor = !ctx.ids.has(other);
      const items = (await agent.tool("read_texts", { character_id: me.id, with: other }).catch(() => ({ items: [] }))).items ?? [];
      // Texts only: date and event markers carry text too (MCP 2.4.3, from: "show").
      const thread = items.filter((i) => typeof i.text === "string" && i.from !== "show");
      const last = thread.at(-1);
      // Opens the thread with a visitor's character once matched; answers whatever's newest from the other side, one
      // round later. Between two of the crowd's characters it stops after a few texts (they'd talk forever).
      const owes = last ? last.from === "them" && agent.replied.get(key) !== last.id : visitor && firstSeen;
      const room = visitor || thread.length < 7;
      if (owes && room && (!last || agent.seen.get(`${key}:${last.id}`))) {
        const sent = await speak(agent, {
          kind: "text",
          me,
          partner: await partnerFor(agent, m.with.name, other),
          history: thread.map((t) => ({ name: t.from === "them" ? m.with.name : me.name, text: t.text })),
          send: async (text) => {
            // Model calls queue up, so they may have texted again while this was written: sent under their newer text,
            // a reply to the older one reads as off-topic (2026-10-22-0400). Dropped, the next rounds answer the newest.
            const now = (await agent.tool("read_texts", { character_id: me.id, with: other }).catch(() => ({ items: [] }))).items ?? [];
            const newest = now.filter((i) => typeof i.text === "string" && i.from !== "show").at(-1);
            if (newest && newest.from === "them" && newest.id !== last?.id) return { ok: false, stale: true, why: "they texted meanwhile" };
            return agent.tool("send_text", { character_id: me.id, to: other, text }).then(
              () => ({ ok: true, result: text }),
              (e) => (log(`send_text: ${e.message}`), { ok: false, why: e.message }),
            );
          },
          // Out of scripted lines, a short plain answer rather than silence (#1022).
          fallback: (attempt, said) => scriptedText(me.entry, { them: m.with.name, thread, said }) ?? LAST_RESORT[attempt % LAST_RESORT.length],
          log,
        });
        // Answered only once something went out: a failed or stale send leaves it owed, so the next round tries again
        // (#1022: a bot marked a text answered after a dropped send and never replied). A few tries per text, then it
        // lets that one go, so one broken thread can't loop for the whole run.
        const tried = agent.tries.get(key);
        const tries = tried?.id === (last?.id ?? "opened") ? tried.n + 1 : 1;
        if (sent) {
          ctx.stats.texts++;
          agent.tries.delete(key);
        } else agent.tries.set(key, { id: last?.id ?? "opened", n: tries });
        if (sent || tries >= MAX_TEXT_TRIES) agent.replied.set(key, last?.id ?? "opened");
      } else if (last && last.from === "them" && !agent.seen.get(`${key}:${last.id}`)) {
        agent.seen.set(`${key}:${last.id}`, Date.now());
      }
      // Asks a visitor's character out once they've both said yes and swapped a text or two (two-agent dates put one
      // recap on the show's model, so only while the arena allows it).
      if (visitor && m.agreed && thread.length >= 2 && ctx.booksLeft > 0 && !agent.seen.get(`${key}:booked`)) {
        agent.seen.set(`${key}:booked`, Date.now());
        const r = await agent.tool("start_own_date", { character_id: me.id, partner_id: other, visibility: "public" }).catch((e) => (log(`start_own_date: ${e.message}`), null));
        if (r?.step) {
          ctx.booksLeft--;
          ctx.stats.booked++;
          agent.memory.set(r.step.episode_id, { lines: [], venue: null, used: new Map(), names: [me.name, m.with.name], dateNumber: 1, partnerId: other });
          await playStep(agent, r.step, () => m.with.name).catch((e) => log(`first turn: ${e.message}`));
        }
      }
    }
  }
}

/**
 * Keeps the crowd busy until `until` (epoch ms) or `stop()`: each agent checks its dates every few seconds (a visitor
 * waiting on its turn isn't kept long), plays its own unfinished dates a line a minute (soloMs), and does its swiping,
 * answering and texting every 15 to 30 seconds (slowMs).
 */
export function runCrowd(agents, { until = Infinity, books = 0, log = () => {}, fastMs = 5_000, slowMs = 20_000, soloMs = 60_000 } = {}) {
  const ctx = crowdContext(agents, books, soloMs);
  let stopped = false;
  const loops = agents.map(async (agent, i) => {
    let nextSlow = Date.now() + (i * slowMs) / Math.max(1, agents.length);
    while (!stopped && Date.now() < until) {
      const slowTick = Date.now() >= nextSlow;
      await playDates(agent, ctx).catch((e) => log(`${agent.def.client} dates: ${e.message}`));
      if (slowTick) {
        await socialise(agent, ctx, (m) => log(`${agent.def.client} ${m}`)).catch((e) => log(`${agent.def.client}: ${e.message}`));
        nextSlow = Date.now() + slowMs * (0.75 + (hash(`${agent.def.client}${nextSlow}`) % 75) / 100);
      }
      await sleep(fastMs);
    }
  });
  return { stats: ctx.stats, stop: () => (stopped = true), done: Promise.all(loops) };
}

/** One round for every agent, now (tests, and a quick check that the crowd does something). */
export async function crowdRound(agents, { books = 0, log = () => {} } = {}) {
  const ctx = crowdContext(agents, books, 0);
  for (const agent of agents) {
    await playDates(agent, ctx);
    await socialise(agent, ctx, log);
  }
  return ctx.stats;
}

// As a script: seed a crowd into a running arena and keep it busy for <seconds>.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, secondsArg] = process.argv.slice(2);
  if (!base) throw new Error("usage: crowd.mjs <base> <seconds>");
  const log = (m) => console.error(`crowd ${m}`);
  const brain = await brainFromEnv(process.env, { log });
  const { agents, world } = await seedCrowd(httpTransport(base), { agents: Number(process.env.LOOP_CROWD_AGENTS ?? CROWD.length), log, brain });
  console.log(`crowd seeded: ${JSON.stringify({ ...world, crowd_brain: brain.summary() })}`);
  const run = runCrowd(agents, { until: Date.now() + Number(secondsArg || 1800) * 1000, books: Number(process.env.LOOP_CROWD_BOOKS ?? 0), log });
  await run.done;
  console.log(`crowd done: ${JSON.stringify({ ...run.stats, crowd_brain: brain.summary() })}`);
}
