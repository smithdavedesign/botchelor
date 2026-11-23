/**
 * Cover pictures for Step in's roleplay cards (app/after-dark/step-in/StepInShelf.tsx). David, 2026-11-23: "A cover
 * picture per card, the character dressed for the role. About 3.5¢ each, so 45¢ for the top twelve."
 *
 * Twelve of the 45 roleplays have one: a house character dressed for one side of the story, in the story's own place
 * (lib/adult/roleplays.ts `at`). The picture is the card's poster, and so it also says who the card opens on and which
 * side the viewer plays when they take it as it is: a cover of the vampire on the doorstep opens with that character
 * as the vampire and the viewer as the guest. "Someone else" recasts the card with anyone else, and then the cover
 * goes (it's a picture of one person, and it would be a lie beside another's name).
 *
 * How they were made (~/.claude/botchelor-bin/covers/cover.py, 2026-11-23): one image edit each on Replicate's
 * qwen/qwen-image-edit-2511, the app's own edit model, from the character's PG house portrait, with what the role
 * wears (the roleplay's own `costumes`) and the place in the prompt. PG: fully clothed, Replicate's own safety checker
 * left on, each one looked at before it was kept. Fifteen edits in all, about 45 cents: a first try, and two redone
 * because their faces (Vesper and Odalys, the two premium house characters) aren't in After Dark's cast, so their
 * cards could never have shown them. Everyone on a cover is in HOUSE_CHARACTERS, the cast After Dark can have. They're
 * the show's own pictures (public/cast, AI-marked by scripts/stamp-ai-marks.mjs), so discreet blur leaves them alone.
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
};

/** The roleplay's cover when the card is cast with the one in the picture; null with anyone else, or with no cover. */
export function coverFor(roleplayId: string, characterId: string | null | undefined): RoleplayCover | null {
  const cover = ROLEPLAY_COVERS[roleplayId];
  return cover && cover.character === characterId ? cover : null;
}
