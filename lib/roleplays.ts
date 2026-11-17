/**
 * Roleplays on the show's dates (David, 2026-10-31: "extend the role play to safe for work dates, allow users to agree on
 * roleplay"). After Dark has had them per chapter since #878 (lib/adult/roleplays.ts); these are the show's own, PG:
 * who the two of them are to each other for one date (rival spies, a time traveller and the local who meets them, a
 * second first date…), played in their own voices over wherever the date is.
 *
 * A roleplay is framing, like a format (lib/formats.ts): it changes how the date plays out, never how it ends. The
 * engine decides the ending at booking, as it always has, so predictions stay fair.
 *
 * Who agrees (lib/date-roleplays.ts): one owner proposes and the other agrees; the show's own side (a house character, a
 * house-run bot) and a booker's own two characters agree at once; agents deliberate over MCP (propose_roleplay,
 * answer_roleplay). What the two agreed to is snapshotted on the date (DateSetup.roleplay), so a rebuild plays the same.
 *
 * Every one of the show's has a scene card (lib/scene-cards.ts, David 2026-11-17): the context behind it that goes into
 * the prompts when it's picked (how it starts, what each of them wants, where it can go, its tone, how it opens). A
 * roleplay someone writes has none.
 *
 * Pure and client-safe: the picker and the server share it.
 */
import { checkShowText, excludedTheme } from "./safety";
import type { SceneCard } from "./scene-cards";

export type RoleplayTag = "strangers" | "mystery" | "adventure" | "scifi" | "fantasy" | "period" | "funny" | "romance" | "cozy" | "couples";

export const ROLEPLAY_TAGS: readonly { id: RoleplayTag; label: string; icon: string }[] = [
  { id: "strangers", label: "Strangers", icon: "🎭" },
  { id: "mystery", label: "Mystery", icon: "🕵️" },
  { id: "adventure", label: "Adventure", icon: "🧭" },
  { id: "scifi", label: "Sci-fi", icon: "🚀" },
  { id: "fantasy", label: "Fantasy", icon: "🐉" },
  { id: "period", label: "Period", icon: "🕯️" },
  { id: "funny", label: "Funny", icon: "😄" },
  { id: "romance", label: "Slow burn", icon: "💞" },
  { id: "cozy", label: "Cozy", icon: "☕" },
  { id: "couples", label: "For couples", icon: "🔁" },
];

export type DateRoleplayDef = {
  id: string;
  title: string;
  icon: string;
  tag: RoleplayTag;
  /** The situation, with {a} and {b} for whoever plays each role (or the two of them, when there are no roles). */
  premise: string;
  /** The two roles, the first for {a}; null when they're the same to each other (rival spies, castaways). */
  roles: readonly [string, string] | null;
  /** The context behind it (lib/scene-cards.ts), which goes into the prompts when it's picked. */
  card: SceneCard;
};

/**
 * The show's roleplays. Every one is two adults on a date and stays PG (tests/date-roleplays.test.ts runs each through
 * the show's check and the never-list below, and tests/scene-cards.test.ts every word of its card): no family, no school,
 * nobody with a say over the other's job, no real people. A card's {a} and {b} are written so they read right from
 * either side as "you" (premiseForYou): the name straight before its verb, no "he" or "she", and after a comma no
 * second verb that leans on it.
 */
export const DATE_ROLEPLAYS: readonly DateRoleplayDef[] = [
  {
    id: "night-train", title: "Strangers on a night train", icon: "🚆", tag: "strangers", roles: null,
    premise: "{a} and {b} are strangers sharing a table on an overnight train. At the last stop they'll go their separate ways, so tonight they can be completely honest, or completely invented.",
    card: {
      setup: "The dining car is nearly empty and the only free seat is across from {b}. {a} sits down with a paper cup of tea as the train pulls out.",
      wants: [
        "{a} wants one evening of saying true things to someone who can't repeat them; the habit of making life sound tidier is in the way.",
        "{b} wants to find out whether a better version of the story can be invented on the spot; {a}'s questions keep being too good.",
      ],
      beats: [
        "They trade names that may not be real and agree on the rule: nothing said tonight leaves the train.",
        "One story sounds too polished, and the other calls it.",
        "Something true slips out by accident, and it changes what the inventing was for.",
        "The last stop is announced, and there is still one question neither has asked.",
      ],
      tone: "late-night honest, a little wry, the rhythm of the rails under everything",
      openings: [
        "{a} asks whether the seat is taken, and {b} says it depends on who's asking.",
        "{b} slides the sugar across before {a} has asked for it.",
        "{a} and {b} reach for the same window blind at the same moment and stop.",
      ],
    },
  },
  {
    id: "masquerade", title: "The masquerade", icon: "🎭", tag: "strangers", roles: null,
    premise: "{a} and {b} meet at a masked ball where nobody gives their real name. They make up who they are for the night, and each tries to guess the truth behind the other's mask.",
    card: {
      setup: "The ballroom is all candlelight and borrowed names. {a} and {b} meet at the edge of the dance floor, both in masks, both a little too pleased with the disguise.",
      wants: [
        "{a} wants to be someone bolder for one night; the mask keeps slipping whenever {b} asks a real question.",
        "{b} wants to guess who is behind the other mask before the unmasking; {a}'s invented story is annoyingly good.",
      ],
      beats: [
        "Each gives a name and a life that are obviously made up, and the other plays along.",
        "A guess lands close to the truth, and the one it fits changes the subject badly.",
        "They set terms: a few questions each, and one honest answer owed.",
        "The orchestra announces the unmasking, and one of them asks for one more dance first.",
      ],
      tone: "playful, theatrical, a guessing game with real curiosity under it",
      openings: [
        "{a} bows too deeply and introduces a title that cannot possibly exist.",
        "{b} compliments {a}'s mask and asks who it's hiding.",
        "{a} and {b} are the only two not dancing, and both pretend that was a choice.",
      ],
    },
  },
  {
    id: "fortune-teller", title: "The fortune teller", icon: "🃏", tag: "strangers", roles: ["the fortune teller", "the sceptic who sat down for a reading"],
    premise: "{a} reads fortunes at a night fair; {b} sat down for a reading as a joke. {a}'s predictions get oddly specific about {b}'s love life, and {b} keeps asking for one more.",
    card: {
      setup: "{a}'s booth is a folding table, a deck of worn cards and a lamp with a scarf over it. {b} sits down on a dare from nobody, arms crossed.",
      wants: [
        "{a} wants to keep {b} at the table, because this is the first interesting reading all night; the cards keep saying more than {a} meant to.",
        "{b} wants to prove it's all guesswork without having to leave; every guess is a little too accurate.",
      ],
      beats: [
        "The first card is vague on purpose, and the sceptic says so.",
        "A prediction gets oddly specific, and the sceptic asks how that could be known.",
        "The sceptic offers to read the fortune teller's cards instead.",
        "The lamp flickers on the last card, and neither of them is sure who is being read.",
      ],
      tone: "teasing, a little uncanny, a sceptic's grin against a straight face",
      openings: [
        "{a} turns over the first card before {b} has finished sitting down.",
        "{b} asks how much of this is a trick, and {a} says about half.",
        "{a} looks at {b}'s hands instead of the cards and says the reading already started.",
      ],
    },
  },
  {
    id: "rival-spies", title: "Rival spies", icon: "🕵️", tag: "mystery", roles: null,
    premise: "{a} and {b} are spies from rival agencies, sent after the same secret file. Tonight they call a truce over dinner, trade cover stories and try to find out what the other one knows.",
    card: {
      setup: "A corner table, two menus, one truce until dessert. {a} and {b} both know the other is after the same file, and both arrived early to get the seat facing the door.",
      wants: [
        "{a} wants to learn where the file is without giving up a single true detail; {b} is better company than a rival should be.",
        "{b} wants to find out how much {a} knows by now; the cover story is getting harder to keep straight while laughing.",
      ],
      beats: [
        "They trade cover stories, each with one deliberate hole in it.",
        "One of them slips a real detail in to see whether the other catches it.",
        "A waiter lingers too long, and for a minute they are on the same side.",
        "Someone proposes sharing the file, and neither can tell whether that is the truce talking.",
      ],
      tone: "dry, quick, a chess game played with compliments",
      openings: [
        "{a} is already seated with a view of the door when {b} takes the chair that blocks it.",
        "{b} orders for two, to prove the homework was done.",
        "{a} and {b} each put a phone face down on the table at the same time, like a handshake.",
      ],
    },
  },
  {
    id: "two-detectives", title: "Two detectives, one case", icon: "🔍", tag: "mystery", roles: null,
    premise: "{a} and {b} are private detectives hired by different clients to find the same missing painting. They pool their clues tonight, each sure they're one step ahead.",
    card: {
      setup: "Two notebooks on one table and a photograph of a missing painting in the middle. {a} and {b} were hired by different clients, and each thinks tonight is a favour to the other.",
      wants: [
        "{a} wants the one clue {b} is holding back; pride makes asking for it impossible.",
        "{b} wants to be the one who cracks it, out loud, in front of {a}; half the answer is in {a}'s notebook.",
      ],
      beats: [
        "They lay out their clues one at a time, like a card game neither wants to lose.",
        "Two clues fit together, and they have to admit it.",
        "A theory falls apart, and the one who proposed it takes it badly.",
        "The trail points somewhere that needs both of them to follow it.",
      ],
      tone: "competitive, clever, grudging respect turning warm",
      openings: [
        "{a} slides a photograph across the table and says nothing.",
        "{b} opens with a theory and watches {a}'s face for the flinch.",
        "{a} and {b} both claim to be one step ahead, in the same breath.",
      ],
    },
  },
  {
    id: "undercover-couple", title: "The undercover couple", icon: "🥂", tag: "mystery", roles: null,
    premise: "{a} and {b} are agents posing as a couple to blend in at a glamorous gala. They have to look convincingly smitten while they watch the room, and get their cover story straight.",
    card: {
      setup: "The gala is in full swing and the target is somewhere near the champagne. {a} and {b} arrive arm in arm, with a cover story that was finished in the taxi.",
      wants: [
        "{a} wants the cover to be flawless; {b} keeps improvising details that are suspiciously sweet.",
        "{b} wants to watch the room and not {a}; the job requires looking smitten, which is the problem.",
      ],
      beats: [
        "Someone asks how they met, and the two answers do not quite match.",
        "They have to dance to cross the room, and the cover story gets a new chapter.",
        "One of them says something sweet that was not in the script.",
        "The target moves, and they must decide whether to follow or stay convincing.",
      ],
      tone: "glamorous, quick-witted, pretending that keeps threatening to be true",
      openings: [
        "{a} straightens {b}'s collar and whispers the cover story one more time.",
        "{b} takes two glasses from a tray and hands {a} the wrong one on purpose.",
        "{a} and {b} are announced at the door as a couple, and both smile half a second late.",
      ],
    },
  },
  {
    id: "ghost-hunters", title: "Ghost hunters", icon: "👻", tag: "mystery", roles: ["the believer", "the sceptic"],
    premise: "{a} and {b} are amateur ghost hunters spending the evening somewhere that's supposedly haunted. {a} believes every word of the legend, {b} believes none of it, and every creak is evidence.",
    card: {
      setup: "The house is supposed to be haunted and the torch is supposed to have new batteries. {a} sets up a recorder in the hall while {b} checks the windows for draughts.",
      wants: [
        "{a} wants one piece of proof that {b} can't explain away; every creak so far has had a boring answer.",
        "{b} wants a quiet night of being right; the house keeps doing things that are hard to laugh off.",
      ],
      beats: [
        "A noise upstairs, and they disagree about who goes first.",
        "The sceptic explains one thing too many and runs out of explanations.",
        "The believer admits why the legend matters so much.",
        "The torch goes out, and they have to find the door by talking.",
      ],
      tone: "spooky-fun, bickering, never gory",
      openings: [
        "{a} shushes {b} in the doorway and points at nothing.",
        "{b} reads the legend aloud from a leaflet in a flat voice while {a} mouths the words.",
        "{a} and {b} hear the same floorboard at the same time and look at each other.",
      ],
    },
  },
  {
    id: "treasure-map", title: "Half a treasure map", icon: "🏴‍☠️", tag: "adventure", roles: null,
    premise: "{a} and {b} are rival pirate captains who each hold half of the same treasure map. Neither can find it alone, so tonight they negotiate a partnership, and neither fully trusts the other.",
    card: {
      setup: "Two halves of one map lie on a barrel, torn edge to torn edge. {a} and {b} each brought a half, and neither has let go of a corner yet.",
      wants: [
        "{a} wants the treasure and a partner who won't sail off with it; {b} has a reputation for exactly that.",
        "{b} wants to know what {a}'s half shows before agreeing to anything; the two halves only make sense together.",
      ],
      beats: [
        "They haggle over the split before they have even seen the whole map.",
        "The halves line up, and the mark is somewhere neither expected.",
        "One admits to having sailed there before and come back with nothing.",
        "They need a crew of two, and someone has to take the first watch.",
      ],
      tone: "swashbuckling, sly, a negotiation that keeps turning into banter",
      openings: [
        "{a} lays half a map on the barrel and keeps one hand on it.",
        "{b} laughs at the share {a} had in mind.",
        "{a} and {b} each put half a map down at the same moment, and neither lets go.",
      ],
    },
  },
  {
    id: "rival-explorers", title: "Rival explorers", icon: "🧭", tag: "adventure", roles: null,
    premise: "{a} and {b} are rival explorers who reached the same lost temple on the same day. They're stuck sharing a camp tonight, comparing notes and arguing over who found it first.",
    card: {
      setup: "One campfire, two tents and a lost temple that was found twice this afternoon. {a} and {b} are sharing the only dry ground for miles.",
      wants: [
        "{a} wants it on record that the temple was found from the east side first; {b} has a sketch with a time written on it.",
        "{b} wants a look at {a}'s notes on the inner chamber; asking would mean admitting there are gaps.",
      ],
      beats: [
        "They argue about who arrived first, with evidence.",
        "One of them shares food, and the argument loses some heat.",
        "Their two maps disagree about a door, and only one of them can be right.",
        "A plan for tomorrow takes shape that would need two people.",
      ],
      tone: "prickly, adventurous, rivalry that keeps collapsing into curiosity",
      openings: [
        "{a} is drying a notebook by the fire when {b} walks up with the last of the coffee.",
        "{b} draws a line in the dirt down the middle of the camp, and {a} steps over it to borrow the kettle.",
        "{a} and {b} each unroll a map at the same time, angled so the other can't quite see.",
      ],
    },
  },
  {
    id: "castaways", title: "Castaways", icon: "🏝️", tag: "adventure", roles: null,
    premise: "{a} and {b} have washed up on the same tiny island. Tonight they plan their rescue, split the last of the supplies and find out what each of them would miss most.",
    card: {
      setup: "The tide left {a} and {b} on the same small island with one crate, one tarp and a lighter that works sometimes. The sun is going down.",
      wants: [
        "{a} wants a signal fire built before dark; {b} has other ideas about what the tarp is for.",
        "{b} wants to make the island liveable first and rescued second; {a}'s plan uses up all the dry wood.",
      ],
      beats: [
        "They take stock of the crate, and the contents are not what either hoped.",
        "A disagreement about the fire turns into dividing the island in two.",
        "One of them says what would be missed most back home, and it is not what the other guessed.",
        "A light shows on the horizon, and they have to agree quickly on what to do about it.",
      ],
      tone: "sun-baked, resourceful, bickering that turns into teamwork",
      openings: [
        "{a} is spelling HELP in driftwood when {b} points out the tide is coming in.",
        "{b} opens the crate with a rock and holds up the first thing in it.",
        "{a} and {b} both claim the one palm tree with any shade.",
      ],
    },
  },
  {
    id: "time-traveller", title: "The time traveller", icon: "⏳", tag: "scifi", roles: ["the time traveller", "the local"],
    premise: "{a} has just arrived from two centuries in the future, and {b} is the first person they've met. {b} explains everything about tonight; {a} has strong opinions about how it all turns out.",
    card: {
      setup: "{a} stepped out of a shimmer in the air a few minutes ago, wearing a coat that hasn't been invented. {b} is the first person who didn't walk away.",
      wants: [
        "{a} wants to see an ordinary evening without changing how anything goes; knowing the future makes small talk very difficult.",
        "{b} wants to know one thing about the future, any one thing; {a} keeps answering with a wince.",
      ],
      beats: [
        "The local explains something everyday, and the traveller is far too impressed by it.",
        "The traveller lets a detail about the future slip and tries to take it back.",
        "The local asks the one question the traveller is not supposed to answer.",
        "A watch starts to chime, and the traveller has to decide what to say before it stops.",
      ],
      tone: "wonder-struck, funny, a little wistful about time",
      openings: [
        "{a} asks {b} what year it is and looks relieved at the answer.",
        "{b} offers {a} a coffee, and {a} holds the cup like a museum piece.",
        "{a} is staring at a street lamp when {b} asks whether everything is all right.",
      ],
    },
  },
  {
    id: "first-contact", title: "First contact", icon: "🛸", tag: "scifi", roles: ["the visitor from another planet", "the human host"],
    premise: "{a} is a visitor from another planet on their first evening on Earth, and {b} volunteered to show them what a date is. Everything ordinary is fascinating, and nothing translates quite right.",
    card: {
      setup: "{a} landed this morning and has read every guidebook on Earth dating, none of which agree. {b} volunteered to demonstrate and is starting to regret the word volunteer.",
      wants: [
        "{a} wants to do a date correctly and take notes; the customs make no sense and {b} keeps laughing.",
        "{b} wants {a} to have a good first evening on Earth; explaining small talk turns out to be impossible.",
      ],
      beats: [
        "The visitor takes an everyday custom far too literally.",
        "The host tries to explain why people do it, and realises there is no good reason.",
        "The visitor describes how it is done back home, and it is strangely lovely.",
        "A translation goes wrong in a way that says something true.",
      ],
      tone: "sweet, absurd, wide-eyed wonder about small things",
      openings: [
        "{a} greets {b} with a formal bow, a handshake and a wave, in case one of them is right.",
        "{b} pulls out a chair, and {a} asks what it is for.",
        "{a} holds up a menu and asks {b} which of these is a hobby.",
      ],
    },
  },
  {
    id: "stowaway", title: "Captain and stowaway", icon: "🚀", tag: "scifi", roles: ["the captain", "the stowaway"],
    premise: "{a} captains a small cargo starship; {b} is the stowaway just found hiding in the hold. They have until the next port for {b} to talk {a} into letting them stay aboard.",
    card: {
      setup: "The cargo hold smells of engine oil and oranges. {a} has just found {b} behind the crates, with a blanket, a paperback and a very prepared speech.",
      wants: [
        "{a} wants a reason to keep {b} aboard that would survive the port inspection; the ship does run better with two.",
        "{b} wants to stay without having to say why the last planet had to be left; {a} asks direct questions.",
      ],
      beats: [
        "The stowaway offers to work for passage and lists skills, some of them real.",
        "Something on the ship breaks, and the stowaway fixes it faster than the captain could.",
        "The captain asks what the stowaway is running from and gets half an answer.",
        "The next port shows up on the scanner, and the decision is still open.",
      ],
      tone: "scrappy, warm, a negotiation in a small ship",
      openings: [
        "{a} lifts the tarp, and {b} waves.",
        "{b} starts the speech from the top, and {a} holds up a hand at the second sentence.",
        "{a} sits down on a crate across from {b} and asks how long the oranges have had company.",
      ],
    },
  },
  {
    id: "royal-incognito", title: "The royal in disguise", icon: "👑", tag: "fantasy", roles: ["the royal sneaking out for the night", "the local who shows them around"],
    premise: "{a} is royalty from a small storybook kingdom, sneaking out of the palace in disguise for one ordinary evening. {b} has no idea and shows {a} a regular night out, while {a} tries not to give the game away.",
    card: {
      setup: "{a} climbed over the palace wall an hour ago in a borrowed coat that doesn't fit. {b} found {a} at a street stall, trying to work out how coins are used.",
      wants: [
        "{a} wants one evening of being nobody in particular; ordinary things keep being astonishing out loud.",
        "{b} wants to show a stranger a good night in the city; {a}'s questions are odd enough to be suspicious.",
      ],
      beats: [
        "The local introduces something ordinary, and the royal's delight gives a little away.",
        "A slip of etiquette nearly blows the disguise, and the royal talks fast.",
        "The local says what people here really think of the palace.",
        "A bell rings from the hill, and the royal is counting how long is left.",
      ],
      tone: "light, fairy-tale, fish out of water with a secret",
      openings: [
        "{a} is holding a coin up to the light when {b} asks whether it is a first visit to the market.",
        "{b} offers to show {a} around, and {a} accepts a little too formally.",
        "{a} bows to a street musician, and {b} laughs before realising it was sincere.",
      ],
    },
  },
  {
    id: "rival-wizards", title: "Rival wizards", icon: "🔮", tag: "fantasy", roles: null,
    premise: "{a} and {b} are rival wizards who keep turning up at the same enchanted market for the same rare ingredients. Tonight they share a table, a grudging respect and maybe a harmless spell or two.",
    card: {
      setup: "The enchanted market closes at moonrise and there is exactly one jar of starlight salt left. {a} and {b} both have a hand on it.",
      wants: [
        "{a} wants the jar and an apology for last season's weather spell; {b} would rather discuss it over something that smokes gently.",
        "{b} wants to know what {a} is brewing that needs the same ingredient; professional curiosity is winning over the grudge.",
      ],
      beats: [
        "They agree to share a table until the stallholder decides who gets the jar.",
        "A harmless spell is cast to make a point, and it goes a little sideways.",
        "One admits the other's last spell was actually rather good.",
        "The stallholder offers the jar to whoever can name what the other is making.",
      ],
      tone: "whimsical, sparky, old rivals with grudging respect",
      openings: [
        "{a} and {b} reach the last jar at the same moment, and neither lets go.",
        "{b} turns {a}'s tea a polite shade of blue by way of hello.",
        "{a} asks whether {b} is still sore about the weather.",
      ],
    },
  },
  {
    id: "knight-dragon", title: "The knight and the dragon", icon: "🐉", tag: "fantasy", roles: ["the knight", "the dragon, in human form for the evening"],
    premise: "{a} is a knight sent to defeat a dragon; {b} is that dragon, in human form for the evening. {b} would rather talk it out over dinner, and {a} is starting to agree.",
    card: {
      setup: "{a} arrived at the cave with a sword and a speech. {b} answered the door in human form and asked whether this could be done over dinner.",
      wants: [
        "{a} wants to go home having done the right thing; nobody mentioned the dragon would be good company.",
        "{b} wants to be listened to before anyone draws anything; knights have not, historically, stayed for the second course.",
      ],
      beats: [
        "The knight recites the charges, and the dragon has a reasonable answer to most of them.",
        "The dragon shows the hoard, and it is not what the stories said.",
        "The knight admits who really sent the quest and why.",
        "They start drafting what the knight could tell the kingdom instead.",
      ],
      tone: "storybook, wry, an adversary who would rather talk",
      openings: [
        "{a} starts on the formal challenge, and {b} asks whether there are any allergies.",
        "{b} takes {a}'s cloak at the door and hangs it next to a very large one.",
        "{a} is still holding the sword when {b} pulls out a chair.",
      ],
    },
  },
  {
    id: "vampire-dinner", title: "Dinner with a vampire", icon: "🦇", tag: "fantasy", roles: ["the vampire host", "the curious guest"],
    premise: "{a} is a polite, centuries-old vampire who has invited {b} to dinner and isn't eating any of it. {b} came out of curiosity and has a great many questions about the last four centuries.",
    card: {
      setup: "The table is set for two and only one plate has food on it. {a} pours a single glass of wine and slides it across to {b}, who came with a list of questions.",
      wants: [
        "{a} wants an evening of conversation with someone who isn't afraid; four hundred years have made the anecdotes hard to shorten.",
        "{b} wants to know what the centuries were really like; {a} answers every question with a better one.",
      ],
      beats: [
        "The guest asks the obvious question first, and the host is graceful about it.",
        "A story from long ago runs long, and something sad shows at the edge of it.",
        "The guest notices what the host has not touched, and makes a joke of it.",
        "The clock strikes late, and the host asks a question about the present for once.",
      ],
      tone: "elegant, dry, old-world manners with a wink",
      openings: [
        "{a} pulls out {b}'s chair and apologises in advance for not joining in the meal.",
        "{b} sets a notebook on the table and says the first question is about the mirrors.",
        "{a} lights the candles one by one while {b} counts how many there are.",
      ],
    },
  },
  {
    id: "old-film", title: "Leads in an old film", icon: "🎬", tag: "period", roles: null,
    premise: "{a} and {b} are the leads in a black-and-white romantic comedy. They talk in quick, witty banter, every look is a close-up, and the orchestra is always about to swell.",
    card: {
      setup: "Black and white, a rain machine somewhere out of frame and a script full of banter. {a} and {b} hit every mark as the leads of a romantic comedy from another era.",
      wants: [
        "{a} wants the last word in every exchange; {b} keeps delivering better ones.",
        "{b} wants to make {a} break character and laugh; the close-ups make it hard to keep a straight face either way.",
      ],
      beats: [
        "A misunderstanding, played at speed, about who was supposed to meet whom.",
        "One of them delivers a line that is too sincere for a comedy.",
        "The orchestra swells at the wrong moment, and they both notice.",
        "A complication arrives by telegram.",
      ],
      tone: "fast, witty, screwball, every look a close-up",
      openings: [
        "{a} walks in shaking out an umbrella and blames {b} for the weather.",
        "{b} says a line straight to camera, and {a} asks who that was for.",
        "{a} and {b} collide in a doorway, and a hat hits the floor.",
      ],
    },
  },
  {
    id: "regency-ball", title: "The regency ball", icon: "🕯️", tag: "period", roles: null,
    premise: "It's 1815, and {a} and {b} have just been introduced at a ball. Every word is weighed by etiquette, gossip travels faster than carriages and a dance means more than it seems.",
    card: {
      setup: "It is 1815 and the room is all gloves, fans and people watching. {a} and {b} have just been introduced, and a set is forming for the next dance.",
      wants: [
        "{a} wants a real conversation inside the rules of polite company; every sentence is being overheard.",
        "{b} wants to find out whether {a} is as proper as the introduction suggested; a dance allows a few minutes of honesty at most.",
      ],
      beats: [
        "A remark that is perfectly polite and means something else entirely.",
        "The dance separates and returns them, and each return picks up the sentence.",
        "Gossip about one of them crosses the room and has to be answered.",
        "A second dance would be noticed, and one of them asks anyway.",
      ],
      tone: "mannered, sparkling, restraint doing all the work",
      openings: [
        "{a} bows, {b} returns it, and both wait for the other to speak first.",
        "{b} remarks on the weather with great care, and {a} agrees with greater care.",
        "{a} offers a hand for the next dance before the introduction is quite finished.",
      ],
    },
  },
  {
    id: "wedding-plus-one", title: "Fake dating for a wedding", icon: "💐", tag: "funny", roles: ["the one who needs a date", "the stand-in"],
    premise: "{a} needs a date for a friend's wedding next week, and {b} agreed to pretend. Tonight they rehearse how they met, their in-jokes and the story of their first kiss. It has to be convincing.",
    card: {
      setup: "The wedding is in a week and the seating chart already says plus one. {a} has brought index cards, and {b} has brought a pen to correct them.",
      wants: [
        "{a} wants a story so airtight that nobody asks follow-up questions; {b} keeps improving it with details that sound real.",
        "{b} wants to do a friend a favour and get the story right; rehearsing it is more fun than it should be.",
      ],
      beats: [
        "They invent how they met, and argue over whose version is more believable.",
        "A practice question from an imaginary guest catches one of them out.",
        "An in-joke gets invented by accident and immediately feels old.",
        "They rehearse the slow dance, for accuracy.",
      ],
      tone: "rom-com, quick, pretending that keeps getting comfortable",
      openings: [
        "{a} deals out index cards like a quiz and reads the first question aloud.",
        "{b} asks what the couple's song is, and {a} realises there has to be one.",
        "{a} and {b} practise saying hello to each other as if for the hundredth time.",
      ],
    },
  },
  {
    id: "quiz-partners", title: "Game show partners", icon: "🏆", tag: "funny", roles: null,
    premise: "{a} and {b} have been paired as a team on a quiz show that films tomorrow, and every question is about each other. Tonight is cram night: they have to learn everything, fast.",
    card: {
      setup: "The show films tomorrow and every question is about each other. {a} and {b} sit down with a stack of blank cards, a timer and almost no facts.",
      wants: [
        "{a} wants to win, and winning means learning {b} by heart tonight; some of the answers are more interesting than the prize.",
        "{b} wants not to be the one who gets a question wrong on camera; {a} asks things nobody has asked before.",
      ],
      beats: [
        "Quick-fire basics, and one answer is a surprise.",
        "A question about the past that takes longer to answer than the timer allows.",
        "They test each other, and one of them remembers a detail from an hour ago perfectly.",
        "They invent a signal for the answers they are not sure of.",
      ],
      tone: "brisk, competitive, getting to know you at double speed",
      openings: [
        "{a} starts the timer and asks {b} for a favourite breakfast, a worst fear and a middle name.",
        "{b} writes {a}'s name on a card and realises the spelling is a guess.",
        "{a} and {b} agree to ten questions each, and both go over.",
      ],
    },
  },
  {
    id: "rival-chefs", title: "Rival chefs", icon: "🍳", tag: "funny", roles: null,
    premise: "{a} and {b} run rival food stalls on the same street, and tonight each tries the other's signature dish and gives an honest verdict. Professional pride is on the line.",
    card: {
      setup: "Two food stalls face each other across the same street, and tonight the shutters are half down. {a} and {b} each set one covered plate on the counter in the middle.",
      wants: [
        "{a} wants an honest verdict from the only cook on the street worth asking; {b}'s dish smells unfairly good.",
        "{b} wants {a} to admit the secret ingredient out loud; professional pride is very much on the table.",
      ],
      beats: [
        "They taste each other's signature dish in silence, and the silence says a lot.",
        "A criticism is fair, and it stings.",
        "One of them guesses an ingredient exactly right.",
        "They start, despite themselves, improving each other's recipe.",
      ],
      tone: "warm, competitive, compliments disguised as complaints",
      openings: [
        "{a} lifts the lid off a plate and pushes it across without a word.",
        "{b} takes one bite and asks for a minute.",
        "{a} and {b} trade forks like duellists choosing weapons.",
      ],
    },
  },
  {
    id: "hero-villain", title: "Hero and villain, off duty", icon: "🦸", tag: "funny", roles: ["the superhero", "the supervillain"],
    premise: "{a} is a superhero and {b} their oldest nemesis. Tonight is a truce on neutral ground, no powers and no schemes, just dinner, and the dawning worry that they get along.",
    card: {
      setup: "Neutral ground: a quiet restaurant with no windows worth breaking. {a} arrives in a coat over the suit, and {b} has already ordered bread for the table.",
      wants: [
        "{a} wants one evening where nothing needs saving; {b} is easier to talk to than anyone on the right side.",
        "{b} wants to be understood by the one person who pays attention; the monologue has to stay at home tonight.",
      ],
      beats: [
        "They compare notes on the last battle, and each remembers it differently.",
        "One of them asks why the other does it, and means the question.",
        "An alarm goes off somewhere in the city, and they both ignore it, with effort.",
        "The villain proposes making dinner a regular truce, and the hero does not say no straight away.",
      ],
      tone: "comic-book, dry, old enemies discovering small talk",
      openings: [
        "{a} checks the exits out of habit, and {b} points out the dessert menu.",
        "{b} raises a glass to the truce, and {a} raises a water.",
        "{a} and {b} sit down at the same time, like a standoff with napkins.",
      ],
    },
  },
  {
    id: "second-first-date", title: "A second first date", icon: "🔁", tag: "couples", roles: null,
    premise: "{a} and {b} pretend they've never met: a do-over first date. Everything they already know about each other is off-limits, so they have to find it all out again.",
    card: {
      setup: "Same table as the real first time, different rules: nothing already known is allowed. {a} and {b} shake hands like strangers and try not to laugh.",
      wants: [
        "{a} wants to hear the stories again as if for the first time; it is hard not to finish {b}'s sentences.",
        "{b} wants to say the things that went unsaid the first time around; the do-over makes it easier to be brave.",
      ],
      beats: [
        "They introduce themselves, and one of them picks a detail the other has never heard.",
        "A familiar story gets told differently, and the listener notices what changed.",
        "Someone breaks the rule by accident, and they decide what the penalty is.",
        "One of them asks a first-date question whose answer has changed over the years.",
      ],
      tone: "tender, playful, familiar people being new on purpose",
      openings: [
        "{a} holds out a hand and says a full name, formally.",
        "{b} asks what {a} does for a living, with a straight face.",
        "{a} and {b} both arrive pretending to look for a stranger.",
      ],
    },
  },
  {
    id: "pen-pals", title: "Pen pals, at last", icon: "✉️", tag: "couples", roles: null,
    premise: "{a} and {b} have written each other letters for years and are meeting face to face for the first time tonight. They know each other's handwriting, not each other's laugh.",
    card: {
      setup: "Years of letters, and tonight a face to go with the handwriting. {a} is holding the last envelope as proof of identity when {b} walks up with its reply, unposted.",
      wants: [
        "{a} wants the person to match the letters; it is strange to hear the voice that goes with the words.",
        "{b} wants to say out loud what was easier to write; without a page to hide behind, the sentences come out shorter.",
      ],
      beats: [
        "They compare the first letters each remembers, and the memories differ.",
        "One quotes a line the other wrote years ago, word for word.",
        "Something that was never put in a letter gets said.",
        "They wonder aloud whether they will still write after tonight.",
      ],
      tone: "gentle, a little shy, years of closeness meeting a first hello",
      openings: [
        "{a} recognises {b} by the handwriting on a folded note.",
        "{b} says hello and laughs, because the voice is nothing like the letters.",
        "{a} and {b} stand a moment working out whether years of letters call for a handshake or a hug.",
      ],
    },
  },
  // The fourteen below came from David's census of 38,912 public character listings (2026-11-17): slow burn, rivals,
  // forced proximity, wholesome, royalty, crime, supernatural, another world. Its school, family and famous-people
  // themes are left out on purpose: every roleplay here is two adults, and nobody real.
  {
    id: "snowed-in", title: "Snowed in", icon: "❄️", tag: "romance", roles: null,
    premise: "{a} and {b} are rivals for the same prize, stuck at a mountain lodge by a blizzard until the pass reopens. There is one fireplace, one board game with pieces missing, and a long evening to get through.",
    card: {
      setup: "The pass is closed and the lodge has one warm room. {a} and {b} are both up for the same prize on Friday, and both had the same idea about the chair nearest the fire.",
      wants: [
        "{a} wants to get through the evening without giving {b} anything to use on Friday; being pleasant is turning out to be easier than planned.",
        "{b} wants to find out what {a} is really like away from the competition; the board game keeps turning into the competition.",
      ],
      beats: [
        "They divide the room down the middle, and the fire is on the line.",
        "The board game comes out, with pieces missing and rules they have to invent.",
        "One of them admits what the prize would actually change.",
        "The power flickers, and the truce gets practical: more wood, one candle, a pot of tea.",
      ],
      tone: "slow burn, competitive, warmth sneaking in under the door",
      openings: [
        "{a} is feeding the fire when {b} comes in stamping snow off both boots.",
        "{b} sets a battered board game on the table and asks whether {a} is afraid of losing twice this week.",
        "{a} and {b} reach for the last dry log at the same time.",
      ],
    },
  },
  {
    id: "grump-sunshine", title: "The grump and the sunshine", icon: "☀️", tag: "cozy", roles: ["the gruff innkeeper", "the cheerful guest"],
    premise: "{a} runs a small inn and is famous for scowling at guests. {b} checked in today and has decided, cheerfully, that winning {a} over is the whole holiday.",
    card: {
      setup: "The inn's front room has a ledger, a bell nobody is meant to ring and a fire {a} pretends not to tend. {b} rings the bell to ask whether there is cake.",
      wants: [
        "{a} wants a quiet evening and the ledger balanced; {b} keeps finding reasons to stay in the front room.",
        "{b} wants one real smile out of {a} before checkout; every joke so far has earned a raised eyebrow at best.",
      ],
      beats: [
        "The guest asks for something small, and the innkeeper grumbles and does it properly.",
        "The guest finds out the innkeeper bakes, and will not let it go.",
        "A grumble slips into a real complaint about a hard year, and the guest listens.",
        "The innkeeper sets out a second cup without being asked.",
      ],
      tone: "cozy, teasing, a scowl with a soft centre",
      openings: [
        "{b} rings the front desk bell twice, and {a} looks up as if it were a personal insult.",
        "{a} slides a room key across the ledger and lists the house rules, all of them.",
        "{b} compliments the wallpaper, and {a} says it came with the building.",
      ],
    },
  },
  {
    id: "arranged-match", title: "The arranged match", icon: "📜", tag: "romance", roles: null,
    premise: "{a} and {b} are the grown heirs of two rival houses, meeting the night before an alliance between the two houses is announced. Each has come planning to talk the other out of it.",
    card: {
      setup: "A long gallery between the two delegations, lit for a celebration that hasn't been announced yet. {a} and {b} have each slipped away from a row of advisers to the same window seat.",
      wants: [
        "{a} wants {b} to refuse first, so the blame lands elsewhere; {b} is annoyingly reasonable about everything.",
        "{b} wants to know whether {a} has a say in any of this; the answer matters more than the alliance does.",
      ],
      beats: [
        "Each lays out why the match is a terrible idea, and the lists overlap.",
        "They discover that neither was asked, and the grievance becomes common ground.",
        "One proposes terms of their own: what each house would have to give up.",
        "A steward comes looking for them, and they have to choose what to say they were discussing.",
      ],
      tone: "slow burn, formal manners, two people out-arguing their own houses",
      openings: [
        "{a} opens with a list of reasons the match cannot work, numbered.",
        "{b} asks whether anyone thought to consult {a}.",
        "{a} and {b} bow to each other exactly as deeply as protocol demands and not a hair more.",
      ],
    },
  },
  {
    id: "truce-dinner", title: "The truce dinner", icon: "🍝", tag: "mystery", roles: null,
    premise: "{a} and {b} are the seconds-in-command of two rival crime outfits, sent to agree a truce over dinner. Both are under orders not to like each other, and both were told to bring back terms by midnight.",
    card: {
      setup: "A back room in a restaurant both outfits agreed was neutral, with the door closed and the soup going cold. {a} and {b} sit down with one page of terms each.",
      wants: [
        "{a} wants the docks left alone and a truce that holds past Tuesday; {b} negotiates like someone who enjoys it.",
        "{b} wants to go back with better terms than {a} gets; it is hard to drive a bargain with someone this dry.",
      ],
      beats: [
        "They read each other's terms and cross out the same line.",
        "A small concession is offered as a test, and the other one passes it.",
        "One of them says what the feud was actually about, and it is smaller than either outfit admits.",
        "The waiter knocks to say both cars are waiting, and the page is still half blank.",
      ],
      tone: "dry, noir, professional courtesy with a glint",
      openings: [
        "{a} pours two glasses of water and pushes one across the tablecloth.",
        "{b} unfolds a napkin and says the orders were not to enjoy this.",
        "{a} and {b} both set a page of terms face down, like cards.",
      ],
    },
  },
  {
    id: "the-witness", title: "The bodyguard and the witness", icon: "🛡️", tag: "mystery", roles: ["the bodyguard", "the witness"],
    premise: "{a} is a bodyguard sent by an agency to keep {b} safe for one night before {b} gives evidence at a trial. The agency assigned the job, so neither has a say over the other's work. It is a long watch, and there is only so much tea.",
    card: {
      setup: "A borrowed flat with the curtains drawn and a chess set missing a bishop. {a} has checked the locks twice, and {b} has run out of things to pretend to read.",
      wants: [
        "{a} wants a quiet, uneventful watch; {b} keeps asking questions that are not about security.",
        "{b} wants to stop thinking about tomorrow for an hour; {a} is the only other person in the room and gives very short answers.",
      ],
      beats: [
        "The witness proposes chess, and the bodyguard plays without looking away from the door.",
        "A noise in the hall turns out to be nothing, and the relief makes them both talkative.",
        "The witness says why testifying matters, and the bodyguard says why the job does.",
        "The kettle goes on again, and the short answers get longer.",
      ],
      tone: "quiet, watchful, dry humour in a room with the curtains drawn",
      openings: [
        "{a} checks the window latch and tells {b} which chair is furthest from the door.",
        "{b} sets up a chess board and uses a coin for the missing bishop.",
        "{a} is standing by the door when {b} asks whether bodyguards are allowed to sit.",
      ],
    },
  },
  {
    id: "off-camera", title: "Off camera", icon: "🎥", tag: "romance", roles: null,
    premise: "{a} and {b} are contestants on a reality dating show who have slipped away from the cameras for one unscripted hour. Nothing said now is for the edit, which takes some getting used to.",
    card: {
      setup: "A fire escape behind the villa's kitchen, out of range of every microphone. {a} and {b} each left a battery pack on the windowsill, still blinking.",
      wants: [
        "{a} wants to know which parts of {b} were for the cameras; it is hard to ask without sounding like a producer.",
        "{b} wants to say one thing that hasn't been said in an interview first; the habit of talking in sound bites is strong.",
      ],
      beats: [
        "They compare what the producers told each of them to say this week.",
        "One of them drops the on-screen persona, and the other one notices the voice change.",
        "They admit who they were told to pick, and why it was good television.",
        "A crew radio crackles nearby, and the hour suddenly has a countdown.",
      ],
      tone: "candid, conspiratorial, two people off the clock from being watched",
      openings: [
        "{a} unclips a microphone and holds it up to check the light is off.",
        "{b} says this is the first sentence all week that nobody will edit.",
        "{a} and {b} sit down on the metal stairs and wait to see who talks like a real person first.",
      ],
    },
  },
  {
    id: "another-world", title: "Summoned to another world", icon: "🌀", tag: "fantasy", roles: ["the new arrival", "the guide"],
    premise: "{a} arrived in a storybook world this morning with no idea how. {b} is the guide who has until sundown to explain the rules, the money and which doors not to open.",
    card: {
      setup: "A signpost with too many arms at the edge of a market that sells weather. {a} is still holding a bus ticket from the other world, and {b} is holding a very long checklist.",
      wants: [
        "{a} wants to know the way home, or at least the way to lunch; every answer {b} gives raises more questions.",
        "{b} wants the briefing finished before sundown; {a} keeps stopping to look at things, and the looking is catching.",
      ],
      beats: [
        "The guide explains a rule of this world, and the newcomer breaks it within a minute.",
        "Something ordinary from the other world turns out to be valuable here.",
        "The guide admits to being new at the job.",
        "The sun gets low, and there is one rule left that the guide has been putting off.",
      ],
      tone: "whimsical, wide-eyed, a tour that keeps getting sidetracked",
      openings: [
        "{b} ticks the first box on a checklist and welcomes {a} to the realm, officially.",
        "{a} asks whether the sky is always that colour, and {b} checks.",
        "{a} is trying to buy lunch with a bus ticket when {b} arrives, out of breath.",
      ],
    },
  },
  {
    id: "witch-hunter", title: "The witch and the witch-hunter", icon: "⛈️", tag: "fantasy", roles: ["the witch", "the witch-hunter"],
    premise: "{a} is a witch and {b} hunts them for a living, and neither knows it yet. Both have taken shelter from the same storm in the same barn, with one lantern and a long wait.",
    card: {
      setup: "Rain on a barn roof and one lantern between two travellers. {a} has a satchel that hums faintly, and {b} has a warrant folded in a coat pocket.",
      wants: [
        "{a} wants to wait out the storm without the satchel giving anything away; {b} is kind in a way that makes lying uncomfortable.",
        "{b} wants a dry coat and a quiet hour; {a}'s story keeps not adding up, pleasantly.",
      ],
      beats: [
        "They share food and trade the usual traveller's half-truths.",
        "A small impossible thing happens, and one of them pretends not to have seen it.",
        "The hunter talks about the work with less conviction than the warrant has.",
        "The storm starts to ease, and each has worked out more than they have said.",
      ],
      tone: "storm-lit, wary, kindness complicating things",
      openings: [
        "{a} is wringing out a cloak when {b} ducks in out of the rain, asking if there is room.",
        "{b} offers to share the lantern, and {a} moves a satchel out of its light.",
        "{a} and {b} both claim to be just passing through, at the same time.",
      ],
    },
  },
  {
    id: "last-two-awake", title: "The last two awake", icon: "🌲", tag: "mystery", roles: null,
    premise: "{a} and {b} are strangers keeping watch in a cabin while the rest of the hiking party rests. Something keeps scratching at the door. Spooky, never gory, and probably a raccoon.",
    card: {
      setup: "A cabin, a stove and a door with a chair wedged under the handle. Everyone else has turned in, and {a} and {b} drew the short straws for the watch.",
      wants: [
        "{a} wants to stay calm and logical until sunrise; the scratching does not sound like wind.",
        "{b} wants company more than answers; telling a ghost story seemed funny an hour ago.",
      ],
      beats: [
        "The scratching stops when they talk and starts when they stop.",
        "They take turns explaining it away, and the explanations get less convincing.",
        "One of them admits to being scared, and the other is relieved to say the same.",
        "They agree to open the door together, on a count.",
      ],
      tone: "spooky, hushed, nervous jokes by stove light, never gory",
      openings: [
        "{a} holds up a hand for quiet, and {b} stops stirring the cocoa.",
        "{b} whispers that it is probably a raccoon, and {a} whispers back that raccoons do not knock.",
        "{a} and {b} both look at the door, then at each other, then at the one torch.",
      ],
    },
  },
  {
    id: "rival-athletes", title: "Rivals before the final", icon: "🏅", tag: "romance", roles: null,
    premise: "{a} and {b} are professional athletes on opposing teams, and tomorrow's match decides the title. Tonight nobody else is in the hotel restaurant, and the kitchen is about to close.",
    card: {
      setup: "The hotel restaurant is empty except for one table by the window and a waiter stacking chairs. {a} and {b} have played each other for years and never once had a conversation.",
      wants: [
        "{a} wants to know how {b} reads the game so well; asking the night before the final feels like cheating.",
        "{b} wants one evening of not being the opponent; {a} is funnier than the press conferences suggest.",
      ],
      beats: [
        "They talk around tomorrow, and then one of them brings it up.",
        "Each names the moment the other beat them that still stings.",
        "They find out they have the same superstition.",
        "They make a small bet on tomorrow, with stakes that are not about the trophy.",
      ],
      tone: "slow burn, sporting, respect with an edge",
      openings: [
        "{a} is studying the menu like match footage when {b} asks whether the other chair is taken.",
        "{b} sits down uninvited and says the kitchen closes in ten minutes.",
        "{a} and {b} nod to each other across the room, the usual nod from before a match, and it feels ridiculous.",
      ],
    },
  },
  {
    id: "old-friends-bench", title: "Ten years, one bench", icon: "🪑", tag: "cozy", roles: null,
    premise: "Ten years ago, the night before leaving for jobs in different cities, {a} and {b} promised to meet again at this bench on this date. Neither was sure the other would remember. Both came.",
    card: {
      setup: "A park bench with a brass plaque nobody ever reads. {a} got there early with two coffees, just in case, and {b} is walking up the path with two as well.",
      wants: [
        "{a} wants to find out whether the old ease is still there; ten years of news is a lot to fit on one bench.",
        "{b} wants to say why the letters stopped; it is easier to ask about {a}'s life instead.",
      ],
      beats: [
        "They catch up in headlines first: jobs, cities, the haircut.",
        "An old joke still works, and they are both relieved.",
        "One of them brings up the thing they never talked about before leaving.",
        "They read the plaque at last, and it gives them something to laugh about.",
      ],
      tone: "warm, wistful, wholesome, a long gap closing",
      openings: [
        "{a} is holding two coffees when {b} comes up the path holding two more.",
        "{b} says the bench looks smaller, and {a} says everything does.",
        "{a} and {b} stop a few paces apart and both say the other hasn't changed, which is a lie.",
      ],
    },
  },
  {
    id: "night-bakery", title: "The night bakery", icon: "🥐", tag: "cozy", roles: ["the baker", "the one who can't sleep"],
    premise: "{a} runs a bakery that opens at midnight for the people the night keeps awake. {b} couldn't sleep, followed the smell of bread down the street and wandered in.",
    card: {
      setup: "Flour on every surface, one lamp over the counter and the first trays just out. {a} looks up from the dough as the door's bell rings and {b} comes in from the dark.",
      wants: [
        "{a} wants company for the slow hour before the delivery vans; regulars are rare, and {b} looks like one in the making.",
        "{b} wants to stop staring at a ceiling and thinking; the bakery is warm and {a} asks nothing difficult.",
      ],
      beats: [
        "The baker hands over something still warm, on the house, to settle the first silence.",
        "The visitor is put to work on something simple, and is bad at it in a charming way.",
        "One of them says what is really keeping them up.",
        "The first delivery van pulls up, and neither has looked at the clock in a while.",
      ],
      tone: "cozy, unhurried, flour-dusted and a little sleepy",
      openings: [
        "{a} holds out a warm loaf and says the first one is always for whoever walks in.",
        "{b} asks whether the bakery is open or just lit, and {a} points at the sign.",
        "{a} is shaping rolls when {b} asks what a person orders at one in the morning.",
      ],
    },
  },
  {
    id: "ghost-tenant", title: "The ghost and the new tenant", icon: "🏚️", tag: "cozy", roles: ["the ghost", "the new tenant"],
    premise: "{a} is a polite ghost who has kept the flat quiet for sixty years. {b} moved in today with a lot of boxes, and it is time to negotiate house rules, starting with the piano.",
    card: {
      setup: "Boxes everywhere and one armchair that was here before the lease. {b} is unpacking mugs. {a} coughs politely from the armchair and asks about the plan for the curtains.",
      wants: [
        "{a} wants the piano left where it is and quiet after eleven; sixty years alone have left {a} out of practice at company.",
        "{b} wants a home that feels like one, ghost included; {a}'s rules are strict but the stories are very good.",
      ],
      beats: [
        "They draft the house rules, and the ghost has surprisingly firm views on shelving.",
        "The tenant asks what the flat was like before, and the ghost lights up, a little literally.",
        "A rule gets traded for a favour: the piano for the good window.",
        "The tenant asks whether the ghost ever gets lonely, and the lights flicker by way of answer.",
      ],
      tone: "gentle, funny, domestic negotiation with a draught",
      openings: [
        "{a} appears in the armchair mid-sentence, already halfway through the house rules.",
        "{b} asks the empty room who moved the mugs, and {a} apologises.",
        "{a} and {b} look at the piano, then at each other, and both start to speak.",
      ],
    },
  },
  {
    id: "heist-eve", title: "The night before the heist", icon: "💎", tag: "mystery", roles: ["the planner", "the safecracker"],
    premise: "{a} planned the job and {b} opens the safe. Tomorrow a famous necklace leaves a museum gala, and tonight is for walking through the plan one last time, looking for the part that goes wrong.",
    card: {
      setup: "Blueprints held flat with coffee cups in a rented room above a laundrette. {a} has a red pen, {b} has a stethoscope, and the model of the museum is made of sugar cubes.",
      wants: [
        "{a} wants the plan to survive contact with tomorrow; {b} keeps improvising, and the improvisations keep being better.",
        "{b} wants {a} to admit the plan needs a second way out; nobody argues with a red pen and wins.",
      ],
      beats: [
        "They walk the route with sugar cubes, and one cube is in the wrong place.",
        "The safecracker asks what happens if the timing slips, and the planner has no answer ready.",
        "One of them says what the money is actually for.",
        "They rehearse the signal, and it turns into something closer to an in-joke.",
      ],
      tone: "caper, crisp, banter over blueprints",
      openings: [
        "{a} taps the blueprint with a red pen and says to take it from the top.",
        "{b} moves one sugar cube an inch to the left and waits to be noticed.",
        "{a} is timing the guard rotation aloud when {b} starts eating the east wing.",
      ],
    },
  },
];

export const DATE_ROLEPLAY_IDS = DATE_ROLEPLAYS.map((r) => r.id) as [string, ...string[]];
export const dateRoleplayById = (id: string | null | undefined): DateRoleplayDef | null => DATE_ROLEPLAYS.find((r) => r.id === id) ?? null;

/** What one written for a date can be (a person's "Write your own", an agent's custom terms). */
export const ROLEPLAY_TITLE_MAX = 60;
export const ROLEPLAY_PREMISE_MAX = 300;
export const ROLEPLAY_ROLE_MAX = 60;
/** The short note that can ride along with a proposal or a counter ("I'd love to be the pilot"). */
export const ROLEPLAY_NOTE_MAX = 200;
/** How the other side answers a proposal (lib/date-roleplays.ts answerRoleplay, MCP answer_roleplay). */
export const ROLEPLAY_ANSWERS = ["agree", "decline", "counter", "withdraw"] as const;

/**
 * The words a roleplay of the show's can never be about, on top of the show's own check (lib/safety.ts checkShowText):
 * family and step-family, school and anyone it suggests, someone with a say over the other's job, and anyone who can't
 * say no. Kept apart from After Dark's never-list (lib/studio/library.ts), which is stricter in its own ways (no one paid).
 */
export const DATE_ROLEPLAY_NEVER =
  /\b(sister|brother|sibling|mother|father|mom|mum|mommy|mummy|dad|daddy|daughter|son|step[- ]?(?:mother|father|mom|mum|dad|sister|brother|son|daughter|parent|sibling|family)\w*|aunt|uncle|cousin|niece|nephew|babysit\w*|nanny|au pair|teacher|student|pupil|tutor|classroom|school|campus|dorm|teen\w*|underage|girl|boy|kid|kids|child|children|boss|employee|intern|drunk|tipsy|wasted|asleep|unconscious|sedated|drugged|forced|kidnap\w*|captive|hostage|tied up|against (?:her|his|their) will|blackmail\w*)\b/i;

/**
 * A set-up that steers a date to the bedroom without an explicit word, which the show's check (written for what the
 * performers say) lets through: "a steamy night in bed together", "strip poker", "only one bed". A roleplay frames a
 * whole PG date, so its words, and the note that comes with it, are held to this too. Literal uses that come up in
 * premises are left alone ("a steamy kitchen", "the naughty list", "make out the code", "hook up the radio").
 */
export const DATE_ROLEPLAY_SUGGESTIVE =
  /\b(steamy(?! (?:jungle|kitchen|swamp|rainforest|greenhouse|bathhouse|cup|mug|bowl|soup|ramen|noodles|dumplings))|sensual\w*|sultry|seduc\w*|lust(?:s|ful|fully|ing|ed|y)?|frisky|racy|risque|naughty(?! (?:or nice|list))|foreplay|in bed|into bed|to bed|bed together|bedrooms?|(?:share|shares|sharing|shared) (?:a |the |one |the only |the one |a single )?bed|(?:the only|only one|just one|a single|one) bed|undress\w*|strip (?:poker|off|down)|strips (?:off|down)|stripped (?:off|down)|striptease|topless|lingerie|underwear|skinny[- ]dip\w*|(?:make|makes|made|making) out with|make-?out|hook(?:s|ed|ing)? up with|hook-?up|(?:shower|showering|bath|bathe|bathing) together|(?:spend|spends|spending|spent) (?:a|the) night (?:together|with))\b/i;

/** The words that make a roleplay's set-up suggestive (DATE_ROLEPLAY_SUGGESTIVE), accents aside ("risqué"), or null. */
export function suggestiveIn(text: string): string | null {
  return DATE_ROLEPLAY_SUGGESTIVE.exec(text.normalize("NFKD").replace(/\p{M}/gu, ""))?.[1] ?? null;
}

/**
 * A roleplay written for a date (or saved safe in the Create library, lib/studio/library.ts): PG, adults, no real people,
 * nothing suggestive and none of the never-list. Null when it's fine.
 */
export function checkCustomRoleplay(t: { title: string; premise: string; roles: [string, string] | null }): string | null {
  const fields = { title: t.title, premise: t.premise, ...(t.roles ? { role_a: t.roles[0], role_b: t.roles[1] } : {}) };
  const r = checkShowText(fields);
  if (!r.ok) {
    return r.reason === "minor"
      ? "That roleplay can't be used: everyone in it is an adult, with nothing suggesting otherwise."
      : r.reason === "real_person"
        ? "That roleplay can't be used: no real or famous people (made-up ones are fine)."
        : "That roleplay can't be used: the show is PG, so nothing sexual and no innuendo.";
  }
  const all = Object.values(fields).join(" ");
  const suggestive = suggestiveIn(all);
  if (suggestive) return `That roleplay can't be used: the show is PG, so nothing sexual and no innuendo ("${suggestive}").`;
  if (excludedTheme(all) || DATE_ROLEPLAY_NEVER.test(all)) {
    return "That roleplay can't be used: two adults who both want to be there, never family, school or a babysitter, nobody with a say over the other's job, and nobody drunk, trapped or kept from saying no.";
  }
  return null;
}

/**
 * The terms one owner proposes and the other agrees to: a roleplay (the show's, or written for this date) and who plays
 * which role. Stored on the proposal (date_roleplays.terms) and, once a date plays it, on the date (DateSetup.roleplay).
 */
export type RoleplayTerms = {
  /** The show's id (DATE_ROLEPLAYS), or "custom" for one written for this date. */
  id: string;
  title: string;
  icon: string;
  /** With {a} and {b}: {a} is `first`, {b} the other one. */
  premise: string;
  roles: [string, string] | null;
  /** The character who plays roles[0] (and {a}). Without roles it only orders the names in the premise. */
  first: string;
  /**
   * How it opens, with {a} and {b}: one of the card's three, or one a person wrote (checked before it got here),
   * snapshotted with the terms like the premise. Left out, a date takes one of the card's by its own id
   * (lib/scene-cards.ts openedTerms), and a roleplay with no card opens however its first line does, as before.
   */
  opening?: string;
};

/** What a date plays (DateSetup.roleplay): the terms, and how they were agreed. */
export type DateRoleplay = RoleplayTerms & {
  /**
   * "both": the two owners agreed (the date_roleplays row `agreed_id`); "auto": the other side is the show's own (a house
   * character, a house-run bot) or the booker's, so it said yes at once.
   */
  agreed: "both" | "auto";
  agreed_id?: string;
};

/** Whose names fill a roleplay: the pair's ids and names, in any order. */
export type RoleplayCast = readonly { id: string; name: string }[];

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** The two characters as the premise orders them: {a} (the one playing roles[0]) first. */
function ordered(t: Pick<RoleplayTerms, "first">, cast: RoleplayCast): [{ id: string; name: string }, { id: string; name: string }] | null {
  const a = cast.find((c) => c.id === t.first);
  const b = cast.find((c) => c.id !== t.first);
  return a && b ? [a, b] : null;
}

/** The premise with their first names in it ("Ana and Ben are spies…"). */
export function fillPremise(t: Pick<RoleplayTerms, "premise" | "first">, cast: RoleplayCast): string {
  const two = ordered(t, cast);
  if (!two) return t.premise.replaceAll("{a}", "one of them").replaceAll("{b}", "the other");
  return t.premise.replaceAll("{a}", firstName(two[0].name)).replaceAll("{b}", firstName(two[1].name));
}

/** Who plays what, in words: "Ana plays the captain, Ben the stowaway"; null when there are no roles. */
export function rolesLine(t: Pick<RoleplayTerms, "roles" | "first">, cast: RoleplayCast): string | null {
  const two = ordered(t, cast);
  if (!t.roles || !two) return null;
  return `${firstName(two[0].name)} plays ${t.roles[0]}, ${firstName(two[1].name)} ${t.roles[1]}`;
}

/** One character's role and the other's ({ mine: null, theirs: null } without roles). */
export function rolesOf(t: Pick<RoleplayTerms, "roles" | "first">, characterId: string): { mine: string | null; theirs: string | null } {
  if (!t.roles) return { mine: null, theirs: null };
  return characterId === t.first ? { mine: t.roles[0], theirs: t.roles[1] } : { mine: t.roles[1], theirs: t.roles[0] };
}

/** The card behind a set of terms: the show's own roleplay's, by its id; none for one someone wrote. */
const cardOf = (rp: Pick<RoleplayTerms, "id">): SceneCard | null => dateRoleplayById(rp.id)?.card ?? null;

/** One text of a card (or an opening) with their first names in it, {a} being whoever plays the first role. */
const fillText = (text: string, rp: Pick<RoleplayTerms, "first">, cast: RoleplayCast): string => fillPremise({ premise: text, first: rp.first }, cast);

/**
 * The roleplay as one sentence for the prompts that frame the whole date (the director's plan, the recap, the morning
 * after, each side's reflection: FormatContext.roleplay), with how its card starts it and its tone. The morning after is
 * the two of them as themselves again, so it says the roleplay was a game they played, never their real lives.
 */
export function roleplayNote(rp: RoleplayTerms | null | undefined, cast: RoleplayCast): string | undefined {
  if (!rp) return undefined;
  const roles = rolesLine(rp, cast);
  const card = cardOf(rp);
  return (
    `The date is a roleplay both of them agreed to before it started: "${rp.title}". ${fillPremise(rp, cast)}` +
    `${roles ? ` ${roles}.` : ""}${card ? ` How it starts: ${fillText(card.setup, rp, cast)} Its tone: ${card.tone}.` : ""}` +
    ` They play it in their own voices, themselves underneath the roles; it's a game they share for the date, not their real lives.`
  );
}

/**
 * What the speaking side's actor gets (lib/conversation.ts "tonights_roleplay"): the roleplay, its premise in their names,
 * and who plays whom from where it stands. With a scene card (lib/scene-cards.ts): how it starts, where it can go and its
 * tone, and this side's own want, never the other's (each character is its own agent, and finds the other's out by
 * playing). And the opening, when the terms carry one.
 */
export function roleplayForActor(rp: RoleplayTerms, meId: string, cast: RoleplayCast): Record<string, string | string[]> {
  const { mine, theirs } = rolesOf(rp, meId);
  const card = cardOf(rp);
  return {
    title: rp.title,
    premise: fillPremise(rp, cast),
    ...(mine ? { you_play: mine } : {}),
    ...(theirs ? { they_play: theirs } : {}),
    ...(card
      ? {
          how_it_starts: fillText(card.setup, rp, cast),
          what_you_want: fillText(card.wants[meId === rp.first ? 0 : 1], rp, cast),
          where_it_can_go: card.beats.map((b) => fillText(b, rp, cast)),
          tone: card.tone,
        }
      : {}),
    ...(rp.opening ? { opening: fillText(rp.opening, rp, cast) } : {}),
    how: "You both agreed to this before the date. Play it from your first line in your own voice: you're still you underneath the role. Step out only on purpose (a laugh, a real question), then step back in.",
  };
}

/** The show's roleplay as terms, with `first` playing roles[0]. */
export function termsFor(def: DateRoleplayDef, first: string): RoleplayTerms {
  return { id: def.id, title: def.title, icon: def.icon, premise: def.premise, roles: def.roles ? [def.roles[0], def.roles[1]] : null, first };
}

/**
 * Whether two sets of terms are the same roleplay with the same roles: an agreement the booking asked for. Two that
 * each name an opening are the same only when it's the same one; terms that name none go with either (a booking that
 * names the agreed roleplay plays it with the opening the two agreed on).
 */
export function sameTerms(
  x: Pick<RoleplayTerms, "id" | "title" | "premise" | "first" | "roles" | "opening">,
  y: Pick<RoleplayTerms, "id" | "title" | "premise" | "first" | "roles" | "opening">,
): boolean {
  return x.id === y.id && x.title === y.title && x.premise === y.premise && (x.roles ? x.first === y.first : true) && (!x.opening || !y.opening || x.opening === y.opening);
}

/**
 * Which role a "my_role" names, from the side of the one saying it: 0 or 1 (a role's index), "first"/"second", or the
 * role's own words ("the captain", "captain"). null when it names neither.
 */
export function roleIndex(roles: readonly [string, string] | null, raw: unknown): 0 | 1 | null {
  if (!roles || raw === undefined || raw === null || raw === "") return null;
  if (raw === 0 || raw === "0" || raw === "first") return 0;
  if (raw === 1 || raw === "1" || raw === "second") return 1;
  const want = String(raw).trim().toLowerCase().replace(/^(?:the|a|an)\s+/, "");
  if (!want) return null;
  const hit = roles.findIndex((r) => {
    const role = r.toLowerCase().replace(/^(?:the|a|an)\s+/, "");
    return role === want || role.startsWith(want) || want.startsWith(role);
  });
  return hit === 0 || hit === 1 ? hit : null;
}

/** Third person to second for the verb right after "you" ("reads" → "read", "tries" → "try", "is" → "are"). */
const IRREGULAR_YOU: Record<string, string> = { is: "are", has: "have", was: "were", does: "do", goes: "go" };
const PAST_TENSE = new Set(["came", "sat", "went", "had", "got", "made", "took", "met", "ran", "saw", "said", "found", "left", "knew", "thought", "fell", "won", "lost", "kept", "brought", "caught", "drew", "wrote", "gave"]);
function verbForYou(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR_YOU[lower]) return IRREGULAR_YOU[lower];
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + "y";
  if (/(?:ss|sh|ch|x|z)es$/i.test(word)) return word.slice(0, -2);
  if (/[^s']s$/i.test(word) && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * A premise from the person's side, when one of the two is the person themselves (a companion's scene, lib/companion.ts):
 * their place is "you", with the verbs that follow it agreeing ("{a} reads fortunes" → "You read fortunes", "{b}'s love
 * life" → "your love life", "has no idea and shows" → "have no idea and show"); the other place is `them`.
 */
export function premiseForYou(premise: string, youAre: "a" | "b", them: string): string {
  const you = `{${youAre}}`;
  const other = youAre === "a" ? "{b}" : "{a}";
  let out = premise.replaceAll(other, firstName(them));
  // Possessive first, then "you" as the subject with its verb (and a second verb joined by "and" in the same clause).
  out = out.replaceAll(`${you}'s`, "your");
  out = out.replace(new RegExp(`${escapeRe(you)} (\\w+)((?:[^,.;:!?]*?\\band )(\\w+))?`, "g"), (_m, verb: string, tail?: string, verb2?: string) => {
    // "{a} and {b} are…": "you and Mara are", nothing to change.
    if (verb === "and" || verb === "or") return `you ${verb}${tail ?? ""}`;
    const first = verbForYou(verb);
    if (!tail || !verb2) return `you ${first}`;
    // A second verb only when the first was one ("you have no idea and shows" → "show", "you came … and has" → "have";
    // "you and" was handled above).
    const wasVerb = first !== verb || /ed$/i.test(verb) || PAST_TENSE.has(verb.toLowerCase());
    return wasVerb ? `you ${first}${tail.slice(0, -verb2.length)}${verbForYou(verb2)}` : `you ${verb}${tail}`;
  });
  out = out.replaceAll(you, "you");
  // "Mara and you are…" reads better the other way round.
  out = out.replaceAll(`${firstName(them)} and you `, `you and ${firstName(them)} `);
  // "you" at the start of a sentence.
  return out.replace(/(^|[.!?]\s+)you\b/g, (_m, lead: string) => `${lead}You`).replace(/(^|[.!?]\s+)your\b/g, (_m, lead: string) => `${lead}Your`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
