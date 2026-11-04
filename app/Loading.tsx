/**
 * The house loading mark: two dots, one each of the brand's two colours, circling each other and drawing close, then
 * apart (David, 2026-11-04: writing a scene had no clear sign it was working). One atom for every wait. Styles are
 * `.loading` in app/globals.css.
 *
 * - `tone="current"` draws it in the text colour, for a button or a note.
 * - `label` is read to screen readers. Leave it out when visible words beside the mark already say what's happening.
 * - `status` makes it a live region. Don't use that inside a button.
 */
export default function Loading({
  label,
  size = "md",
  tone = "brand",
  status = false,
  className,
}: {
  label?: string;
  size?: "sm" | "md" | "lg";
  tone?: "brand" | "current";
  status?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`loading loading-${size} loading-${tone}${className ? ` ${className}` : ""}`}
      role={status ? "status" : undefined}
      aria-hidden={label || status ? undefined : true}
      data-loading
    >
      <span className="loading-mark" aria-hidden="true" />
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
