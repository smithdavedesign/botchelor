import { OC_NAME_STYLE_INFO, ocNames, readStyle } from "@/lib/oc-names";
import { TOOL_CARD_SIZE, toolCard } from "../../card";

export const alt = "Botchelor's free OC name generator";
export const size = TOOL_CARD_SIZE;
export const contentType = "image/png";

/** A style page's preview: its title and three of the names it shows. */
export default async function Image({ params }: { params: Promise<{ style: string }> }) {
  const style = readStyle((await params).style) ?? "modern";
  const names = ocNames({ style }).slice(0, 3).map((n) => n.name);
  return toolCard({ kicker: "OC name generator", headline: OC_NAME_STYLE_INFO[style].title, sub: `${names.join(" · ")}. Free, no sign-up.` });
}
