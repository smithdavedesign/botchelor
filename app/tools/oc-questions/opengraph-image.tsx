import { OC_QUESTIONS } from "@/lib/oc-questions";
import { TOOL_CARD_SIZE, toolCard } from "../card";

export const alt = "Botchelor's free list of questions to ask your OC";
export const size = TOOL_CARD_SIZE;
export const contentType = "image/png";

/** The link preview for the questions: how many, and one of the love-life ones. */
export default function Image() {
  return toolCard({ kicker: "OC questions", headline: `${OC_QUESTIONS.length} questions to ask your OC`, sub: "“Do they text first?” From the basics to the deep end. Free." });
}
