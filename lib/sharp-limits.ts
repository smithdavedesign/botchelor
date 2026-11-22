/**
 * sharp's limits for the whole process (2026-11-22 audit: the show's one 1 GB instance climbed to ~950 MB within an hour
 * of each deploy while the JS heap stayed near 200 MB, so the rest was native memory). Set once when the server starts
 * (instrumentation.ts register), before any request:
 *  - no operation cache: libvips keeps up to 50 MB and 100 operations by default, and nothing here repeats an operation
 *    (each small copy is made once and kept: lib/thumbs.ts, the shots);
 *  - one libvips thread per image: sharp's own default on glibc without jemalloc, said here so it can't drift.
 *
 * Both are libvips's own settings, held by sharp's one native binding, so every module that imports sharp (the routes and
 * lib/ files: one module through the build's externals) shares them. Next's image optimizer loads sharp's CommonJS build
 * on its first request, which resets the cache to libvips's default as it loads: next.config.ts sets the same limits for
 * it (experimental.imgOptOperationCache, imgOptConcurrency), which it applies straight after. The allocator itself is
 * held to two arenas by the start script (package.json: MALLOC_ARENA_MAX=2).
 */
export async function limitSharp(): Promise<void> {
  try {
    const { default: sharp } = await import("sharp");
    sharp.cache(false);
    sharp.concurrency(1);
  } catch (err) {
    // A server without sharp still serves everything else; its pictures fail on their own, as before.
    console.error("[sharp] limits not set:", err instanceof Error ? err.message : String(err));
  }
}
