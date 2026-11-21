/**
 * A place's name in the middle of a sentence (pure, no imports, safe in the browser). The show's hangouts are named like
 * descriptions ("A rooftop bar at golden hour", "An all-night diner"), so after "Regular at" or "Regulars at" their
 * article goes lower case: "Regular at a rooftop bar at golden hour". A proper name stays as it is ("The Heights",
 * "The Salt Lantern", "Bean There"). One rule for "X's world", the pair card, the sky's place stars, cluster names and
 * the People tab.
 */
export const midSentence = (name: string): string => name.replace(/^(A|An) /, (w) => w.toLowerCase());

/** A place's name with no leading article, for words that bring their own ("The Bean There crew", "The Leeds lot"). */
export const bareName = (name: string): string => name.trim().replace(/^(the|an?)\s+/i, "");
