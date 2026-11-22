/**
 * A failure the caller handles by carrying on still reaches the run log, labelled with where it happened:
 * `.catch(soft("date job: renew lease"))` or `.catch(soft("plans: reminder email", false))` in place of
 * `.catch(() => {})` / `.catch(() => false)`, which drop the error where nobody sees it. The line reads
 * `[soft] <label>: <error>`. In a `catch` block, `logSoft(label, err)` writes the same line.
 */
export function soft(label: string): (err: unknown) => undefined;
export function soft<T>(label: string, fallback: T): (err: unknown) => T;
export function soft<T>(label: string, fallback?: T): (err: unknown) => T | undefined {
  return (err) => {
    logSoft(label, err);
    return fallback;
  };
}

/** Writes `[soft] <label>: <error>` for an error that's handled by carrying on. */
export function logSoft(label: string, err: unknown): void {
  const what = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[soft] ${label}: ${what.slice(0, 500)}`);
}
