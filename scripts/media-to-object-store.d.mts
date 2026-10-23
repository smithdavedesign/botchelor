/** Types for scripts/media-to-object-store.mjs, which stays plain JS so it runs with no build step. */
export function mediaKey(area: "after-dark" | "looks", id: string, bytes: Buffer, mime: string): string;
/** The bucket's client (scripts/media-to-bunny.mjs copies with it too). */
export function bucket(env: Record<string, string | undefined>): Promise<{
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  head(key: string): Promise<{ size: number; sha256: string | null } | null>;
  cors(origins: string[]): Promise<void>;
}>;
