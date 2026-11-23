import { readTropeMood, TROPE_MOOD_INFO, tropes } from "@/lib/relationship-tropes";
import { TOOL_CARD_SIZE, toolCard } from "../../card";

export const alt = "Botchelor's free relationship trope generator";
export const size = TOOL_CARD_SIZE;
export const contentType = "image/png";

/** A mood page's preview: its title and three of the tropes it shows. */
export default async function Image({ params }: { params: Promise<{ mood: string }> }) {
  const mood = readTropeMood((await params).mood) ?? "sweet";
  const names = tropes({ mood }).slice(0, 3).map((tr) => tr.name);
  return toolCard({ kicker: "Relationship trope generator", headline: TROPE_MOOD_INFO[mood].title, sub: `${names.join(" · ")}. Free, no sign-up.` });
}
