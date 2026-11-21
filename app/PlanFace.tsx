import Avatar from "@/app/Avatar";
import FaceLoop from "@/app/FaceLoop";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";
import { characterPortrait } from "@/lib/portraits";

/** The companion the plan card shows: one of the house cast with a moving face (lib/face-loops.ts). */
const FACE_ID = "house-juniper";
const SIZE = 60;

/**
 * The Companion Plan card's face (pass 2 of the 2026-11-20 visual pop audit): a house companion mid-sentence, their
 * silent face loop inside the call screen's talking pulse (app/ux/companion.css companion-call-talking). Decorative:
 * the card's words say what the plan is. Under reduced motion it's the portrait with a still ring.
 */
export default function PlanFace() {
  const c = ALL_HOUSE_CHARACTERS.find((h) => h.id === FACE_ID);
  if (!c) return null;
  return (
    <span className="plan-face" aria-hidden="true">
      <FaceLoop id={c.id} radius={SIZE / 2}>
        <Avatar seed={c.id} name={c.name} hue={c.hue} house size={SIZE} portraitSrc={characterPortrait(c.id)} decorative round />
      </FaceLoop>
    </span>
  );
}
