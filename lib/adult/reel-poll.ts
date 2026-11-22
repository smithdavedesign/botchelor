/**
 * The page asking after its videos being made (app/after-dark/[a]/[b]/SceneWriter.tsx): one ask at a time, the next only
 * once the last has answered and `everyMs` more has passed, and none for a video once it's done. An ask collects the
 * finished shots (lib/adult/reels.ts advanceReel), which can take longer than the gap, and a timer that didn't wait sent
 * the next one while the last was still collecting (2026-11-22). No imports, so a client component can take it.
 * Returns the stop.
 */
export function pollReels<R extends { status: string }>(ids: readonly string[], ask: (id: string) => Promise<R | null>, onReel: (r: R) => void, everyMs: number): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let left = [...ids];
  const round = async () => {
    for (const id of [...left]) {
      const r = await ask(id).catch(() => null);
      if (stopped) return;
      if (!r) continue;
      onReel(r);
      if (r.status !== "making") left = left.filter((x) => x !== id);
    }
    if (left.length) timer = setTimeout(round, everyMs);
  };
  timer = setTimeout(round, everyMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
