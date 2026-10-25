/**
 * The word rules behind the prompts library (app/prompts): which prompts the seed keeps (scripts/build-prompts-library.mjs)
 * and the tags each one gets. Pure, and with no imports, so the seed script can load it straight from node; the page
 * puts names on the tags (lib/prompts-library.ts) and tests/prompts-library.test.ts holds every Studio tag here to the
 * Studio's own catalog (lib/adult/studio-catalog.ts), level included.
 */

/** Any hint of youth (the Studio Inspiration set's list): such a prompt is never kept, and never gets an NSFW tag. */
export const YOUNG =
  /\b(teen\w*|young\w*|girl\w*|boy\w*|school\w*|student\w*|petite|little|tiny|loli\w*|child\w*|kid\w*|under.?age|minor\w*|babysit\w*|cheerlead\w*|braces|pigtail\w*|barely|daughter|niece|son|nephew|baby|toddler|infant|youth|juvenile|adolescent|preteen|highschool)\b/i;

/**
 * What the site's safety lists let through but a public library shouldn't carry (found in the first seed, 2026-10-25):
 * suggestive wear and poses, body-fluid innuendo ("a whitish sticky liquid dripping off her face"), licking and sucking,
 * and violence or death. Whole words, so "wet plate", "curvy horns" and "dripping gold paint" aren't the point: anything
 * here goes, even when it's innocent, because there are 30,000 more prompts to pick from.
 */
export const SENSITIVE =
  /\b(nsfw|nude\w*|naked|topless|lingerie|bikini|swimsuit|sexy|seductive|erotic\w*|busty|cleavage|thighs?|alluring|sheer|corset|innocent|yandere|bdsm|fetish\w*|bondage|leash|submissive|latex|bra|panties|underwear|see[- ]through|revealing|low[- ]cut|plunging|decollet\w*|voluptuous|massage|bent over|on (?:her|his|their) knees|on all fours|straddl\w*|kneel\w*|sticky|viscous|jelly|goo|gooey|slime|yogh?urt|spurt\w*|squirt\w*|semen|cum|whitish|creamy|drool\w*|saliva|spit|lick\w*|suck\w*|moan\w*|lust\w*|aroused|horny|gore|gory|bloody|blood|bleeding|corpse|dead|death|strangl\w*|hanged|murder\w*|wound\w*|decapitat\w*|torture\w*|naughty|flirt\w*|pin-?ups?|bathing suit|bathrobe|nightgown|negligee|shirtless|without (?:a |his |her )?shirt|dripping wet|female bodies|gripp?ed|(?:lips|mouth) (?:slightly |wide )?(?:parted|open))\b/i;

/**
 * Text about a picture that already exists rather than one to make (David, 2026-10-25: "we don't have the image"):
 * talking about "the photo", a caption's verbs, an edit instruction, a question, and the captions CLIP Interrogator
 * writes from a picture (", a portrait by Firstname Lastname"). "A photograph depicting …" asks for a picture, so it stays.
 */
export const IMAGE_REF: readonly (readonly [string, RegExp])[] = [
  ["refers to an image", /\b(?:this|that|the|in this|in the|from this|from the|same as(?: the)?|like the|as in the|based on(?: the| this)?)\s+(?:reference\s+|original\s+|uploaded\s+|attached\s+)?(?:image|photo|picture|pic|img|photograph|screenshot)\b/i],
  ["caption", /\b(?:is shown|are shown|is depicted|are depicted|depicts|we see|you can see|can be seen|pictured|img2img|arafed|araffe|arafe|araffed)\b|(?:^|[.;]\s*)there (?:is|are) (?:a|an|two|three|some)\b/i],
  ["edit instruction", /^(?:please )?(?:make|change|replace|edit|remove|add|turn|convert|transform|put|give (?:her|him|them)|swap|fix|crop|upscale|recolou?r)\b/i],
  ["question", /\?\s*$|^(?:what|who|how|why|can you|could you|would you|is it|is this|does|do you)\b/i],
  ["auto-caption", /,\s+(?:a|an)\s+(?:[a-z-]+\s+){0,3}(?:painting|portrait|photo|photograph|rendering|render|drawing|sculpture|illustration|sketch|poster|pastel|concept art|digital art|cartoon|still|print|engraving|etching|mosaic|fresco|lithograph)\s+by\s+[A-Z][a-z]+(?:\s+[A-Z][\w.'-]+)+|\ba stock photo\b/],
];

/** Why a prompt reads as being about an existing picture, or null when it asks for a new one. */
export function imageReference(text: string): string | null {
  return IMAGE_REF.find(([, re]) => re.test(text))?.[0] ?? null;
}

/**
 * Studio tags: the Studio's own option ids ("<group>.<option>", lib/adult/studio-catalog.ts STUDIO_GROUPS), each with
 * the words that mean it in a prompt. `nsfw` marks an option above the Studio's dressed level (suggestive, nude or
 * explicit); the test keeps it equal to the catalog's. The Filthy group's explicit acts have no rules: nothing that
 * explicit passes the library's safety bar.
 */
export const STUDIO_TAG_RULES: readonly { id: string; re: RegExp; nsfw?: true }[] = [
  { id: "framing.close", re: /\b(close[- ]?ups?|closeups?|headshots?|head shot|face shot|extreme close|face portrait|portrait of (?:a|an|the) [\w' ]{0,30}face)\b/i },
  { id: "framing.medium", re: /\b(medium (?:shot|close[- ]?up)|half[- ]body|waist[- ]up|upper body|mid[- ]shot|bust portrait|three[- ]quarter (?:shot|portrait))\b/i },
  { id: "framing.full", re: /\b(full[- ]?body|full[- ]length|head to toe|full figure)\b/i },
  { id: "framing.wide", re: /\b(wide[- ](?:shot|angle)|long shot|establishing shot)\b/i },
  { id: "angle.above", re: /\b(from above|high[- ]angle|bird'?s[- ]eye|top[- ]down|overhead (?:shot|view))\b/i },
  { id: "angle.below", re: /\b(from below|low[- ]angle|worm'?s[- ]eye)\b/i },
  { id: "angle.eye", re: /\beye[- ]level\b/i },
  { id: "pov.looking", re: /\b(looking (?:at|into|straight at|directly at) (?:the )?(?:camera|viewer|lens)|eye contact|facing (?:the )?camera|staring at the viewer)\b/i },
  { id: "pov.mirror", re: /\b(mirror selfie|in (?:a|the) mirror)\b/i },
  { id: "pov.selfie", re: /\bselfies?\b/i },
  { id: "pose.standing", re: /\b(standing|stands)\b/i },
  { id: "pose.wall", re: /\bleaning (?:on|against) (?:a|the) wall\b/i },
  { id: "pose.shoulder", re: /\bover (?:her|his|their|the) shoulder\b/i },
  { id: "pose.side", re: /\blying on (?:her|his|their) side\b/i },
  { id: "pose.stretch", re: /\bstretching\b/i },
  { id: "pose.bath", re: /\b(in (?:a|the) bath(?:tub)?|bathing)\b/i, nsfw: true },
  { id: "pose.shower", re: /\b(in (?:a|the) shower|showering)\b/i, nsfw: true },
  { id: "wardrobe.casual", re: /\b(t-?shirt|tee shirt|jeans|denim|hoodie)\b/i },
  { id: "wardrobe.smart", re: /\b(blazer|blouse|tuxedo|business suit|tailored suit|suit and tie|(?:a|in|wearing) (?:\w+ )?suit\b)/i },
  { id: "wardrobe.evening", re: /\b(evening (?:dress|gown)|ball ?gown|gown|cocktail dress)\b/i },
  { id: "wardrobe.sporty", re: /\b(sportswear|leggings|tracksuit|athletic wear|gym clothes)\b/i },
  { id: "wardrobe.swim", re: /\b(bikini|swimsuit|swimwear)\b/i, nsfw: true },
  { id: "wardrobe.lingerie", re: /\blingerie\b/i, nsfw: true },
  { id: "wardrobe.bodysuit", re: /\bbodysuit\b/i, nsfw: true },
  { id: "wardrobe.robe", re: /\b(silk robe|bathrobe|open robe)\b/i, nsfw: true },
  { id: "wardrobe.towel", re: /\b(?:in|wrapped in|only) a towel\b/i, nsfw: true },
  { id: "wardrobe.topless", re: /\btopless\b/i, nsfw: true },
  { id: "wardrobe.nude", re: /\b(nude|naked)\b/i, nsfw: true },
  { id: "accessories.glasses", re: /\b(?<!sun)(glasses|spectacles|eyeglasses)\b/i },
  { id: "accessories.sunglasses", re: /\bsunglasses\b/i },
  { id: "accessories.choker", re: /\bchoker\b/i },
  { id: "accessories.pearls", re: /\bpearls?\b/i },
  { id: "accessories.chain", re: /\b(gold chain|chain necklace)\b/i },
  { id: "accessories.earrings", re: /\bearrings?\b/i },
  { id: "accessories.watch", re: /\b(wrist ?watch)\b/i },
  { id: "accessories.heels", re: /\b(high heels|stilettos)\b/i },
  { id: "accessories.boots", re: /\bboots\b/i },
  { id: "accessories.hat", re: /\b(hat|fedora|beret|top hat|sun hat)\b/i },
  { id: "accessories.stockings", re: /\bstockings\b/i, nsfw: true },
  { id: "place.bedroom", re: /\b(bedroom|in bed|on (?:a|the) bed)\b/i },
  { id: "place.hotel", re: /\b(hotel|suite)\b/i },
  { id: "place.bathtub", re: /\b(bathtub|bathroom)\b/i },
  { id: "place.sofa", re: /\b(sofa|couch|living room)\b/i },
  { id: "place.kitchen", re: /\bkitchen\b/i },
  { id: "place.candlelit", re: /\bcandlelit\b/i },
  { id: "place.cabin", re: /\b(cabin|fireplace|log lodge)\b/i },
  { id: "place.sauna", re: /\bsauna\b/i },
  { id: "place.backdrop", re: /\b(studio backdrop|(?:white|grey|gray|black|plain) (?:backdrop|background)|photo studio)\b/i },
  { id: "place.beach", re: /\b(beach|seashore|shoreline)\b/i },
  { id: "place.pool", re: /\b(swimming pool|poolside)\b/i },
  { id: "place.rooftop", re: /\broof ?tops?\b/i },
  { id: "place.bar", re: /\b(cocktail bar|nightclub|night club|pub|tavern|(?:in|at) a bar)\b/i },
  { id: "light.natural", re: /\b(natural light(?:ing)?|daylight|sunlight)\b/i },
  { id: "light.warm", re: /\b(warm light(?:ing)?|moody|low[- ]key|chiaroscuro|shallow depth of field)\b/i },
  { id: "light.studio", re: /\b(studio light(?:ing)?|softbox|soft (?:studio )?light(?:ing)?)\b/i },
  { id: "light.golden", re: /\b(golden hour|golden light|sunset|sunrise)\b/i },
  { id: "light.neon", re: /\bneon\b/i },
  { id: "light.candle", re: /\b(candle ?light|candlelit|candles)\b/i },
  { id: "expression.smiling", re: /\b(smil(?:e|es|ing))\b/i },
  { id: "expression.laughing", re: /\blaugh(?:s|ing)?\b/i },
  { id: "expression.serious", re: /\b(serious|stern|stoic|solemn)\b/i },
  { id: "expression.playful", re: /\b(playful|mischievous|smirk(?:s|ing)?)\b/i },
  { id: "expression.sultry", re: /\b(sultry|smou?ldering)\b/i },
];

/**
 * Context the Studio has no tag for, kept apart by their "facet:" prefix: the medium (photo, painting, 3D render,
 * illustration) and who's in it (a woman, a man, a couple).
 */
export const FACET_RULES: readonly { id: string; label: string; re: RegExp }[] = [
  { id: "style:photo", label: "Photo", re: /\b(photo|photos|photograph\w*|photorealis\w*|dslr|canon|nikon|sony a\d\w*|\d+ ?mm|film still|polaroid|kodak|portra|hasselblad|f ?\/ ?\d)\b/i },
  { id: "style:painting", label: "Painting", re: /\b(painting|paintings|painted|oil on canvas|watercolou?r|acrylic|gouache|impasto|oil portrait)\b/i },
  { id: "style:3d", label: "3D render", re: /\b(3d|octane|unreal engine|render|rendered|rendering|blender|cgi|zbrush)\b/i },
  { id: "style:illustration", label: "Illustration", re: /\b(illustration|digital art|concept art|comic|anime|manga|cartoon|vector art|cel[- ]shaded|drawing|sketch|pencil)\b/i },
  { id: "subject:woman", label: "Woman", re: /\b(woman|women|woman's|lady|ladies|female|wife|actress|queen|princess|businesswoman)\b/i },
  { id: "subject:man", label: "Man", re: /\b(man|men|man's|male|gentleman|guy|king|businessman|husband)\b/i },
  { id: "subject:couple", label: "Couple", re: /\b(couple|lovers|man and (?:a )?woman|woman and (?:a )?man|two (?:women|men|people))\b/i },
];

/** A prompt's tags: its Studio tags in catalog order, then its facets. No NSFW tag ever lands on a youth-coded prompt. */
export function tagPrompt(text: string): string[] {
  const young = YOUNG.test(text);
  const studio = STUDIO_TAG_RULES.filter((r) => r.re.test(text) && !(r.nsfw && young)).map((r) => r.id);
  // A mirror selfie is the Studio's "mirror", not also its plain "selfie".
  const own = studio.includes("pov.mirror") && /\bmirror selfie\b/i.test(text) ? studio.filter((id) => id !== "pov.selfie") : studio;
  return [...own, ...FACET_RULES.filter((r) => r.re.test(text)).map((r) => r.id)];
}
