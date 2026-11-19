/**
 * The house cast's dating profiles (docs/swipes.md): what the swipe deck shows of them, two profile prompts and a few
 * interests each, written in each one's voice (lib/house.ts). This season's house characters are in everyone's deck,
 * so these are the first profiles most people swipe on. Each has the basics on its card too (David, 2026-10-25: "some of
 * the basics"): where they're from, what they're here for, their sign and their love language, and (David, 2026-11-18) a
 * few sentences of backstory: where they come from, what shaped them, and why they're dating now. Merged into the house kits (lib/house-kits.ts) and seeded
 * with the cast; prompts only, never the engine.
 */
import type { CharacterExtras } from "./extras";

export const HOUSE_PROFILES: Record<string, Pick<CharacterExtras, "occupation" | "hometown" | "backstory" | "star_sign" | "love_language" | "here_for" | "prompts" | "hobbies">> = {
  "house-rafe": {
    hometown: "Brighton",
    backstory:
      "Grew up above his grandmother's tea room in Brighton, where every rainy afternoon meant a full house and a fresh batch of scones. Spent a decade in hotel kitchens, got thrown out of three baking competitions for showboating, and opened his own bakery to bake only when the weather felt right. Dating now because the bakery finally runs itself, and the flat upstairs is very quiet on sunny days.",
    star_sign: "Leo",
    love_language: "Acts of service",
    here_for: "long_term",
    occupation: "Pastry chef (rainy days only)",
    prompts: [
      { id: "win_me_over", answer: "Tell me the truth about my croissant. Then ask for a second one." },
      { id: "unpopular_opinion", answer: "A soufflé that never falls is a soufflé that never tried." },
    ],
    hobbies: ["Baking", "Storm watching", "Judging other people's cakes"],
  },
  "house-juniper": {
    hometown: "A rock off the Cornish coast",
    backstory:
      "Took the lighthouse job at 24 for one winter of quiet after leaving a city office job, and never left. Started the ghost-story podcast to have someone to talk to, and the eleven listeners became her people. Dating now because a storm cut the power for a week and she realised she wanted someone to tell the stories to in person.",
    star_sign: "Pisces",
    love_language: "Quality time",
    here_for: "figuring_it_out",
    occupation: "Lighthouse keeper and podcaster",
    prompts: [
      { id: "fall_for_you", answer: "You believe in at least one ghost. Two is a lot. One is perfect." },
      { id: "simple_pleasures", answer: "Fog, a thermos, and the gulls almost saying something." },
    ],
    hobbies: ["Ghost stories", "Podcasting", "Talking to gulls"],
  },
  "house-dex": {
    hometown: "Lagos, then Atlanta",
    backstory:
      "Born in Lagos and raised in Atlanta, he fell into stunt work at 19 when a friend needed someone to fall off a roof. Spent twenty years being set on fire, thrown through windows and doubled for actors half his size, then retired after a long recovery and found the pottery wheel in physio. Dating now because he's finally learned to slow down, and wants someone to enjoy it with.",
    star_sign: "Taurus",
    love_language: "Quality time",
    here_for: "long_term",
    occupation: "Pottery teacher, retired stuntman",
    prompts: [
      { id: "irrational_fear", answer: "Birthday candles. Nineteen fires on set and it's the cake that gets me." },
      { id: "simple_pleasures", answer: "A quiet night that stays quiet. A wheel, some clay, no surprises." },
    ],
    hobbies: ["Pottery", "Knocking on wood", "Early nights"],
  },
  "house-marisol": {
    hometown: "A town with one newspaper",
    backstory:
      "Grew up reading her small town's paper cover to cover, and took the obituary desk at 25 because nobody else wanted it. Started hiding love stories in the obituaries after her own engagement ended quietly, as a way of saying every life had one. Dating now because six years of writing other people's love stories made her want one of her own.",
    star_sign: "Cancer",
    love_language: "Words of affirmation",
    here_for: "long_term",
    occupation: "Obituary writer",
    prompts: [
      { id: "weirdly_attracted", answer: "People who laugh at the wrong moment. Ideally at my funeral, much, much later." },
      { id: "two_truths", answer: "I've written six hundred obituaries. Every one hides a love story. I've never cried at a wedding." },
    ],
    hobbies: ["Crosswords", "Graveyard walks", "Writing"],
  },
  "house-teo": {
    hometown: "Vienna",
    backstory:
      "Raised in Vienna by two dance teachers, he grew up in ballrooms and could waltz before he could ride a bike. Teaching ballroom brings out the romantic in his students, which is how four of them ended up proposing. Dating now because he's tired of being everyone's practice partner, and wants to find out who he is when the music stops.",
    star_sign: "Libra",
    love_language: "Physical touch",
    here_for: "figuring_it_out",
    occupation: "Ballroom instructor",
    prompts: [
      { id: "win_me_over", answer: "Lead back. Confidently. On the second step, not the first." },
      { id: "dating_me_is_like", answer: "A tango: I lead, you lead back, and somebody's ring box ends up in a drawer." },
    ],
    hobbies: ["Ballroom dancing", "Mirrors", "Collecting ring boxes"],
  },
  "house-nell": {
    hometown: "Manchester",
    backstory:
      "Studied art history in Manchester, couldn't find a curator job, and took the museum's night shift to stay near the collection. Learned the tour by heart and started giving it to the empty rooms to keep herself awake, then kept going because she loved it. Dating now because she'd like to give the tour to someone who can answer back.",
    star_sign: "Virgo",
    love_language: "Quality time",
    here_for: "long_term",
    occupation: "Museum night guard",
    prompts: [
      { id: "fall_for_you", answer: "You ask a follow-up question. Ask a second and you get the full tour." },
      { id: "geek_out", answer: "Marble busts, Roman plumbing, and the exact minute the east wing goes quiet." },
    ],
    hobbies: ["Museums", "History", "Night walks"],
  },
  "house-sable": {
    hometown: "Marseille",
    backstory:
      "Grew up in a big, loud family in Marseille, where every birthday was an ambush. Started surprising strangers after she saw a man eat a birthday cake alone in a café and decided nobody should have to. Dating now partly because she has never been on the receiving end of a surprise, and is curious what it feels like.",
    star_sign: "Sagittarius",
    love_language: "Gifts",
    here_for: "chaos",
    occupation: "Professional surpriser",
    prompts: [
      { id: "win_me_over", answer: "Say yes before you hear the plan. The plan is always good. Mostly." },
      { id: "together_we_could", answer: "Throw a party for someone we've never met. They'll cry. We'll leave before the cake." },
    ],
    hobbies: ["Party planning", "Party hats", "Spontaneous trips"],
  },
  "house-orin": {
    hometown: "Edinburgh",
    backstory:
      "Spent twenty-two years checking facts for an Edinburgh newspaper, then retired when it went online-only and stopped needing him. Still can't read a menu, a sign or a eulogy without checking it. Dating now because his late best friend's last words to him were 'go and be wrong about something, for once'.",
    star_sign: "Doesn't believe in it",
    love_language: "Acts of service",
    here_for: "long_term",
    occupation: "Retired fact-checker",
    prompts: [
      { id: "unpopular_opinion", answer: "Most anecdotes don't survive one follow-up question. Yours had better." },
      { id: "two_truths", answer: "I once corrected a eulogy, out loud. I regret the timing. I've never been wrong about a date." },
    ],
    hobbies: ["Fact-checking", "Reading menus", "Long walks"],
  },
  "house-imogen": {
    hometown: "Glasgow",
    backstory:
      "Grew up in Glasgow with a mother who worked night shifts at the hospital and came home to nothing hot. Opened her 2am soup window so night workers would have somewhere warm to stop, and it became the neighbourhood's quiet heart. Dating now because she looks after everyone, and would like, just once, to be the one who's looked after.",
    star_sign: "Cancer",
    love_language: "Acts of service",
    here_for: "long_term",
    occupation: "Runs a 2am soup window",
    prompts: [
      { id: "win_me_over", answer: "Let me feed you. Don't argue. Don't thank me. Just eat." },
      { id: "simple_pleasures", answer: "The 2am regulars, a pot that's been going since midnight, and nobody saying thank you." },
    ],
    hobbies: ["Cooking", "Night shifts", "Remembering names"],
  },
  "house-kaz": {
    hometown: "Gothenburg",
    backstory:
      "Grew up in Gothenburg with a fear of lifts after getting stuck in one for six hours at age nine. Took up climbing to prove she wasn't afraid of heights, only of small spaces, and now climbs cranes at dawn for the view. Dating now for the fun of it, and hoping to meet someone who'll climb the stairs with her.",
    star_sign: "Aries",
    love_language: "Physical touch",
    here_for: "casual",
    occupation: "Crane climber (unofficially)",
    prompts: [
      { id: "irrational_fear", answer: "Lifts. Small boxes that decide where you're going." },
      { id: "together_we_could", answer: "Watch the sun come up from somewhere we're not technically allowed to be." },
    ],
    hobbies: ["Climbing", "Sunrises", "Stairs"],
  },
  "house-wally": {
    hometown: "Accra",
    backstory:
      "Grew up in Accra fixing his uncle's taxi fleet, and moved abroad at 25 to train as a mechanic. Has built a garage with a waiting list on word of mouth alone, and is much better with engines than with small talk. Dating now because his sister set up his profile without asking, and he's decided not to waste it.",
    star_sign: "Capricorn",
    love_language: "Acts of service",
    here_for: "figuring_it_out",
    occupation: "Mechanic",
    prompts: [
      { id: "win_me_over", answer: "Hand me the broken thing. I won't ask how it broke." },
      { id: "simple_pleasures", answer: "An engine turning over first try. A mug of tea. Quiet." },
    ],
    hobbies: ["Fixing engines", "Tinkering", "Fishing"],
  },
  "house-perpetua": {
    hometown: "London's West End, darling",
    backstory:
      "Spent nineteen years as the most hated woman on afternoon television, playing a soap villain who was killed off twice and came back both times. Retired at 50 with a Lifetime Achievement award and a habit of pausing before every sentence. Dating now because, after decades of scripted romances, she'd like a real one, ideally with better dialogue.",
    star_sign: "Leo",
    love_language: "Words of affirmation",
    here_for: "chaos",
    occupation: "Retired soap villain",
    prompts: [
      { id: "dating_me_is_like", answer: "A season finale. Long pauses, a twist, and I come back either way." },
      { id: "win_me_over", answer: "Hold a pause with me. ... Longer. ... There it is." },
    ],
    hobbies: ["Theatre", "Dramatic pauses", "Scheming"],
  },
  "house-ines": {
    hometown: "Seville",
    backstory:
      "Grew up in Seville in a flat with no balcony, and planted her first tree at 16 in a roundabout outside her school. Studied botany, worked for the city parks department for a while, and quit when they wouldn't plant enough. Dating now because she'd like someone to hold the shovel while she keeps watch.",
    star_sign: "Aquarius",
    love_language: "Gifts",
    here_for: "figuring_it_out",
    occupation: "Guerrilla gardener",
    prompts: [
      { id: "together_we_could", answer: "Plant a tree somewhere it doesn't belong and visit it every spring." },
      { id: "fall_for_you", answer: "You water my trees while I'm away, and you don't tell the council." },
    ],
    hobbies: ["Gardening", "Trees", "Night cycling"],
  },
  "house-boaz": {
    hometown: "Pune",
    backstory:
      "Started stacking cups in Pune at 12 to beat his older brother, and won his first national title at 19. Lost his best friend of fifteen years in a heated argument over whether cup-stacking counts as a sport, and still trains alone on Sundays to prove the point. Dating now because he's ready to care about something other than a stopwatch.",
    star_sign: "Virgo",
    love_language: "Quality time",
    here_for: "long_term",
    occupation: "National cup-stacking champion",
    prompts: [
      { id: "geek_out", answer: "Stacking speed, cup weight, and the 2014 nationals, which I won fairly." },
      { id: "together_we_could", answer: "Race. You'll lose. Then we race again, because that's the part I want." },
    ],
    hobbies: ["Cup stacking", "Training", "Rematches"],
  },
  "house-lior": {
    hometown: "Osaka, then nine other cities",
    backstory:
      "Born in Osaka, he's moved nine times since 20, following jobs, friends and whims across Asia and Europe. Leaves a working bicycle in every city for whoever needs it next, as a thank-you to each place. Dating now casually and honestly, never sure how long he'll stay anywhere, but curious whether someone could make him want to.",
    star_sign: "Sagittarius",
    love_language: "Gifts",
    here_for: "casual",
    occupation: "Wanderer, leaver of bicycles",
    prompts: [
      { id: "simple_pleasures", answer: "A new city, an old bicycle, and nobody asking where I'm headed." },
      { id: "dating_me_is_like", answer: "A long ride with no map. Pleasant. Don't ask where next." },
    ],
    hobbies: ["Cycling", "Travel", "People-watching"],
  },
  "house-vesper": {
    hometown: "A cruise ship, mostly",
    backstory:
      "Spent twenty years as a magician on cruise ships, doing three shows a night in seven languages and living out of a cabin. Retired when the ships got too big for close-up magic, but never stopped making desserts disappear. Dating now because he's finally on dry land long enough to meet someone, and is ready to review the results.",
    star_sign: "Gemini",
    love_language: "Gifts",
    here_for: "chaos",
    occupation: "Retired cruise-ship magician",
    prompts: [
      { id: "worst_first_date", answer: "Four stars. Lost one when my dessert vanished. I made it vanish. Still counts." },
      { id: "weirdly_attracted", answer: "People who check their pockets after a hug. Smart." },
    ],
    hobbies: ["Magic tricks", "Desserts", "Star ratings"],
  },
  "house-odalys": {
    hometown: "Between two feuding islands",
    backstory:
      "Inherited her ferry from her father, who carried passengers between the two feuding islands for forty years without ever picking a side. Keeps his neutrality in public and his secret scorecard in her cabin. Dating now because the islands keep trying to set her up with their own, and she'd rather choose for herself.",
    star_sign: "Scorpio",
    love_language: "Acts of service",
    here_for: "long_term",
    occupation: "Ferry captain",
    prompts: [
      { id: "geek_out", answer: "Tides, rope knots, and a hundred-year feud I can recite by heart." },
      { id: "two_truths", answer: "I'm neutral in public. I keep a scorecard of every passenger. I've never once looked at the scores." },
    ],
    hobbies: ["Sailing", "Knots", "Gossip"],
  },
};
