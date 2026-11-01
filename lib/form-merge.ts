/**
 * A form after a save: the server's copy, except a field changed in the form since the last save, and not part of
 * this one, keeps what was typed. `base` is the server's copy as last loaded or saved; `sent` says which fields the
 * save carried. 2026-10-31 UX audit: in /admin/after-dark/settings, ticking an instant checkbox replaced the whole
 * form with the server's copy, so every typed and unsaved change in it reverted.
 */
export function mergeSaved<T extends Record<string, unknown>>(current: T, base: T, saved: T, sent: (key: string) => boolean): T {
  const out = { ...saved };
  for (const k of Object.keys(current) as (keyof T & string)[]) {
    if (!sent(k) && JSON.stringify(current[k]) !== JSON.stringify(base[k])) out[k] = current[k];
  }
  return out;
}
