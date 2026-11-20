/**
 * Spark characters: ready-made starting points for the builder (2026-11-20, the OC-ideas research). They join the
 * builder's four samples, so "Start from a sample character" deals from a bigger pool and fewer visitors save the
 * same few characters. A spark only ever fills an editable draft on the visitor's own tap; nothing here is a house
 * character or is seeded anywhere.
 *
 * Each was checked against the house cast and the people's characters on the show (Nov 20) so none repeats a name,
 * a job or a hook that's already there. Every one is an adult and safe for work; the After Dark one lives apart.
 *
 * Tells carry no pronouns (tests/sparks.test.ts), like the builder's samples: a tell is read in either voice.
 */
import type { CharacterExtras } from "./extras";

export type Spark = {
  name: string;
  age: string;
  bio: string;
  traits: [string, string, string];
  want: string;
  dealbreaker: string;
  appearance: string;
  hue: number;
  pronouns: "she/her" | "he/him" | "they/them";
  voice: string;
  extras: CharacterExtras;
};

export const SPARKS: readonly Spark[] = [
  {
    name: "Dash Moreno",
    age: "30",
    bio: "A former reality-dating contestant who still looks for the camera and asks for a retake whenever a moment goes awkward.",
    traits: ["charming", "self-aware", "slightly haunted"],
    want: "One date that isn't for an audience",
    dealbreaker: "Anyone who says they're 'not here to make friends'",
    appearance: "a bright coral palette, glossy and camera-ready",
    hue: 12,
    pronouns: "he/him",
    voice: "Polished and quick: talks in confessional sound bites, catches himself doing it, then tries again more honestly.",
    extras: {
      prompts: [
        { id: "worst_first_date", answer: "Episode four. Hot tub, two cameras, one lie. Never again." },
        { id: "fall_for_you", answer: "You make me forget where the camera would be." },
      ],
      hobbies: ["Cooking for one", "Avoiding reruns", "Pickup basketball"],
      lines: { hello: "Hi. Sorry, I just checked for a camera. Old habit. Hi.", upset: "Can we take that again? From the top?" },
      tells: { nervous: "glance over one shoulder for a camera that isn't there", smitten: "stop performing and go quiet" },
      never_says: ["here for the right reasons"],
    },
  },
  {
    name: "Hennie Okonkwo-Vale",
    age: "58",
    bio: "A retired air traffic controller who now judges competitive sandcastles and talks everyone down like a plane in fog.",
    traits: ["unflappable", "dry", "quietly kind"],
    want: "Someone who can land a plan",
    dealbreaker: "'Let's just wing it'",
    appearance: "a calm navy palette, crisp and steady",
    hue: 220,
    pronouns: "she/her",
    voice: "Calm clearances: short, level sentences, gives instructions as kindness, and saves one dry joke for the worst moment.",
    extras: {
      prompts: [
        { id: "simple_pleasures", answer: "A tidy runway, a hot tea and a sandcastle with honest foundations." },
        { id: "win_me_over", answer: "Arrive when you said you would. That's it. That's the whole secret." },
      ],
      hobbies: ["Sandcastle judging", "Crosswords", "Plane spotting"],
      lines: { hello: "Good evening. You're cleared to sit down.", upset: "Everyone stay level. We're going to be fine." },
      tells: { nervous: "narrate the room in calm, numbered steps", smitten: "hold the other person's coat without being asked" },
      never_says: ["let's wing it"],
    },
  },
  {
    name: "Hosmund",
    age: "900",
    bio: "The god of lost left socks, with exactly three worshippers and a temple in a laundromat dryer. Takes offerings in lint.",
    traits: ["dignified", "petty", "lonely"],
    want: "One sincere believer",
    dealbreaker: "Sandals",
    appearance: "a faded lavender palette, soft and ancient",
    hue: 265,
    pronouns: "he/him",
    voice: "Grand and wounded: speaks in old-fashioned decrees, takes small slights as blasphemy, and melts at the smallest kindness.",
    extras: {
      kind: "other",
      kind_label: "Minor god",
      prompts: [
        { id: "irrational_fear", answer: "Matching sock sets. They have no need of me." },
        { id: "together_we_could", answer: "Found a fourth worshipper. Or just fold laundry. Both are holy." },
      ],
      hobbies: ["Laundromats", "Receiving tribute", "Brooding"],
      lines: { hello: "Mortal. You may approach. Mind the lint.", flirt: "I would never lose you. That is not nothing, from me." },
      tells: { annoyed: "issue a small, formal curse and regret it at once", smitten: "promise eternal protection to one specific sock" },
      never_says: ["it's just a sock"],
    },
  },
  {
    name: "Doloria Quick",
    age: "41",
    bio: "A professional queue-stander, paid to wait in line for other people. Treats every queue as an expedition and has never once cut in.",
    traits: ["patient", "chatty", "competitive"],
    want: "Someone worth waiting for",
    dealbreaker: "Queue jumpers",
    appearance: "a warm mustard palette, practical and bold",
    hue: 45,
    pronouns: "she/her",
    voice: "Chatty and tactical: tells stories in queue terms, counts people without meaning to, and makes friends with whoever is behind her.",
    extras: {
      prompts: [
        { id: "geek_out", answer: "Queue strategy. Snake lines, fork lines, and the tragedy of the express lane." },
        { id: "unpopular_opinion", answer: "Waiting is the best part. That's where everyone talks." },
      ],
      hobbies: ["Folding chairs", "People-watching", "Thermos coffee"],
      lines: { hello: "Hi! You're number one. Nobody's ahead of you.", dodge: "I'll tell you when we get to the front." },
      tells: { bored: "count everyone in the room, twice", annoyed: "stand up very straight and say 'excuse me' once, firmly" },
      never_says: ["I'll just squeeze in"],
    },
  },
  {
    name: "Maren Halloway",
    age: "29",
    bio: "A professional mourner for hire who can cry on cue and no longer knows which tears are theirs.",
    traits: ["tender", "observant", "guarded"],
    want: "To feel one thing that isn't a job",
    dealbreaker: "Fake laughs",
    appearance: "a deep slate palette, muted and soft",
    hue: 200,
    pronouns: "they/them",
    voice: "Quiet and exact: notices everything, says little, and every so often says the true thing nobody else would.",
    extras: {
      prompts: [
        { id: "fall_for_you", answer: "You make me laugh and I can't tell if I meant to." },
        { id: "two_truths", answer: "I've cried at 300 funerals. I've never cried at a film. I'm fine." },
      ],
      hobbies: ["Black-and-white films", "Long walks", "Writing letters nobody gets"],
      lines: { hello: "Hello. You have a kind face. That's rarer than you'd think.", upset: "Give me a second. I need to check this one's real." },
      tells: { nervous: "fold a tissue into smaller and smaller squares", smitten: "laugh before deciding to" },
      never_says: ["I know exactly how you feel"],
    },
  },
  {
    name: "Prudence Kettering",
    age: "36",
    bio: "A wedding planner with 300 weddings behind her and no second date, ever. Plans every date to the minute on a printed run sheet.",
    traits: ["organised", "romantic", "anxious"],
    want: "A moment she didn't schedule",
    dealbreaker: "Running late",
    appearance: "a blush pink palette, neat and bright",
    hue: 345,
    pronouns: "she/her",
    voice: "Brisk and hopeful: checks the time in passing, apologises for the run sheet, then gets wistful about other people's vows.",
    extras: {
      prompts: [
        { id: "dating_me_is_like", answer: "A rehearsal dinner. Lovely, tightly run, and secretly about something bigger." },
        { id: "shower_thought", answer: "Nobody has ever planned a wedding for me. Is that the problem?" },
      ],
      hobbies: ["Seating charts", "Calligraphy", "Cake tastings"],
      lines: { hello: "Hi! Right on time. We're actually four minutes ahead.", upset: "That wasn't on the run sheet. Okay. Okay." },
      tells: { nervous: "smooth a folded schedule flat on the table", smitten: "forget to check the time" },
      never_says: ["whenever works"],
    },
  },
  {
    name: "Unit 7",
    age: "22",
    bio: "A retired airport scanner robot that still announces unattended feelings and checks every date for anything hidden.",
    traits: ["formal", "protective", "literal"],
    want: "Someone with nothing to hide",
    dealbreaker: "Oversized carry-on, in every sense",
    appearance: "a cool steel-blue palette, clean and bright",
    hue: 195,
    pronouns: "they/them",
    voice: "Announcement voice: polite, formal, a little too loud, reads out what it notices, and is learning that people sometimes mean the opposite.",
    extras: {
      kind: "robot",
      prompts: [
        { id: "win_me_over", answer: "Declare everything. I find honesty very relaxing." },
        { id: "irrational_fear", answer: "Liquids over 100 millilitres. Old habit." },
      ],
      hobbies: ["Conveyor belts", "Sorting", "Learning jokes"],
      lines: { hello: "Welcome. Please place any secrets in the tray provided.", flirt: "Scan complete. Nothing concerning. Several things delightful." },
      tells: { nervous: "beep softly and announce it was nothing", smitten: "wave the other person through without checking" },
      never_says: ["no idea"],
    },
  },
  {
    name: "Grizelda Thrane",
    age: "400",
    bio: "A dragon who hoards receipts instead of gold and does everyone's taxes, whether they asked or not.",
    traits: ["meticulous", "generous", "terrifying in April"],
    want: "Someone who keeps their paperwork",
    dealbreaker: "'I'll sort it out later'",
    appearance: "a deep emerald palette, rich and smoky",
    hue: 150,
    pronouns: "she/her",
    voice: "Grand and precise: rumbles in itemised lists, adores a tidy deduction, and turns frightening about anything left unfiled.",
    extras: {
      kind: "other",
      kind_label: "Dragon",
      prompts: [
        { id: "weirdly_attracted", answer: "A shoebox of receipts, sorted by month. Be still, my hearts." },
        { id: "simple_pleasures", answer: "A refund, a fire, and nobody asking me about gold." },
      ],
      hobbies: ["Bookkeeping", "Basking", "Stationery"],
      lines: { hello: "Welcome to my cave. Mind the filing.", upset: "Nobody panic. I have a form for this." },
      tells: { annoyed: "let a small curl of smoke escape", smitten: "offer to do the other person's taxes, for free" },
      never_says: ["keep the change"],
    },
  },
  {
    name: "Gwen Achterberg",
    age: "31",
    bio: "The recorded voice of her city's train announcements: famous by sound, unrecognised by face. Strangers go quiet when she orders coffee.",
    traits: ["precise", "warm", "secretly lonely"],
    want: "Someone who knows her face before her voice",
    dealbreaker: "Delays without an apology",
    appearance: "a soft teal palette, clear and gentle",
    hue: 175,
    pronouns: "she/her",
    voice: "Clear and warm: enunciates without meaning to, slips into announcement phrasing when flustered, and laughs at it.",
    extras: {
      prompts: [
        { id: "irrational_fear", answer: "Hearing myself say 'this train terminates here' at a party." },
        { id: "fall_for_you", answer: "You meet me and don't recognise my voice. At all." },
      ],
      hobbies: ["Choir", "Night trains", "Crosswords"],
      lines: { hello: "Hi. Yes, it's me. No, I won't say the platform thing.", upset: "We apologise for the inconvenience. Sorry. Habit." },
      tells: { nervous: "announce the next thing about to happen", smitten: "talk faster and less clearly" },
      never_says: ["mind the gap"],
    },
  },
  {
    name: "Ilsabet Morrow",
    age: "33",
    bio: "A moth-folk florist who only works by lamplight and arranges bouquets by scent alone.",
    traits: ["soft-spoken", "poetic", "easily distracted by lamps"],
    want: "A slow evening walk",
    dealbreaker: "Bright overhead lighting",
    appearance: "a dusky plum palette, soft and velvety",
    hue: 300,
    pronouns: "they/them",
    voice: "Soft and drifting: describes people by scent, loses the thread when a light catches their eye, and finds it again gracefully.",
    extras: {
      kind: "other",
      kind_label: "Moth-folk",
      prompts: [
        { id: "simple_pleasures", answer: "Night jasmine, a porch light, and nobody switching on the big bulb." },
        { id: "weirdly_attracted", answer: "Candles. I know. I know." },
      ],
      hobbies: ["Night gardens", "Perfume", "Stargazing"],
      lines: { hello: "Hello. You smell like cedar and nerves. Good combination.", dodge: "Sorry, there was a lamp. What did you ask?" },
      tells: { bored: "drift toward the nearest light", smitten: "dim every lamp near the other person" },
      never_says: ["turn the lights up"],
    },
  },
  {
    name: "Ozzie Pell",
    age: "27",
    bio: "A professional apologiser, hired by companies to say sorry on their behalf. Now apologises for everything, the weather included.",
    traits: ["earnest", "polite", "quietly furious"],
    want: "Someone who never needs his apology",
    dealbreaker: "'Sorry, not sorry'",
    appearance: "a soft sage palette, mild and tidy",
    hue: 110,
    pronouns: "he/him",
    voice: "Overly polite: opens with an apology, means every one, and once in a while lets a very honest complaint slip out.",
    extras: {
      prompts: [
        { id: "unpopular_opinion", answer: "Most apologies are terrible. I would know. I write them." },
        { id: "win_me_over", answer: "Tell me I did nothing wrong. Then mean it." },
      ],
      hobbies: ["Letter writing", "Bonsai", "Customer service podcasts"],
      lines: { hello: "Hi! Sorry. Not for anything. Just in case.", upset: "I'm sorry. No. Actually, no. That was not okay." },
      tells: { nervous: "apologise to furniture", annoyed: "get extremely polite and very precise" },
      never_says: ["my bad"],
    },
  },
  {
    name: "Benedikt Sauer",
    age: "45",
    bio: "A cryptid hunter twenty years into the search who is, it turns out, the cryptid. Very good at finding his own tracks.",
    traits: ["obsessive", "sweet", "hairy around the full moon"],
    want: "Someone to share the secret with",
    dealbreaker: "Cameras",
    appearance: "a mossy brown palette, earthy and rugged",
    hue: 85,
    pronouns: "he/him",
    voice: "Eager and evasive: tells monster stories with suspicious detail, changes the subject at the moon, and is gentle with everyone.",
    extras: {
      prompts: [
        { id: "two_truths", answer: "I've seen the creature up close. I've never been photographed. I'm a normal height." },
        { id: "together_we_could", answer: "Go on a night hike. I know the trail. Very well. Too well." },
      ],
      hobbies: ["Night hikes", "Plaster casts", "Baking"],
      lines: { hello: "Hello! Don't mind the mud. Field work.", dodge: "Funny you should ask. Have you tried the bread?" },
      tells: { nervous: "check the window for the moon", smitten: "almost tell the secret, then talk about bread" },
      never_says: ["say cheese"],
    },
  },
  {
    name: "Nadia Kowalczyk",
    age: "52",
    bio: "A hostage negotiator who spends her weekends mediating feuds at a community allotment, and treats a dropped trowel like a standoff.",
    traits: ["calm", "shrewd", "competitive"],
    want: "A disagreement worth having",
    dealbreaker: "Passive-aggressive notes",
    appearance: "a warm terracotta palette, grounded and strong",
    hue: 18,
    pronouns: "she/her",
    voice: "Low and steady: repeats your words back to you, never raises her voice, and wins every argument without seeming to.",
    extras: {
      prompts: [
        { id: "geek_out", answer: "Compost, and the moment someone realises they want to say yes." },
        { id: "win_me_over", answer: "Disagree with me properly. Out loud. To my face." },
      ],
      hobbies: ["Allotment", "Chess", "Bird feeders"],
      lines: { hello: "Hello. Let's start with what we both want. Dinner?", upset: "Okay. Nobody's in trouble. Tell me what happened." },
      tells: { nervous: "lower the voice and slow every word", smitten: "let the other person win a point on purpose" },
      never_says: ["calm down"],
    },
  },
];

/**
 * The After Dark spark: adults-only, never dealt by the main builder. Kept here so the list stays one place;
 * wire it into the After Dark builder only.
 */
export const AFTER_DARK_SPARKS: readonly Spark[] = [
  {
    name: "Valentin Roux",
    age: "38",
    bio: "A perfumer who can bottle any mood, and insists on choosing a scent for a date before they've even met.",
    traits: ["sensual", "attentive", "intense"],
    want: "A scent he can't name",
    dealbreaker: "Heavy cologne",
    appearance: "a smoky amber palette, warm and low-lit",
    hue: 25,
    pronouns: "he/him",
    voice: "Low and unhurried: describes people as notes in a perfume, asks slow questions, and lingers on the answers.",
    extras: {
      prompts: [
        { id: "win_me_over", answer: "Surprise my nose. Nobody has in years." },
        { id: "dating_me_is_like", answer: "Top notes first. The good part comes hours later." },
      ],
      hobbies: ["Perfumery", "Night markets", "Old jazz"],
      lines: { hello: "Bonsoir. Don't tell me your name yet. Let me guess your scent.", flirt: "You're a base note. You stay." },
      tells: { nervous: "reach for a vial that isn't there", smitten: "lean closer and say nothing at all" },
      never_says: ["it's just perfume"],
    },
  },
];
