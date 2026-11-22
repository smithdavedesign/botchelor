/**
 * The kept "two of you" lines of an import (lib/import-history.ts), between /import and the companion memory. They can
 * only be written once the character exists, so /import leaves them in this browser (HISTORY_US_KEY, never on the
 * server), the builder sends them when Create answers (sendHeldUs → POST /api/characters/:id/import-history), and when
 * the memory can't be written yet they stay here, bound to that character, for the memory page to offer
 * (app/companion/[id]/memory/HeldImport.tsx). One import at a time: a new one replaces what an unfinished one left.
 */
import { HISTORY_ITEMS_MAX, HISTORY_US_KEEP_MS, HISTORY_US_KEY } from "@/lib/import-history";
import { requestJson } from "@/app/request";

type Held = { name: string; items: string[]; at: number; characterId?: string };

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function read(now = Date.now()): Held | null {
  try {
    const raw = localStorage.getItem(HISTORY_US_KEY);
    if (!raw) return null;
    const h = JSON.parse(raw) as Partial<Held>;
    const items = Array.isArray(h.items) ? h.items.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, HISTORY_ITEMS_MAX) : [];
    if (!items.length || typeof h.at !== "number" || now - h.at > HISTORY_US_KEEP_MS) {
      localStorage.removeItem(HISTORY_US_KEY);
      return null;
    }
    return { name: typeof h.name === "string" ? h.name : "", items, at: h.at, ...(typeof h.characterId === "string" ? { characterId: h.characterId } : {}) };
  } catch {
    return null;
  }
}

function write(h: Held | null): boolean {
  try {
    if (h) localStorage.setItem(HISTORY_US_KEY, JSON.stringify(h));
    else localStorage.removeItem(HISTORY_US_KEY);
    return true;
  } catch {
    return false;
  }
}

/** /import: the lines the person kept, for the character of this name (none: whatever an earlier import left is cleared). */
export function holdUs(name: string, items: readonly string[]): boolean {
  return write(items.length ? { name, items: [...items], at: Date.now() } : null);
}

/** The memory page: lines waiting for this character, if any. */
export function heldUsFor(characterId: string): string[] {
  const h = read();
  return h && h.characterId === characterId ? h.items : [];
}

export type ImportMemoryNote =
  | { kind: "kept"; kept: number; dropped: number; href: string | null }
  | { kind: "held"; count: number; message: string };

/**
 * The builder, once Create answered: sends the lines an import left for this character, if it left any. They are this
 * character's when the builder still knows it opened from the import, or the name is the one that was imported (a
 * reload forgets the first; a rename loses the second, and then nothing is sent to anyone). Written: the lines leave
 * this browser. Not yet: they stay, bound to the character. Null when there was nothing to send.
 */
export async function sendHeldUs(characterId: string, name: string, fromImport: boolean): Promise<ImportMemoryNote | null> {
  const h = read();
  if (!h || h.characterId || !(fromImport || same(h.name, name))) return null;
  return flushHeldUs(characterId, { ...h, characterId });
}

/** The memory page's "Add them": the same send, for lines already bound to this character. */
export async function sendHeldUsFor(characterId: string): Promise<ImportMemoryNote | null> {
  const h = read();
  if (!h || h.characterId !== characterId) return null;
  return flushHeldUs(characterId, h);
}

async function flushHeldUs(characterId: string, h: Held): Promise<ImportMemoryNote> {
  const waiting = (message: string): ImportMemoryNote => {
    write(h);
    return { kind: "held", count: h.items.length, message };
  };
  try {
    const { ok, data } = await requestJson(`/api/characters/${characterId}/import-history`, { us: h.items });
    if (!ok) return waiting("They're kept in this browser for now: they couldn't be saved just yet.");
    if (data.held === true) return waiting(typeof data.message === "string" ? data.message : "They're kept in this browser until you can text them.");
    write(null);
    return { kind: "kept", kept: Number(data.kept) || 0, dropped: Number(data.dropped) || 0, href: typeof data.href === "string" ? data.href : null };
  } catch {
    return waiting("They're kept in this browser for now: the connection dropped.");
  }
}
