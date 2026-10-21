/** Types for scripts/media-to-object-store.mjs, which stays plain JS so it runs with no build step. */
export function mediaKey(area: "after-dark" | "looks", id: string, bytes: Buffer, mime: string): string;
