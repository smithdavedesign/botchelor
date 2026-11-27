/**
 * The show's wax seal (2026-11-27, the finish pass): a rose pressed into red wax, the envelope's seal made into the
 * site's one repeated mark. A 404, a ship's top pick, the paid pack and the footer carry it, so the show signs its pages
 * the same way everywhere. Pure SVG on tokens (app/ux/finish.css .rose-seal), no request, decorative unless labelled.
 */
export default function RoseSeal({ size = "md", label, className }: { size?: "sm" | "md" | "lg"; label?: string; className?: string }) {
  const cls = ["rose-seal", size === "md" ? "" : `rose-seal-${size}`, className ?? ""].filter(Boolean).join(" ");
  return (
    <svg className={cls} viewBox="0 0 64 64" focusable="false" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      {/* The wax: a soft, uneven disc, as a seal spreads when it's pressed. */}
      <path
        d="M32 3c4 0 6 2.5 9.5 3.4 3.6.9 6.8-.4 9.4 2.4 2.5 2.7 1.6 6 2.9 9.3 1.3 3.3 4.2 5.6 4.2 9.9s-2.6 6.3-3.4 9.9c-.8 3.6.6 6.9-2 9.6-2.7 2.8-6.1 1.9-9.5 3.2-3.3 1.3-5.3 4.3-9.6 4.3-4.2 0-6.3-2.9-9.6-4.2-3.4-1.3-6.8-.3-9.5-3.1-2.6-2.7-1.3-6-2.1-9.6C5.5 36.6 3 34.4 3 30.2s2.8-6.6 4.1-9.9c1.3-3.3.4-6.7 3-9.4 2.6-2.8 5.9-1.6 9.5-2.5C23.1 7.5 28 3 32 3Z"
        fill="var(--seal-wax)"
      />
      {/* The pressed ring, lighter where the die stamped it. */}
      <circle cx="32" cy="31" r="20" fill="none" stroke="var(--seal-wax-light)" strokeWidth="2.2" />
      <circle cx="32" cy="31" r="16.5" fill="var(--seal-wax-light)" opacity="0.35" />
      {/* The rose: a spiral bloom, two leaves and a stem. */}
      <g fill="none" stroke="var(--seal-rose)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 23.5c-3.4 0-5.8 2.6-5.8 5.6 0 3.3 2.7 5.6 5.8 5.6s5.8-2.3 5.8-5.6" />
        <path d="M37.8 29.1c0-2.4-1.9-4.2-4.2-4.2-2 0-3.6 1.5-3.6 3.4 0 1.7 1.3 2.9 2.9 2.9 1.4 0 2.4-1 2.4-2.2" />
        <path d="M32 34.7v8.3" />
        <path d="M32 39.5c-1.6-2.4-4.2-3-6.4-2.4 1 2.5 3.6 3.6 6.4 2.4Z" />
        <path d="M32 38c1.6-2.4 4.2-3 6.4-2.4-1 2.5-3.6 3.6-6.4 2.4Z" />
      </g>
    </svg>
  );
}
