/**
 * The visible "AI-generated" labels (EU AI Act Art. 50; the companion-chatbot laws' "tell people it's AI"), quiet and
 * the same everywhere (docs/after-dark.md "AI marking, crisis notice and profile consent"). The machine-readable mark
 * is in the files themselves (lib/ai-mark.ts).
 *
 *  - AiTag: a small pill on or beside a generated picture or video (`over` sits it on the picture's corner; the parent
 *    has to be positioned).
 *  - AiFiction: the one line where people meet characters (character pages, the text thread, After Dark).
 *
 * Venue backdrops behind a scene are decorative and carry no tag (the scene's own AI line covers them); their files
 * are still marked.
 */
export const AI_FICTION = "Characters and dates are AI-generated fiction.";
export const AI_FICTION_AFTER_DARK = "Characters, scenes, pictures, videos and voices here are AI-generated fiction.";

export function AiTag({ over = false, label = "AI-generated" }: { over?: boolean; label?: string }) {
  return <span className={`ai-tag${over ? " ai-tag-over" : ""}`}>{label}</span>;
}

export function AiFiction({ text = AI_FICTION, className }: { text?: string; className?: string }) {
  return <p className={`ai-fiction${className ? ` ${className}` : ""}`}>{text}</p>;
}
