/**
 * Cover pictures for Step in's roleplay cards (app/after-dark/step-in/StepInShelf.tsx). David, 2026-11-23: "A cover
 * picture per card, the character dressed for the role. About 3.5¢ each, so 45¢ for the top twelve." And, once those
 * were live the same evening: "do the covers for the other 33 cards".
 *
 * Every one of the 45 roleplays has one: a house character dressed for one side of the story, in the story's own place
 * (lib/adult/roleplays.ts `at`). The picture is the card's poster, and so it also says who the card opens on and which
 * side the viewer plays when they take it as it is: a cover of the vampire on the doorstep opens with that character
 * as the vampire and the viewer as the guest. "Someone else" recasts the card with anyone else (the people the viewer
 * has stepped in with first), and then the cover goes: it's a picture of one person, and it would be a lie beside
 * another's name.
 *
 * Who is on which: each of the fifteen house characters is on three covers, cast for what they're like (Wally, the
 * fixer, is the handyman; Dex, the gentle giant, the blacksmith; Kaz, chalk on both palms, the climber). A roleplay
 * with no named roles is always played with the viewer as its card's first person and the character as its second
 * (the set-up offers no sides for it), so its picture shows what the second one is doing: in "Married, meeting as
 * strangers" the character is the one who walks in, not the one already at the bar.
 *
 * How they were made (~/.claude/botchelor-bin/covers/cover.py, 2026-11-23): one image edit each on Replicate's
 * qwen/qwen-image-edit-2511, the app's own edit model, from the character's PG house portrait, with what the role
 * wears (the roleplay's own `costumes`) and the place in the prompt. PG: fully clothed, Replicate's own safety checker
 * left on, each one looked at before it was kept. 54 edits in all, about $1.90: fifteen for the first twelve (two
 * redone because their faces, Vesper and Odalys, the two premium house characters, aren't in After Dark's cast, so
 * their cards could never have shown them) and 39 for the other 33 (three drew the character twice, once close and
 * once small in the doorway the pose named; one had a neon sign of garbled letters; two were lost to a stopped run).
 * Everyone on a cover is in HOUSE_CHARACTERS, the cast After Dark can have. They're the show's own pictures
 * (public/cast, AI-marked by scripts/stamp-ai-marks.mjs), so discreet blur leaves them alone.
 * Client-safe: no imports.
 */
export type RoleplayCover = {
  /** Who's in the picture: the card opens on them. */
  character: string;
  /** The side of the roleplay the VIEWER plays when the card is taken with them (the picture shows the other side). */
  you: 0 | 1;
  src: string;
  /** What the picture shows, for someone who can't see it. */
  alt: string;
};

export const ROLEPLAY_COVERS: Readonly<Record<string, RoleplayCover>> = {
  neighbours: { character: "house-juniper", you: 0, src: "/cast/roleplay-neighbours-juniper.webp", alt: "Juniper in the open doorway of her flat in a cardigan and bare feet, a parcel on the landing floor" },
  boss: { character: "house-dex", you: 0, src: "/cast/roleplay-boss-dex.webp", alt: "Dex sitting on the edge of a desk in a dark office, a lanyard on, the city lit behind him" },
  "strangers-bar": { character: "house-sable", you: 0, src: "/cast/roleplay-strangers-bar-sable.webp", alt: "Sable on a bar stool in a quiet bar, turned toward you, an empty glass at her elbow" },
  roommates: { character: "house-teo", you: 0, src: "/cast/roleplay-roommates-teo.webp", alt: "Teo leaning on the kitchen counter at midnight with a glass of water, the fridge open behind him" },
  bodyguard: { character: "house-imogen", you: 0, src: "/cast/roleplay-bodyguard-imogen.webp", alt: "Imogen in an evening dress on a sofa in a lamplit sitting room, one hand held out to the empty armchair" },
  vampire: { character: "house-rafe", you: 1, src: "/cast/roleplay-vampire-rafe.webp", alt: "Rafe in dark velvet and a high collar waiting on a doorstep at midnight, mist behind him" },
  royal: { character: "house-perpetua", you: 1, src: "/cast/roleplay-royal-perpetua.webp", alt: "Perpetua in a gold-embroidered gown and a circlet at the open door of the royal chamber, candles along the corridor" },
  starship: { character: "house-nell", you: 1, src: "/cast/roleplay-starship-nell.webp", alt: "Nell in a captain's uniform by the observation lounge's great window, a galaxy behind her" },
  exes: { character: "house-boaz", you: 0, src: "/cast/roleplay-exes-boaz.webp", alt: "Boaz laughing at the quiet end of a gallery opening, a glass of wine in his hand" },
  rivals: { character: "house-kaz", you: 0, src: "/cast/roleplay-rivals-kaz.webp", alt: "Kaz in black tie at an awards dinner, one eyebrow raised, a place card between two fingers" },
  wedding: { character: "house-lior", you: 0, src: "/cast/roleplay-wedding-lior.webp", alt: "Lior leaning in at the singles' table of a wedding with a grin and a glass, fairy lights overhead" },
  "the-fitting": { character: "house-orin", you: 1, src: "/cast/roleplay-the-fitting-orin.webp", alt: "Orin in a waistcoat with a tape measure round his neck and chalk in his hand, in a closed tailor's shop" },
  // The other 33 (2026-11-23, "do the covers for the other 33 cards"), in the roleplays' own order.
  delivery: { character: "house-ines", you: 1, src: "/cast/roleplay-delivery-ines.webp", alt: "Inés in a courier's cap and polo at an open front door, holding out a paper bag with a hopeful smile" },
  handyman: { character: "house-wally", you: 1, src: "/cast/roleplay-handyman-wally.webp", alt: "Wally leaning on a kitchen counter with a mug of tea, his tool belt on, the toolbox shut and the kettle steaming" },
  "no-names": { character: "house-marisol", you: 0, src: "/cast/roleplay-no-names-marisol.webp", alt: "Marisol in a wine-red dress at a candlelit table for two, a finger to her lips, the other chair empty" },
  "hotel-mixup": { character: "house-lior", you: 0, src: "/cast/roleplay-hotel-mixup-lior.webp", alt: "Lior in a hotel room doorway holding up a key card with a rueful smile, a travel bag in his other hand" },
  "photo-shoot": { character: "house-marisol", you: 1, src: "/cast/roleplay-photo-shoot-marisol.webp", alt: "Marisol in a black turtleneck lowering her camera in a photo studio, the softbox lights still on behind her" },
  "bodyguard-off-duty": { character: "house-dex", you: 1, src: "/cast/roleplay-bodyguard-off-duty-dex.webp", alt: "Dex in a leather jacket on a bar stool with a soda, a red neon cocktail glass in the rainy window behind him" },
  "bodyguard-gala": { character: "house-boaz", you: 1, src: "/cast/roleplay-bodyguard-gala-boaz.webp", alt: "Boaz in a black suit and tie taking out his earpiece with a smile, an emptied ballroom behind him" },
  celebrity: { character: "house-sable", you: 1, src: "/cast/roleplay-celebrity-sable.webp", alt: "Sable in a sequinned jacket laughing in a corner of a club, sunglasses pushed up in her hair, a drink in her hand" },
  friends: { character: "house-ines", you: 0, src: "/cast/roleplay-friends-ines.webp", alt: "Inés curled up on a sofa in a big jumper with a bowl of popcorn, looking at you and not at the film" },
  "blind-date": { character: "house-nell", you: 0, src: "/cast/roleplay-blind-date-nell.webp", alt: "Nell at a candlelit restaurant table for two, pushing her glasses up and holding out a hand to say hello" },
  "rival-spies": { character: "house-juniper", you: 0, src: "/cast/roleplay-rival-spies-juniper.webp", alt: "Juniper in a dark trench coat at a hotel bar under green lamps, a cocktail in her hand and a knowing look" },
  "your-rules": { character: "house-imogen", you: 1, src: "/cast/roleplay-your-rules-imogen.webp", alt: "Imogen in a white shirt with the sleeves rolled, sitting forward in an armchair and holding up a small white card" },
  "dons-truce": { character: "house-perpetua", you: 0, src: "/cast/roleplay-dons-truce-perpetua.webp", alt: "Perpetua in a dark suit and a red scarf at the end of a long candlelit table, her ringed hands folded" },
  "said-no": { character: "house-lior", you: 0, src: "/cast/roleplay-said-no-lior.webp", alt: "Lior in his canvas jacket at a small restaurant table with a glass of red wine, a closed folder untouched beside him" },
  "arranged-match": { character: "house-nell", you: 0, src: "/cast/roleplay-arranged-match-nell.webp", alt: "Nell in a deep green gown in a book-lined study, a bundle of letters held to her chest, a fire in the grate" },
  "off-duty": { character: "house-rafe", you: 0, src: "/cast/roleplay-off-duty-rafe.webp", alt: "Rafe in a dark suit on a rooftop ledge above the city at night, a bottle held up and one arm flung wide" },
  "anniversary-strangers": { character: "house-wally", you: 0, src: "/cast/roleplay-anniversary-strangers-wally.webp", alt: "Wally in his good suit in an elegant hotel bar, hands in his pockets, a whisky waiting on the marble bar" },
  "after-the-party": { character: "house-sable", you: 1, src: "/cast/roleplay-after-the-party-sable.webp", alt: "Sable in a sparkly dress and a leather jacket laughing against the front door, her shoes in her hand" },
  "the-cold-one": { character: "house-kaz", you: 0, src: "/cast/roleplay-the-cold-one-kaz.webp", alt: "Kaz at the foot of a climbing wall with tape on her fingers and a chalk bag, looking round in surprise" },
  "slow-sunday": { character: "house-orin", you: 0, src: "/cast/roleplay-slow-sunday-orin.webp", alt: "Orin on the sofa with the crossword and a pencil, looking up over his glasses, rain on the window behind him" },
  "after-the-cameras": { character: "house-teo", you: 0, src: "/cast/roleplay-after-the-cameras-teo.webp", alt: "Teo in a flowered shirt unclipping a microphone from his collar in a villa suite, the camera lights standing dark" },
  summoned: { character: "house-marisol", you: 0, src: "/cast/roleplay-summoned-marisol.webp", alt: "Marisol in a black suit by a chalk circle ringed with candles, smoke curling from her shoulders, one eyebrow raised" },
  "two-captains": { character: "house-juniper", you: 0, src: "/cast/roleplay-two-captains-juniper.webp", alt: "Juniper in a captain's coat and a red sash in a ship's cabin, holding out a glass of rum over the charts" },
  "home-again": { character: "house-imogen", you: 0, src: "/cast/roleplay-home-again-imogen.webp", alt: "Imogen in an apron in the hall, drying her hands on a tea towel and beaming, a travel bag dropped by the door" },
  "the-house": { character: "house-perpetua", you: 1, src: "/cast/roleplay-the-house-perpetua.webp", alt: "Perpetua in a black dinner jacket at a green card table, fanning a hand of cards, chips stacked beside her" },
  "the-final-night": { character: "house-ines", you: 0, src: "/cast/roleplay-the-final-night-ines.webp", alt: "Inés in a long white dress on a lounger beside a glowing pool at night, palms and dark cameras behind her" },
  "gala-date": { character: "house-teo", you: 0, src: "/cast/roleplay-gala-date-teo.webp", alt: "Teo in a dinner suit with his tie undone, leaning on a stone balcony, the ballroom glowing gold behind him" },
  "closing-night": { character: "house-rafe", you: 0, src: "/cast/roleplay-closing-night-rafe.webp", alt: "Rafe in a black apron at a restaurant kitchen's sink, sleeves pushed up, holding out a tea towel" },
  "after-the-toast": { character: "house-wally", you: 0, src: "/cast/roleplay-after-the-toast-wally.webp", alt: "Wally in a suit with a flower in his lapel on a lit terrace, holding out one of two glasses of champagne" },
  "masks-on": { character: "house-kaz", you: 0, src: "/cast/roleplay-masks-on-kaz.webp", alt: "Kaz in a black half mask and black feathered wings, holding a velvet curtain aside with a finger to her lips" },
  "the-forge": { character: "house-dex", you: 1, src: "/cast/roleplay-the-forge-dex.webp", alt: "Dex in a leather apron at the anvil of a forge, wiping his hands, a mended sword in front of the fire" },
  "who-leads": { character: "house-boaz", you: 0, src: "/cast/roleplay-who-leads-boaz.webp", alt: "Boaz in a black dance shirt in an empty studio, standing tall with one hand held out to you" },
  "haunted-inn": { character: "house-orin", you: 0, src: "/cast/roleplay-haunted-inn-orin.webp", alt: "Orin in a tweed jacket in a wing armchair with a book on his knee, an old inn's fire burning behind him" },
};

/** The roleplay's cover when the card is cast with the one in the picture; null with anyone else, or with no cover. */
export function coverFor(roleplayId: string, characterId: string | null | undefined): RoleplayCover | null {
  const cover = ROLEPLAY_COVERS[roleplayId];
  return cover && cover.character === characterId ? cover : null;
}
