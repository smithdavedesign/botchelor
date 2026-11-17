/**
 * Roleplays for a chapter (David, 2026-10-25: after picking where in Set the scene, pick "a roleplay for the chapter in
 * the same modal"): who the two of them are to each other until the chapter closes. The classic setups adult apps sort
 * their scenes by (neighbours, boss and employee, the delivery, roommates, strangers…), kept inside After Dark's lines:
 * two adults who both want to be there, the attraction mutual and said out loud wherever one has a say over the other's
 * work, never family or step-family, never a babysitter, teacher and student or school, no one paid for it, drunk,
 * trapped or kept from saying no (tests/after-dark-roleplays.test.ts runs every one through checkAdultText and the theme
 * check).
 *
 * A roleplay with two roles says who plays which; the viewer can swap them. Stored on the scene with the chapter it was
 * set for (lib/adult/scenes.ts setRoleplay), so it ends when the chapter does. Pure and client-safe.
 *
 * Each of the show's own has a scene card (lib/scene-cards.ts, David 2026-11-17): the story behind it, which the writer
 * reads when it's picked (how it starts, what each of them wants, where it can go, its tone, three ways it can open).
 * A card is a STORY card: stakes, wants, banter and what's in the way. It never describes a sex act and has no explicit
 * word in it (tests/scene-cards.test.ts holds every one to adultCardIssue); how far a night goes is still the scene's
 * own writer's and its stage rules' to decide. A person's own roleplay (lib/studio/library.ts) has no card.
 */
import { fillCardText, openingOf, type SceneCard } from "../scene-cards";
import type { SceneCategory } from "./scene-catalog";

export type Roleplay = {
  id: string;
  title: string;
  icon: string;
  category: SceneCategory;
  /** The situation, with {a} and {b} for whoever plays each role (or the two of them, when there are no roles). */
  premise: string;
  /** The two roles, the first for {a}; null when they're the same to each other (strangers, roommates). */
  roles: readonly [string, string] | null;
  /**
   * What each role wears, in the same order: they start the chapter in character (David, 2026-11-10: Captain and pilot
   * drew her in her string bikini, from her own outfit). Pieces a picture can draw, for anyone of any gender.
   */
  costumes?: readonly [string, string];
  /** The story behind it (lib/scene-cards.ts), for the writer. Every one of the show's has one; a person's own has none. */
  card?: SceneCard;
};
/** One of the show's own: it always comes with its card. */
export type HouseRoleplay = Roleplay & { card: SceneCard };

export const ROLEPLAYS: readonly HouseRoleplay[] = [
  {
    id: "neighbours", title: "The neighbour next door", icon: "🚪", category: "romance", roles: ["the neighbour who knocks", "the neighbour who answers"], costumes: ["a soft knit sweater and jeans", "comfortable loungewear, barefoot"],
    premise: "{a} and {b} are neighbours who've flirted in the hallway for months. Tonight {a} knocks with a flimsy excuse, and both of them stop pretending it's about the excuse.",
    card: {
      setup: "Months of hallway small talk and one borrowed corkscrew. Tonight {a} knocks on {b}'s door holding a parcel that was delivered to the right flat all along.",
      wants: [
        "{a} wants to stop inventing reasons to knock; saying the real one out loud is harder than carrying a parcel.",
        "{b} wants {a} to stay past the doorway for once; the excuse is so thin it is hard not to tease.",
      ],
      beats: [
        "The excuse gets examined, and it does not hold up.",
        "One of them lists every earlier excuse, in order, with dates.",
        "The door is still open, and someone has to decide which side of it the evening happens on.",
        "They say what the hallway conversations were really about.",
      ],
      tone: "warm, teasing, months of almost finally said out loud",
      openings: [
        "{a} knocks with a parcel in hand and forgets the line that went with it.",
        "{b} opens the door before the second knock, as if waiting behind it.",
        "{b} reads the label on the parcel and asks how long this excuse took to think up.",
      ],
    },
  },
  {
    id: "boss", title: "Boss and employee, after hours", icon: "💼", category: "afterhours", roles: ["the boss", "the employee"], costumes: ["a sharp tailored suit", "smart office clothes, a crisp shirt and trousers, a lanyard"],
    premise: "Late at the office, everyone else gone home. {a} runs the team and {b} is on it. The attraction has been there for months; tonight both of them say so out loud, and both are clear that nobody's job depends on the answer.",
    card: {
      setup: "The office is dark except for two desks, and the deadline went out an hour ago. {b} says it first, out loud. {a} says it back and adds that nobody's job rides on any answer given tonight.",
      wants: [
        "{a} wants to be sure {b} feels free to walk out at any point; the reporting line is the thing in the way, and {a} keeps naming it.",
        "{b} wants to be met as an equal for one evening; {a} is so careful that it is almost funny.",
      ],
      beats: [
        "They agree what changes on Monday: nothing, either way, and they say so twice.",
        "The careful one gets teased for being careful.",
        "Titles get dropped, first as a joke and then for real.",
        "Each admits when it started, and the dates do not match.",
      ],
      tone: "after-hours, careful, months of restraint finally allowed to talk",
      openings: [
        "{b} closes a laptop and says there is something that is not about the deadline.",
        "{a} asks whether {b} wants the honest answer or the professional one.",
        "{a} and {b} are the last two in the building, and both have noticed.",
      ],
    },
  },
  {
    id: "delivery", title: "The last delivery", icon: "📦", category: "strangers", roles: ["the one making the delivery", "the one who ordered"], costumes: ["a courier's uniform polo and cap, a delivery bag on one shoulder", "a soft robe over loungewear"],
    premise: "The last delivery of the night. {a}'s shift is over the moment the door opens, {b} invites them in, and both of them know the order was never really the point.",
    card: {
      setup: "The last drop of the shift, and the app shows {a} clocked off the second the door opens. {b} has ordered from the same place every Thursday for a reason that is not the food.",
      wants: [
        "{a} wants to find out whether the Thursday orders mean what they seem to; asking a customer is not done, and {a} is no longer on the clock.",
        "{b} wants to invite {a} in without it sounding like a line; it has been rehearsed too often to sound natural.",
      ],
      beats: [
        "The order gets handed over, and neither moves.",
        "One of them admits how long the Thursday habit has been about the other.",
        "The uniform cap comes off, and the conversation changes with it.",
        "They compare what each thought the other was thinking, all those Thursdays.",
      ],
      tone: "playful, a little nervous, a running joke turning sincere",
      openings: [
        "{a} holds out the bag and says that makes this the last delivery of the night.",
        "{b} opens the door already smiling and asks whether the shift is over.",
        "{a} reads the order back, and {b} admits to not being hungry.",
      ],
    },
  },
  {
    id: "handyman", title: "The handyman", icon: "🔧", category: "strangers", roles: ["the handyman", "the homeowner"], costumes: ["work boots, jeans and a fitted work shirt, a tool belt", "relaxed clothes for an evening at home"],
    premise: "{a} came round to fix a leak at {b}'s place. The job's done, the tools are packed away, and neither of them is in any hurry for {a} to leave.",
    card: {
      setup: "The leak is fixed, the job is signed off and the toolbox is shut. {b} puts the kettle on anyway, and {a} has not picked up the van keys.",
      wants: [
        "{a} wants to stay, now that the job is done and it is plainly not about the job; leaving on time has always been the rule.",
        "{b} wants {a} to know the leak could have waited a week; admitting to having rushed the call is a little embarrassing.",
      ],
      beats: [
        "Tea gets made, and the talk drifts off plumbing.",
        "One of them points out the work is finished, and neither treats that as a reason to go.",
        "The homeowner admits the tap was not the only reason for the call.",
        "They agree, out loud, that this part has nothing to do with the job and is up to both of them.",
      ],
      tone: "easy, warm, practical people being unexpectedly direct",
      openings: [
        "{a} wipes both hands on a rag and says that should hold for years.",
        "{b} sets down two mugs and says there is no hurry, unless there is.",
        "{a} is closing the toolbox when {b} asks what else needs looking at around here.",
      ],
    },
  },
  {
    id: "roommates", title: "Roommates", icon: "🛋️", category: "nightin", roles: null,
    premise: "{a} and {b} share a flat: one bathroom, very thin walls, and months of pretending not to notice each other. Tonight neither pretends.",
    card: {
      setup: "One flat, one bathroom and walls like paper. {a} and {b} meet in the kitchen at midnight, both pretending to be there for a glass of water.",
      wants: [
        "{a} wants to say it without wrecking a good flatshare; the lease has months left to run.",
        "{b} wants to know whether the looks over breakfast were real; asking risks every breakfast after.",
      ],
      beats: [
        "They talk about the washing-up rota as if that were the subject.",
        "One of them admits to hearing the other pacing, most nights.",
        "The what-if gets said: what happens to the flat if this goes wrong.",
        "They agree on a rule for tomorrow before deciding anything about tonight.",
      ],
      tone: "close quarters, wry, a secret both of them already know",
      openings: [
        "{a} is at the sink. {b} comes in and reaches past for a glass.",
        "{b} asks whether {a} can't sleep either.",
        "{a} and {b} both open the fridge to have something to look at.",
      ],
    },
  },
  {
    id: "strangers-bar", title: "Strangers at the bar", icon: "🍸", category: "strangers", roles: null,
    premise: "{a} and {b} have never met. One drink at the bar becomes a long conversation, and the conversation becomes a question neither wants to leave unasked.",
    card: {
      setup: "A quiet bar on a weeknight, two stools apart. {a} and {b} have each finished one drink and neither has reached for a coat.",
      wants: [
        "{a} wants the conversation to keep going past last orders; there is no good excuse left except the true one.",
        "{b} wants to be asked, plainly; hinting has been fun but it is getting late.",
      ],
      beats: [
        "Small talk runs out, and something real takes its place.",
        "One of them moves a stool closer and names why.",
        "They trade the reasons each nearly stayed home tonight.",
        "The bartender calls last orders, and the question is still on the bar between them.",
      ],
      tone: "low-lit, direct, two adults enjoying saying what they mean",
      openings: [
        "{a} asks what {b} is drinking, which was the only opening line available.",
        "{b} slides a bowl of olives halfway between the two stools, as an offer.",
        "{a} and {b} catch each other looking in the mirror behind the bottles.",
      ],
    },
  },
  {
    id: "no-names", title: "Strangers, no names", icon: "🎭", category: "strangers", roles: null,
    premise: "{a} and {b} agree on one rule: no names, no questions about real life. Just tonight, as whoever they want to be.",
    card: {
      setup: "One rule, agreed before anything else: no names, no questions about real life. {a} and {b} shake on it across a small table, and either can drop the game with a word.",
      wants: [
        "{a} wants a night as someone unburdened; the real self keeps leaking into the invented one.",
        "{b} wants to be chosen without a history attached; it is tempting to break the rule and ask for {a}'s real name.",
      ],
      beats: [
        "Each invents who they are tonight, and the inventions are revealing.",
        "A true detail slips out, and the other one chooses not to pounce on it.",
        "They add a second rule together.",
        "One of them asks whether the rule still stands, and waits for the answer.",
      ],
      tone: "mysterious, playful, honesty by way of pretending",
      openings: [
        "{a} offers a hand and an obviously borrowed name.",
        "{b} says the only question allowed is what tonight should be.",
        "{a} and {b} agree on the rule, and both look relieved.",
      ],
    },
  },
  {
    id: "hotel-mixup", title: "The hotel mix-up", icon: "🛎️", category: "getaway", roles: null,
    // Worded to read right from either side as "you" (lib/roleplays.ts premiseForYou; Step in shows it that way): "{b}
    // keys" came out "you key".
    premise: "The hotel gave {a} and {b} the same room, a key card each. Reception can't fix it until morning, and after an hour of talking neither wants it fixed.",
    card: {
      setup: "Two key cards, one room number and a night clerk who can fix it in the morning. {a} and {b} have been polite about it for an hour, and the politeness has turned into talking.",
      wants: [
        "{a} wants to keep talking and is running out of reasons to stay in the corridor; the lobby sofa was offered and nobody took it.",
        "{b} wants the mix-up to be the best thing the hotel did this week; saying so first feels like a risk.",
      ],
      beats: [
        "They negotiate the room like diplomats: who gets the desk, who gets the window.",
        "The mistake stops being the topic.",
        "One of them offers to take the lobby sofa, and the other says, plainly, to stay.",
        "They agree either of them can call the front desk at any point, and neither reaches for the phone.",
      ],
      tone: "accidental, courteous, strangers who would rather not fix the problem",
      openings: [
        "{a} holds up a key card, and {b} holds up its twin.",
        "{b} offers to toss a coin for the room, and nobody has a coin.",
        "{a} and {b} reach the same door from opposite ends of the corridor.",
      ],
    },
  },
  {
    id: "photo-shoot", title: "The photo shoot", icon: "📸", category: "afterhours", roles: ["the photographer", "the model"], costumes: ["dark casual clothes, a camera on a strap over one shoulder", "the shoot's look, a fitted designer outfit"],
    premise: "A late shoot wraps. {a}, the photographer, and {b}, the model, are both off the clock, and they admit the chemistry the camera kept catching.",
    card: {
      setup: "The lights are cooling and the crew has gone. {a} is packing lenses slowly, and {b} is back in a coat and in no hurry. Nobody is on the clock.",
      wants: [
        "{a} wants to say what the camera noticed all day, now that there is no job to hide behind; it has to be a shared decision.",
        "{b} wants to be looked at without a lens in the way; the work is finished, so nothing rides on asking.",
      ],
      beats: [
        "They go through the day's frames, and one picture gives the game away.",
        "The camera gets put down, deliberately.",
        "Each says when they first noticed, and whether it was mutual is settled out loud.",
        "They agree the shoot is over and this is something else.",
      ],
      tone: "after-hours, observant, professional distance set aside by agreement",
      openings: [
        "{a} turns the camera screen around to show {b} the last frame of the day.",
        "{b} asks what {a} saw through the lens that the client will never see.",
        "{a} switches off the last light, and {b} says not to hurry.",
      ],
    },
  },
  {
    id: "bodyguard", title: "The bodyguard", icon: "🕶️", category: "mystery", roles: ["the bodyguard", "the one they protect"], costumes: ["a black suit, a white shirt and an earpiece", "an elegant evening outfit"],
    // Either side as "you": "asks {a} to, and" left two verbs hanging once one of them was "you".
    premise: "{a} has guarded {b} for a year without once crossing the line. Tonight, safe behind a locked door, {b} asks {a} to cross it, and {a} has wanted to for months.",
    card: {
      setup: "A year of {a} holding doors and checking rooms. Tonight, with the day's work over, {b} says the thing out loud and adds that the job does not depend on the answer.",
      wants: [
        "{a} wants to answer honestly for once; a year of never crossing the line is a hard habit to set down.",
        "{b} wants {a} to choose freely, as a person and not as staff; that is why the contract is the first thing on the table.",
      ],
      beats: [
        "The earpiece comes out, and the conversation that follows is off duty.",
        "They list the times one of them almost said something.",
        "The one who is protected offers a way to say no that costs nothing.",
        "The bodyguard says what a year of watching someone that closely does.",
      ],
      tone: "restrained, protective, a year of professionalism finally answered",
      openings: [
        "{b} asks {a} to sit down for once, as a request and not an instruction.",
        "{a} checks the lock out of habit, and {b} says the room is the safest it has ever been.",
        "{a} takes out the earpiece and sets it on the table.",
      ],
    },
  },
  {
    id: "celebrity", title: "The star and the stranger", icon: "⭐", category: "nightlife", roles: ["the famous one", "the one who doesn't recognise them"], costumes: ["designer clothes, sunglasses pushed up into the hair", "everyday casual clothes"],
    // Either side as "you": an adverb before the verb ("{b} genuinely has") left it "you genuinely has".
    premise: "{a} is famous; {b} has no idea at all who {a} is, and {a} finds that irresistible. One night of being nobody special.",
    card: {
      setup: "A corner of a loud party where nobody is looking. {b} has just asked {a} what {a} does for work, sincerely, and {a} has not been asked that in years.",
      wants: [
        "{a} wants one night of being nobody special; it would be easy to drop a hint and ruin it.",
        "{b} wants to know why {a} keeps dodging simple questions; the dodging is half the charm.",
      ],
      beats: [
        "The famous one invents an ordinary job, badly.",
        "Someone across the room nearly gives it away, and they move to the balcony.",
        "The one who does not know says something honest that fans never do.",
        "The truth gets offered, and the listener gets to decide whether it changes anything.",
      ],
      tone: "light, incognito, the relief of not being recognised",
      openings: [
        "{b} asks, sincerely, what {a} does for work.",
        "{a} gives a first name and watches it mean nothing to {b}.",
        "{a} pushes a pair of sunglasses up, and {b} has no idea even then.",
      ],
    },
  },
  {
    id: "exes", title: "Exes, one more night", icon: "🔁", category: "second", roles: null,
    premise: "{a} and {b} broke up years ago. They run into each other, the old pull is right there, and they decide, both of them, on one more night.",
    card: {
      setup: "Years since the break-up and one chance meeting at a friend's opening. {a} and {b} have drifted to the same quiet end of the room, with the old ease right there.",
      wants: [
        "{a} wants to know whether the pull is nostalgia or still real; the reasons it stopped have not gone anywhere.",
        "{b} wants one honest evening without reopening the argument; {a} remembers everything, which helps and does not.",
      ],
      beats: [
        "They catch up carefully, and then less carefully.",
        "An old in-joke lands, and both notice how easily.",
        "The reason it stopped gets named, without blame this time.",
        "They agree on what tonight is and is not, out loud, before anything else.",
      ],
      tone: "bittersweet, knowing, two people who can still finish each other's sentences",
      openings: [
        "{a} says {b}'s name the old way, by accident.",
        "{b} orders {a}'s usual from memory and gets it right.",
        "{a} and {b} both start with how long it has been, and both have the number ready.",
      ],
    },
  },
  {
    id: "friends", title: "Best friends, finally", icon: "🤝", category: "romance", roles: null,
    premise: "{a} and {b} have been best friends for years. Tonight one of them finally says it, and the other has been waiting to hear it.",
    card: {
      setup: "The usual sofa, the usual film neither is watching. {a} and {b} have been best friends for years, and tonight somebody has stopped laughing at the right places.",
      wants: [
        "{a} wants to say it without losing the friendship if it lands wrong; years of jokes make it hard to sound serious.",
        "{b} wants to hear it said and has been hoping for longer than seems reasonable; saying it first feels impossible.",
      ],
      beats: [
        "A joke falls flat because one of them meant it.",
        "They try to talk about it sideways, through other people's stories.",
        "Someone says the real sentence, and the other does not laugh.",
        "They promise what stays the same whatever comes next.",
      ],
      tone: "tender, nervous, years of friendship holding its breath",
      openings: [
        "{a} pauses the film and says there is something that is not about the film.",
        "{b} asks why {a} has gone quiet.",
        "{a} and {b} reach for the same bowl and both say sorry, which never happens.",
      ],
    },
  },
  {
    id: "rivals", title: "Rivals", icon: "⚔️", category: "romance", roles: null,
    premise: "{a} and {b} have competed for everything for years: clients, awards, the last word. Tonight the rivalry turns into something they both enjoy far more.",
    card: {
      setup: "Another awards dinner, the same two names on the shortlist. {a} and {b} are seated side by side by someone with a sense of humour.",
      wants: [
        "{a} wants to win the argument, the award and {b}'s full attention, in any order; admitting the last one is the hard part.",
        "{b} wants to find out what years of competing were really about; conceding a single point has never once happened.",
      ],
      beats: [
        "They score points off each other's speeches.",
        "A compliment slips out, and it gets treated as a tactic.",
        "The result is announced, and it matters less than either expected.",
        "One of them proposes a new contest, with the terms agreed by both.",
      ],
      tone: "sharp, competitive, sparring that has always been about something else",
      openings: [
        "{a} reads the place cards and laughs once, without humour.",
        "{b} raises a glass and says may the best one win.",
        "{a} and {b} applaud each other's nomination with identical thin smiles.",
      ],
    },
  },
  {
    id: "blind-date", title: "Blind date", icon: "🙈", category: "romance", roles: null,
    premise: "A friend set {a} and {b} up. Neither expected much, and both are surprised how fast the evening stops feeling like a first date.",
    card: {
      setup: "A friend picked the restaurant, the time and, apparently, each other. {a} and {b} both arrived expecting to be polite for an hour.",
      wants: [
        "{a} wants to get through dinner and report back kindly; it is inconvenient how good the company is.",
        "{b} wants to know whether the friend was right for once; admitting it means the friend never lets it go.",
      ],
      beats: [
        "They compare what the friend told each of them, and the descriptions are suspicious.",
        "The first-date script runs out early, and the real conversation starts.",
        "One of them says this is not going the way they planned.",
        "They draft the text to the friend together, and argue about how much to admit.",
      ],
      tone: "bright, surprised, low expectations being pleasantly ruined",
      openings: [
        "{a} stands to shake hands and knocks a fork off the table.",
        "{b} says the friend described {a} as a good listener, which sounded like a warning.",
        "{a} and {b} recognise each other from a description that did neither justice.",
      ],
    },
  },
  {
    id: "wedding", title: "Wedding guests", icon: "💍", category: "getaway", roles: null,
    premise: "{a} and {b} are guests at a friend's wedding, seated together at the singles' table. The reception winds down and neither wants the night to end.",
    card: {
      setup: "The singles' table at a friend's wedding, after the speeches. {a} and {b} have been making fun of the playlist together since the first course.",
      wants: [
        "{a} wants the reception not to be over yet; the band is on its last set.",
        "{b} wants to be asked to dance by the one person here worth dancing with; the song choices keep being terrible.",
      ],
      beats: [
        "They rate the speeches.",
        "A slow song comes on, and neither makes a joke about it.",
        "They slip outside for air and keep talking.",
        "The band packs up, and one of them says the evening does not have to.",
      ],
      tone: "festive, wry, borrowed romance turning into their own",
      openings: [
        "{a} leans over to say the place cards were clearly arranged by an optimist.",
        "{b} offers the last of the cake, and {a} accepts with a toast to the couple.",
        "{a} and {b} are the only two still at the table when the dance floor fills.",
      ],
    },
  },
  {
    id: "rival-spies", title: "Rival spies", icon: "🕵️", category: "mystery", roles: null,
    premise: "{a} and {b} are spies for rival agencies, after the same file, who keep meeting in the same places. Tonight they call a truce, and the truce is very convincing.",
    card: {
      setup: "The same hotel bar in yet another city. {a} and {b} both know about the file, and both ordered for the other before sitting down.",
      wants: [
        "{a} wants a truce that is not a tactic for once; trusting a rival goes against all the training.",
        "{b} wants to know whether {a}'s interest is in the file or the company; both would be flattering and only one is safe.",
      ],
      beats: [
        "They trade a real fact each, as a deposit.",
        "One of them puts the file on the table, unopened.",
        "They compare the times each could have won and chose not to.",
        "The truce gets terms: what is said tonight stays out of both reports.",
      ],
      tone: "cool, intimate, professional distrust wearing thin",
      openings: [
        "{a} slides a drink along the bar, already the right one.",
        "{b} says the file can wait until morning, as an opening offer.",
        "{a} and {b} take the two stools that face away from the room, for once, on purpose.",
      ],
    },
  },
  {
    id: "vampire", title: "The vampire's invitation", icon: "🦇", category: "fantasy", roles: ["the vampire", "the guest"], costumes: ["dark velvet and silk, old-fashioned and elegant, a high collar", "evening clothes for a party at an old manor"],
    premise: "{a} is a centuries-old vampire who never enters without being asked; {b} is the guest who finally asks. Everything happens only by invitation.",
    card: {
      setup: "A doorway at midnight, and {a} waiting on the far side of it with centuries of patience. {b} came to the door to say the invitation out loud.",
      wants: [
        "{a} wants to be asked in, plainly and freely; centuries of manners forbid so much as a hint.",
        "{b} wants to do the inviting on purpose and with open eyes; the old stories make it sound more dangerous than {a} has ever been.",
      ],
      beats: [
        "The guest asks what the rule about invitations is really for.",
        "The vampire explains, and it turns out to be about consent older than the house.",
        "Each invitation gets asked for and given on its own: the threshold, the chair by the fire, the next question.",
        "The guest asks what centuries of waiting to be asked have been like.",
      ],
      tone: "gothic, courtly, everything by invitation",
      openings: [
        "{b} opens the door and says the words carefully, like a spell.",
        "{a} bows from the threshold and waits to be asked twice.",
        "{a} asks whether {b} is certain.",
      ],
    },
  },
  {
    id: "royal", title: "The royal and the guard", icon: "👑", category: "fantasy", roles: ["the royal", "the royal guard"], costumes: ["rich royal clothes with gold embroidery and a fine circlet", "a royal guard's dress uniform with polished buttons"],
    premise: "In a candlelit castle, {a} is royalty and {b} the guard sworn to stand outside the door. Tonight {a} asks {b} to come inside, and {b} chooses to.",
    card: {
      setup: "A candlelit corridor and a door {b} has stood outside for years. Tonight {a} opens it and asks, as a question and not a command, whether {b} would come in.",
      wants: [
        "{a} wants company that is chosen and not ordered; rank makes every request sound like a decree.",
        "{b} wants to answer as a person and not as a post; the oath is about the door, not about what {b} feels.",
      ],
      beats: [
        "The royal says plainly that no is a safe answer, and that the post is safe either way.",
        "The guard sets the halberd against the wall, as a decision.",
        "Titles are dropped, with some difficulty and some laughter.",
        "They talk about the years of standing on either side of one door.",
      ],
      tone: "candlelit, formal, duty giving way to choice",
      openings: [
        "{a} opens the door and asks whether {b} would rather be relieved for the night or invited in.",
        "{b} says the corridor is secure, and {a} says that was not the question.",
        "{a} sets a second chair by the fire where {b} can see it from the door.",
      ],
    },
  },
  {
    id: "starship", title: "Captain and pilot", icon: "🚀", category: "scifi", roles: ["the captain", "the pilot"], costumes: ["a fitted dark captain's uniform with rank insignia on the collar", "a zip-front flight suit with mission patches"],
    premise: "Months into a deep-space voyage, {a}, the captain, and {b}, the pilot, both off duty for the night shift, stop pretending the long looks on the bridge meant nothing.",
    card: {
      setup: "Night shift on a long voyage, the bridge on automatic. {a} and {b} are both off duty, and {a} has just said that rank stays on the bridge and any answer is a safe one.",
      wants: [
        "{a} wants to stop pretending the long looks meant nothing; the captain's chair makes it complicated to go first.",
        "{b} wants to be more than the best pilot aboard to {a}; months of deep space have made everything unsaid very loud.",
      ],
      beats: [
        "They agree, out loud, that off duty means off duty.",
        "One of them brings up a moment on the bridge that both remember differently.",
        "The ship interrupts with something minor, and they handle it like the team they are.",
        "They work out what changes at the next shift, and what does not.",
      ],
      tone: "quiet, starlit, long restraint in a small ship",
      openings: [
        "{a} finds {b} in the observation lounge and asks permission to join, which is new.",
        "{b} says the autopilot has it, for hours.",
        "{a} and {b} are both in off-duty clothes for once, and both notice.",
      ],
    },
  },
  // The thirteen below came from David's census of 38,912 public character listings (2026-11-17): the tropes people
  // look for most (rivals and enemies, cold then warm, jealous, gentle-dominant, married partners, hero and villain,
  // arranged, non-human), each written inside the lines at the top of this file. The census's school, family and
  // famous-people themes are left out on purpose.
  {
    id: "your-rules", title: "Your rules tonight", icon: "🗝️", category: "romance", roles: ["the one who leads", "the one who follows"], costumes: ["a crisp shirt with the sleeves rolled to the elbow", "something soft and comfortable, chosen for the evening"],
    premise: "Tonight {a} leads and {b} follows, because it was all agreed out loud first: what is on the table, what is not, and one word that stops everything the moment either says it. Warm and careful, never cruel.",
    card: {
      setup: "Two chairs pulled close and the rules already said out loud. {a} leads tonight and {b} follows, and the word that stops everything is written on a card on the table where both can see it.",
      wants: [
        "{a} wants to lead well, which means reading {b} closely and checking in; the worry about getting it wrong is the thing in the way.",
        "{b} wants to hand over the decisions for one evening and trust where they go; letting go of the habit of running everything takes a while.",
      ],
      beats: [
        "They go over the rules once more, and add one.",
        "The one who follows tests the stop word on purpose, and everything stops, exactly as promised.",
        "The one who leads asks a question and waits for a real answer before going on.",
        "They trade notes on what worked, like two people comparing a dance.",
      ],
      tone: "warm, deliberate, trust built one check-in at a time",
      openings: [
        "{a} asks {b} to say the stop word once, just to hear it.",
        "{b} says the rules back from memory, and {a} nods at each one.",
        "{a} holds out a hand and waits for {b} to take it.",
      ],
    },
  },
  {
    id: "dons-truce", title: "The truce", icon: "♟️", category: "mystery", roles: null,
    premise: "{a} and {b} run rival outfits and have circled each other for years. Tonight the two heads negotiate a truce in person, alone in a private room, as equals: no seconds, no weapons, and nobody owes anybody anything.",
    card: {
      setup: "A private dining room, both sets of people sent home. {a} and {b} sit at opposite ends of a table that is too long, and somebody has just moved a chair closer.",
      wants: [
        "{a} wants a truce that does not need lawyers; years of watching {b} work have turned into something other than strategy.",
        "{b} wants to be dealt with face to face and not through messengers; a long respect for the other side has been the best-kept secret in either outfit.",
      ],
      beats: [
        "They divide the city on a napkin, and it takes no time at all.",
        "With business done, neither stands up.",
        "One of them says how long the watching has been mutual.",
        "They set one rule for tonight: nothing said here is leverage tomorrow.",
      ],
      tone: "noir, measured, two equals with nothing left to prove",
      openings: [
        "{a} pours two glasses and leaves the bottle in the middle of the table.",
        "{b} says the terms are easy and the conversation after them is not.",
        "{a} and {b} each send a driver home with the same gesture, at the same time.",
      ],
    },
  },
  {
    id: "said-no", title: "The one who said no", icon: "🖋️", category: "afterhours", roles: ["the one with the fortune", "the one who said no"], costumes: ["an understated, very expensive suit", "a favourite jacket, worn on purpose"],
    premise: "{a} is very rich. Last week {b} turned down {a}'s business offer in front of a full room, and {a} asked for a dinner to find out why. The offer is off the table tonight: nothing is for sale and nothing is owed.",
    card: {
      setup: "A small restaurant {b} chose, where nobody knows {a}'s name. The bill is already split, and the business offer is in a folder that stays shut.",
      wants: [
        "{a} wants to understand the first honest no in years; being impressed is not the same as being owed an explanation.",
        "{b} wants to be seen as someone who cannot be bought; it would help if {a} were less easy to like.",
      ],
      beats: [
        "The no gets explained, and the explanation is better than the offer was.",
        "The rich one tries a different question: not what it would take, but what matters.",
        "They find the one subject where neither has the upper hand.",
        "One of them says, plainly, that this dinner stopped being about business a while ago.",
      ],
      tone: "dry, level, money left at the door",
      openings: [
        "{a} sets a shut folder on the empty chair and says it stays there.",
        "{b} asks whether {a} has heard the word no before, and how it was.",
        "{a} and {b} order the same thing, and both look annoyed about it.",
      ],
    },
  },
  {
    id: "arranged-match", title: "The arranged match", icon: "📜", category: "romance", roles: null,
    premise: "{a} and {b} are the adult heirs of two houses, and each chose this alliance freely. Tonight, the night before it is announced, is the first meeting alone, and either can still call it off.",
    card: {
      setup: "A quiet library between two wings of a great house, with the contracts unsigned on the desk. {a} and {b} have read each other's letters for a year and never been in the same room.",
      wants: [
        "{a} wants to know whether the person matches the letters; choosing on paper was easy and this is not paper.",
        "{b} wants to be sure {a} is here by choice and not by duty; asking outright seems rude and necessary.",
      ],
      beats: [
        "Each asks whether the other chose this, and both answer at length.",
        "They read a clause of the contract aloud and rewrite it in the margin.",
        "One of them offers the other an honourable way out, and means it.",
        "They find the first thing they disagree about, and enjoy it.",
      ],
      tone: "formal, curious, a choice being made a second time in person",
      openings: [
        "{a} says the first thing to settle is whether anybody here wants out.",
        "{b} sets the unsigned contract aside and says it can wait until after a proper conversation.",
        "{a} and {b} bow, and both start laughing at how formal it is.",
      ],
    },
  },
  {
    id: "off-duty", title: "Hero and villain, off duty", icon: "🦸", category: "fantasy", roles: ["the hero", "the villain"], costumes: ["a plain coat over a hero's suit, a mask in one pocket", "a sharp dark suit with one theatrical flourish"],
    premise: "{a} is the city's hero, and {b} is its most persistent villain. One night a year neither is working, and by long tradition they meet somewhere neutral. This year neither pretends it is only tradition.",
    card: {
      setup: "A rooftop above a city nobody is saving or menacing tonight. {a} has brought takeaway, {b} has brought a bottle, and both masks are in coat pockets.",
      wants: [
        "{a} wants to know who {b} is when there is nothing to win; the answer might make the rest of the year harder.",
        "{b} wants one evening of being taken at face value; the reputation gets into the room before {b} does.",
      ],
      beats: [
        "They review the year's encounters like colleagues.",
        "One admits to pulling a punch, and says why.",
        "The city stays quiet, and for once neither is listening for it.",
        "They negotiate what tonight means for tomorrow, when the masks go back on.",
      ],
      tone: "wry, charged, nemeses with the night off",
      openings: [
        "{a} lands on the rooftop holding a paper bag and says it is a peace offering.",
        "{b} is already there and says the hero is late for once.",
        "{a} and {b} set two masks on the ledge, side by side.",
      ],
    },
  },
  {
    id: "anniversary-strangers", title: "Married, meeting as strangers", icon: "🥃", category: "second", roles: null,
    premise: "{a} and {b} have been married for years. Tonight, at a hotel bar, {a} and {b} are strangers: new names, a first hello, and the fun of being chosen all over again.",
    card: {
      setup: "A hotel bar far enough from home to feel like somewhere else. {a} is already at the bar with a ring in a pocket, and {b} walks in pretending to look for nobody.",
      wants: [
        "{a} wants to be surprised by someone known by heart; it is hard not to order {b}'s usual.",
        "{b} wants to flirt without the shorthand of years; the game keeps almost collapsing into laughter.",
      ],
      beats: [
        "They introduce themselves with invented names and jobs.",
        "A stranger's question gets a true answer the other had never heard.",
        "One of them nearly breaks character over an old joke, and saves it.",
        "They decide how long the strangers get to stay strangers.",
      ],
      tone: "playful, fond, long love flirting with itself",
      openings: [
        "{b} asks whether the seat is taken, and {a} says it has been waiting.",
        "{a} offers a first name that is not the real one and enjoys {b}'s face.",
        "{a} and {b} shake hands for the first time in years.",
      ],
    },
  },
  {
    id: "after-the-party", title: "After the party", icon: "🎉", category: "nightin", roles: ["the one who got the attention", "the one who noticed"], costumes: ["party clothes, a little rumpled, shoes in one hand", "a good shirt, a jacket over one arm"],
    premise: "{a} and {b} are a couple, just home from a party where {a} got a lot of attention. {b} noticed. The jealousy gets said out loud, and then it gets laughed about, because nobody is in any doubt about who came home with whom.",
    card: {
      setup: "The front door shuts on the noise of the evening. {a} is still glowing from the party, and {b} is hanging up two coats with great care.",
      wants: [
        "{a} wants to be teased about it and then reassured; the attention was fun, and coming home was the point.",
        "{b} wants to admit the jealousy without making it anyone's fault; saying it lightly is harder than feeling it.",
      ],
      beats: [
        "The jealous one gives a full, funny account of the evening from across the room.",
        "The other one confesses to enjoying being watched, by exactly one person.",
        "They agree what would actually not be fine, and it is a short list.",
        "The teasing changes direction.",
      ],
      tone: "fond, teasing, jealousy said out loud and turned into a joke they share",
      openings: [
        "{b} says, conversationally, that the person by the bookshelf laughed at everything {a} said.",
        "{a} asks whether {b} was counting, and {b} says only until it got to double figures.",
        "{a} and {b} kick off two pairs of shoes in the hall, and neither turns on the big light.",
      ],
    },
  },
  {
    id: "the-cold-one", title: "The one nobody approaches", icon: "🧗", category: "romance", roles: ["the unreadable one", "the regular on the next wall"], costumes: ["climbing clothes and a chalk bag, hair pulled back", "a worn gym shirt and climbing trousers, tape on two fingers"],
    premise: "{a} and {b} are regulars at the same climbing gym. {a} is famously unreadable and nobody tries to talk to {a}; {b} has climbed the next wall over for months. Tonight, as the gym empties, {a} is the one who finally asks.",
    card: {
      setup: "Closing time at the climbing gym, chalk dust in the air and the music turned down. {a} walks over to {b}'s wall for the first time, and the last few regulars pretend not to stare.",
      wants: [
        "{a} wants to say something that has been rehearsed for weeks; being unreadable is a habit, not a choice.",
        "{b} wants to know what is behind the stillness; months of nods across the mats have been oddly eloquent.",
      ],
      beats: [
        "The unreadable one says more in a minute than in all the months before.",
        "They discover each has been timing sessions to match the other's.",
        "The gym's lights go to half, and they keep talking by the lockers.",
        "One of them asks where this conversation is going next, plainly.",
      ],
      tone: "quiet, slow burn, a cold front thawing on purpose",
      openings: [
        "{a} waits for {b} to come down off the wall and says hello like a decision.",
        "{b} asks whether {a} wants a spot on the overhang, and {a} says yes too quickly.",
        "{a} holds out {b}'s chalk bag, which was not lost.",
      ],
    },
  },
  {
    id: "slow-sunday", title: "A slow Sunday", icon: "☔", category: "nightin", roles: null,
    premise: "{a} and {b} have been together a long time. It is Sunday, it is raining, and there is nowhere anyone has to be. Soft and unhurried, with the whole day to waste on each other.",
    card: {
      setup: "Rain on the windows and the second pot of coffee going cold. {a} and {b} are on the sofa with the crossword in the middle and no plans at all.",
      wants: [
        "{a} wants the day to stay exactly this slow; the list of chores on the fridge is trying to be noticed.",
        "{b} wants {a}'s full attention with nothing competing for it; the crossword is the only rival.",
      ],
      beats: [
        "They argue gently about a crossword clue.",
        "Someone suggests going out, and the rain answers for them.",
        "An old story gets retold, and the other one corrects a detail fondly.",
        "They decide the chores can wait, formally, with a handshake.",
      ],
      tone: "soft, unhurried, the ease of people who know each other well",
      openings: [
        "{a} reads a crossword clue aloud and gets it wrong on purpose.",
        "{b} pulls the blanket across the whole sofa and says the day is cancelled.",
        "{a} and {b} listen to the rain and agree it sounds like permission.",
      ],
    },
  },
  {
    id: "after-the-cameras", title: "After the cameras", icon: "🎥", category: "getaway", roles: null,
    premise: "{a} and {b} are contestants on a dating show, on the overnight date. The crew has gone home, the microphones are off, and for the first time what happens next is nobody's edit.",
    card: {
      setup: "A villa suite with the camera rigs still up and every red light dark. {a} and {b} each handed a microphone to the last of the crew, and the quiet afterwards is new.",
      wants: [
        "{a} wants to find out what {b} is like unedited; weeks of performing make it hard to know where to start.",
        "{b} wants a choice that is not a storyline; anyone can still call the car, and saying that out loud helps.",
      ],
      beats: [
        "They check, together, that every camera is really off.",
        "Each admits which on-screen moments were real.",
        "One of them says the producers' plan for tonight out loud, and they agree to ignore it.",
        "They decide what, if anything, gets said on camera tomorrow.",
      ],
      tone: "candid, relieved, two people with the script finally put down",
      openings: [
        "{a} waves at a dead camera to make sure, and {b} laughs.",
        "{b} says this is the first quiet in weeks and does not want to waste it on small talk.",
        "{a} and {b} stand in the middle of the suite, unsure where people stand when nobody is directing.",
      ],
    },
  },
  {
    id: "summoned", title: "Summoned by mistake", icon: "🕯️", category: "fantasy", roles: ["the one who did the summoning", "the demon"], costumes: ["an old cardigan with chalk on the cuffs", "a perfectly cut dark suit, faintly smoking at the hems"],
    premise: "{a} misread one line of an old book and summoned {b}, a charming demon several centuries old, by accident. The chalk circle holds nobody and the contract is blank: the terms get written together, and either can end it with a word.",
    card: {
      setup: "A chalk circle on a study floor, slightly smudged, and a smell of struck matches. {b} is standing in it looking politely amused, and {a} is holding the book upside down.",
      wants: [
        "{a} wants to know what was actually summoned, and why sending it back feels like the wrong answer; the book says not to make eye contact.",
        "{b} wants to be invited to stay and not merely kept; centuries of being summoned for favours have made a blank contract a novelty.",
      ],
      beats: [
        "The demon explains that the circle is decorative and that leaving is always an option, for both of them.",
        "They draft the first term together, and argue about the wording.",
        "The summoner asks what the demon wants, which nobody has asked in centuries.",
        "They agree on the word that ends the arrangement, and each says it once to prove it works.",
      ],
      tone: "wry, uncanny, a negotiation where the fine print is consent",
      openings: [
        "{b} looks at the smudged chalk and asks whether {a} meant to do that.",
        "{a} apologises to {b} for the inconvenience and offers tea.",
        "{b} picks up the blank contract and holds out a pen to {a}.",
      ],
    },
  },
  {
    id: "two-captains", title: "Two captains, one cabin", icon: "⚓", category: "outdoors", roles: null,
    premise: "{a} and {b} are rival captains whose ships are moored side by side for the night. Somebody proposed a truce and a drink in the bigger cabin, and each insists the idea was the other's.",
    card: {
      setup: "Two ships rocking at the same quay and one lantern in the great cabin. {a} and {b} sit across a chart table, each with a boat waiting to row back whenever either likes.",
      wants: [
        "{a} wants to know whether the rivalry was ever really about the cargo; years of chasing {b} across oceans suggest not.",
        "{b} wants to win this conversation the way {a} wins harbours; conceding that the truce was a good idea would be a start.",
      ],
      beats: [
        "They argue about whose idea the truce was, with witnesses cited.",
        "Each tells the story of the same chase from the other deck.",
        "One of them puts a hand flat on the chart, over the place where it started.",
        "The watch bell rings, and neither calls for a boat.",
      ],
      tone: "salt-aired, sparring, old rivals out of excuses",
      openings: [
        "{a} pours two measures and says the truce was clearly {b}'s idea.",
        "{b} unrolls a chart and points to the spot where {a} got away the first time.",
        "{a} and {b} hang two hats on the same hook, for lack of a second one.",
      ],
    },
  },
  {
    id: "home-again", title: "Home after months away", icon: "🧳", category: "second", roles: ["the one who's been away", "the one who waited"], costumes: ["travel clothes, creased from the journey, a bag still on one shoulder", "comfortable clothes for an evening at home"],
    premise: "{a} is back tonight after months away on a long posting, and {b} has been counting the days. It is the first evening home, with the bags still in the hall and everything to catch up on.",
    card: {
      setup: "A key in the door at last, and a bag dropped in the hall. {a} stands there taking in the flat, which has changed in small ways, and {b} comes out of the kitchen drying both hands.",
      wants: [
        "{a} wants to feel at home again and not like a guest; months away have left a little shyness that is embarrassing to admit.",
        "{b} wants to hear everything and say everything at once; it is hard to know which to do first.",
      ],
      beats: [
        "They talk over each other and have to start again.",
        "One of them notices what changed in the other, and says so.",
        "The gift from the journey comes out of the bag, and it is slightly wrong and exactly right.",
        "They admit the first evening back is always a little strange, and that it is all right.",
      ],
      tone: "tender, eager, a little shy after a long time apart",
      openings: [
        "{a} drops the bag in the hall and says the flat smells the same.",
        "{b} says welcome home and stops, with no idea what to do with both hands.",
        "{a} and {b} stand a moment in the hall, grinning, before either moves.",
      ],
    },
  },
];

export const ROLEPLAY_IDS = ROLEPLAYS.map((r) => r.id) as [string, ...string[]];
export const roleplayById = (id: string | null | undefined): Roleplay | null => ROLEPLAYS.find((r) => r.id === id) ?? null;

/**
 * The rule that makes the writer play it (David, 2026-10-25: a "Captain and pilot" chapter on a skydive was never played):
 * every line is in the roleplay, in their own voices; where they are becomes part of it, never a reason to drop it; and
 * stepping out is something a line does on purpose. With roles, who plays whom.
 */
export function roleplayRule(rp: Roleplay, names: { a: string; b: string }, swap: boolean, place: string): string {
  const first = (n: string) => n.split(/\s+/)[0];
  const roles = rolesLine(rp, { a: first(names.a), b: first(names.b) }, swap);
  return (
    `- This chapter is the roleplay the viewer chose: ${rp.title}.${roles ? ` ${roles}.` : ""} Every line plays it, in their own voices: they act, talk and want as ${roles ? "their roles" : "its premise has them"}, and ${place} becomes part of it (the roleplay's world laid over where they are), never a reason to drop it. Stepping out of the roleplay is something a line does on purpose and says so; the next line can step back in.` +
    // David, 2026-10-29: Star × Sweet's "Rivals" never competed once; it was flirting from line 4 and undressing by 32.
    ` The roleplay is the story, not a way into sex: its stakes, its power between them and what each role wants drive what happens, and plenty of lines are about that and nothing more. If it turns intimate, it's because the roles got them there, and they stay in their roles while it does (how a rival, a captain or a vampire would want, tease and give in), so the roleplay is never dropped for the explicit.` +
    // The card's beats are story beats (lib/scene-cards.ts): something to play, never a pace to keep or a stage to reach.
    (rp.card
      ? ` Its story (how it starts, what each of them wants, where it can go) is there to be played: those turns are about the stakes, the banter and what's in the way, to use, reorder or leave, and none of them is a cue to move a stage on or a place it has to end.`
      : "")
  );
}

/** Who plays what, in the viewer's words: "Dex plays the boss, June the employee"; null when there are no roles. */
export function rolesLine(rp: Roleplay, names: { a: string; b: string }, swap = false): string | null {
  if (!rp.roles) return null;
  const [x, y] = swap ? [names.b, names.a] : [names.a, names.b];
  return `${x} plays ${rp.roles[0]}, ${y} ${rp.roles[1]}`;
}

/**
 * What each of them wears for the roleplay, a's then b's (swapped with the roles): its own costumes, or for one with
 * roles and none written (someone's own), dressed for the part. Null when it has no roles: they come as themselves.
 */
export function roleCostumes(rp: Pick<Roleplay, "roles" | "costumes" | "title">, swap = false): [string, string] | null {
  if (!rp.roles) return null;
  const worn = rp.costumes ?? (rp.roles.map((r) => `clothes that fit ${r} in "${rp.title}", dressed for the part`) as [string, string]);
  return swap ? [worn[1], worn[0]] : [worn[0], worn[1]];
}

/**
 * The roleplay as the scene's prompt says it, with their names in their roles. With a card, the story behind it too: how
 * it starts, what each of them wants (both: one writer writes both sides), where it can go and its tone. `opening` (0, 1
 * or 2: which of the card's three) is passed only for the roleplay's first lines, which then play it.
 */
export function roleplayLine(rp: Roleplay, names: { a: string; b: string }, swap = false, opening: number | null = null): string {
  const first = (n: string) => n.split(/\s+/)[0];
  const [x, y] = (swap ? [names.b, names.a] : [names.a, names.b]).map(first);
  const fill = (text: string) => fillCardText(text, { a: x, b: y });
  const line = `This chapter's roleplay, chosen by the viewer: ${rp.title}. ${fill(rp.premise)} The premise is where the night starts, not where it has to end. They play it as themselves, in their own voices. Both of them are adults who chose this, and either can stop at any time.`;
  const card = rp.card;
  if (!card) return line;
  return [
    line,
    "The story behind the roleplay (context for you, never a script):",
    `- How it starts: ${fill(card.setup)}`,
    `- What ${x} wants: ${fill(card.wants[0])}`,
    `- What ${y} wants: ${fill(card.wants[1])}`,
    `- Where the story can go, in order (turns it could take, none of them where it ends): ${card.beats.map(fill).join(" ")}`,
    `- Its tone: ${card.tone}.`,
    ...(opening !== null ? [`- How it opens: ${fill(openingOf(card, opening) ?? card.openings[0])} These first lines play that.`] : []),
  ].join("\n");
}
