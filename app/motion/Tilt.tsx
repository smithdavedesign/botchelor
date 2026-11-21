"use client";

import { useRef, type ElementType, type PointerEvent, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  /** The element it renders as (a div by default; a span inside a line of text). */
  as?: ElementType;
  /** The most it leans, in degrees, at the card's edge. */
  max?: number;
};

/**
 * A card that leans toward the pointer (the motion kit's tilt, app/ux/motion.css .tilt). A mouse or a pen only, never a
 * finger: a phone's tap shouldn't wobble the card it opens. Reduced motion turns the lean off in CSS, so it only ever
 * writes two custom properties here.
 */
export default function Tilt({ children, className, as: Tag = "div", max = 6 }: Props) {
  const ref = useRef<HTMLElement>(null);
  const lean = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--tilt-x", `${(x * 2 * max).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(-y * 2 * max).toFixed(2)}deg`);
    el.classList.add("is-tilting");
  };
  const rest = () => {
    const el = ref.current;
    if (!el) return;
    el.style.removeProperty("--tilt-x");
    el.style.removeProperty("--tilt-y");
    el.classList.remove("is-tilting");
  };
  return (
    <Tag ref={ref} className={className ? `tilt ${className}` : "tilt"} onPointerMove={lean} onPointerLeave={rest}>
      {children}
    </Tag>
  );
}
