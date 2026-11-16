/**
 * OC questions (app/tools/oc-questions): questions to ask an original character, by theme, plus one picked at random.
 *
 * Fixed content, no model and no database. Each question has a stable id (its theme and number), so "a question at
 * random" is an address anyone can share, and every question has an anchor on the page. The love-life theme is the
 * one Botchelor's dates answer by themselves; the page says so.
 */

export const OC_QUESTIONS_PATH = "/tools/oc-questions";

export type OcQuestionTheme = { id: string; title: string; blurb: string; questions: readonly string[] };

export const OC_QUESTION_THEMES: readonly OcQuestionTheme[] = [
  {
    id: "basics",
    title: "The basics",
    blurb: "The things anyone would learn in the first ten minutes.",
    questions: [
      "What name do they go by, and who still calls them by their full name?",
      "How old are they, and how old do they feel?",
      "What do they do all day, and what do they tell people they do?",
      "Where do they live, and what does it look like at eleven at night?",
      "What's the first thing people notice about them?",
      "What do they always have on them?",
      "How do they take their coffee or tea, or what do they drink instead?",
      "What does their voice sound like when they're tired?",
      "Morning person or night person, and who made them that way?",
      "What would they grab first if the building were on fire?",
      "What do they spend too much money on?",
      "What's on their phone's lock screen?",
    ],
  },
  {
    id: "past",
    title: "Their past",
    blurb: "Where they came from, and what they don't say about it.",
    questions: [
      "What's their earliest memory, and is it true?",
      "Who raised them, and what did that person get wrong?",
      "What did they want to be when they were small?",
      "What's the worst thing that happened to them that they now tell as a funny story?",
      "Who was their first best friend, and what happened to them?",
      "What did they leave behind when they left home?",
      "What's a smell that takes them straight back somewhere?",
      "What's the one decision they'd undo?",
      "What did they lose that they still look for?",
      "Who do they owe something to?",
      "What rumour about them is half true?",
      "When did they last cry, and who saw?",
    ],
  },
  {
    id: "personality",
    title: "Personality and quirks",
    blurb: "How they move through a room, and the small things that give them away.",
    questions: [
      "What makes them laugh when they shouldn't?",
      "What's a small rule they follow that nobody asked them to?",
      "What do they do with their hands when they're nervous?",
      "What do they lie about most often?",
      "What do they think their best quality is, and what do their friends say it is?",
      "How do they act when they're wrong?",
      "What do they collect, on purpose or by accident?",
      "What's a word they use too much?",
      "What would they do with a free Tuesday?",
      "What do they hate that everyone else seems to love?",
      "Are they the one who plans the trip or the one who gets lost?",
      "What's their tell when they're lying?",
      "What do they hum without noticing?",
    ],
  },
  {
    id: "love",
    title: "Love life and dating",
    blurb: "The questions a first date asks. Botchelor's dates answer these ones for you.",
    questions: [
      "What's their idea of a perfect first date, and what would they actually enjoy?",
      "What's their type, and who was the exception?",
      "What's their dealbreaker?",
      "How do they flirt, and do they know they're doing it?",
      "What did their last relationship teach them?",
      "Do they text first?",
      "What would make them leave a date early?",
      "What do they want from love that they'd never say out loud?",
      "Who do they talk to after a good date? After a bad one?",
      "What would they cook, or order, for someone they liked?",
      "What's the most romantic thing anyone has done for them?",
      "How do they say sorry?",
      "Are they the one who falls first?",
      "What would a second date with them look like?",
    ],
  },
  {
    id: "relationships",
    title: "Friends, family and rivals",
    blurb: "The people around them, and what they'd do for each one.",
    questions: [
      "Who would they call at three in the morning?",
      "Who's their rival, and do they secretly like them?",
      "Which friend do they envy a little?",
      "What do their parents think they do?",
      "Who are they trying to impress?",
      "Who knows their real name, password or secret?",
      "What do people say about them when they leave the room?",
      "Who would they lie for?",
      "Who have they never forgiven?",
      "What do they do for the people they love that nobody notices?",
      "Who would they want at their birthday, and who would actually come?",
    ],
  },
  {
    id: "deep",
    title: "The deep end",
    blurb: "Fears, wants and the stuff a story is really about.",
    questions: [
      "What are they most afraid of, and what are they afraid people will find out?",
      "What do they want more than anything, and what are they doing to get it?",
      "What would they never do, and what would make them do it?",
      "What do they believe that most people don't?",
      "What would they change about themselves?",
      "What does a good day look like for them, ten years from now?",
      "What do they think happens after we die?",
      "What would make them walk away from everything?",
      "What do they need that's different from what they want?",
      "What's the kindest thing they've ever done, and did anyone know?",
      "What would they tell their younger self?",
      "What do they think love is?",
    ],
  },
  {
    id: "fun",
    title: "Just for fun",
    blurb: "Quick ones for a warm-up, an ask-the-OC post or a writing prompt.",
    questions: [
      "What's their go-to karaoke song?",
      "What would their dating profile's first line be?",
      "Which season are they?",
      "What would they be famous for?",
      "What's their comfort film, book or show?",
      "What's their most useless talent?",
      "What would their last meal be?",
      "If they had a shop, what would it sell?",
      "What animal would they be, and do they agree?",
      "What would they do with a million?",
      "What's in their fridge right now?",
      "How would they spend the first hour of a zombie outbreak?",
    ],
  },
];

/** One question with its stable id ("love-3") and its theme. */
export type OcQuestion = { id: string; text: string; theme: OcQuestionTheme };

export const OC_QUESTIONS: readonly OcQuestion[] = OC_QUESTION_THEMES.flatMap((theme) =>
  theme.questions.map((text, i) => ({ id: `${theme.id}-${i + 1}`, text, theme })),
);

/** A question from an address's ?q=, or null. */
export function readQuestion(raw: unknown): OcQuestion | null {
  return typeof raw === "string" ? (OC_QUESTIONS.find((q) => q.id === raw) ?? null) : null;
}

/** The next "ask me another" question after this one: steps by a prime so it hops between themes, and never repeats itself. */
export function nextQuestion(current: OcQuestion | null): OcQuestion {
  const i = current ? OC_QUESTIONS.indexOf(current) : -1;
  return OC_QUESTIONS[(i + 37) % OC_QUESTIONS.length];
}

export const ocQuestionHref = (q: OcQuestion) => `${OC_QUESTIONS_PATH}?q=${q.id}#ask`;
