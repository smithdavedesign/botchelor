/**
 * Sealing stored provider keys (docs/PRDs/connections.md, "Security model"). Every key a person brings
 * (lib/connections.ts) and every house key After Dark keeps (lib/adult/settings.ts) is stored AES-256-GCM encrypted
 * and never read back to anyone: the server opens one only to call its provider.
 *
 * Two sealing keys, told apart by the ciphertext itself:
 *  - **v2**: derived (HKDF-SHA256) from KEY_ENCRYPTION_SECRET, a secret of its own. The ciphertext starts "v2:" and is
 *    bound to where it's stored (the row's context is the AES-GCM associated data), so a sealed key copied onto
 *    another row, or another person, doesn't open there.
 *  - **legacy** (M16): derived from SESSION_SECRET. Rotating SESSION_SECRET would have made every stored key
 *    unreadable, which is why v2 exists.
 *
 * New writes use v2 when KEY_ENCRYPTION_SECRET is set (MIN_KEY_SECRET_LENGTH or longer), else legacy, so nothing
 * changes before the secret is added. Reads open either. A legacy key is sealed again as v2 the next time it's read
 * or saved (lib/connections.ts openKeyFor, lib/adult/settings.ts adultKeys), or all at once from the admin's Stored
 * keys panel. Once that panel counts no legacy keys, SESSION_SECRET can be rotated without losing one.
 *
 * Nothing here logs, and nothing here puts a key (or any part of one) in an error message.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

type Env = Record<string, string | undefined>;

/** A sealed key as it's stored: the ciphertext (with its auth tag, and "v2:" in front for v2) and the nonce. */
export type Sealed = { ciphertext: string; nonce: string };
export type SealVersion = "v2" | "legacy";

export const V2_PREFIX = "v2:";
/** The shortest KEY_ENCRYPTION_SECRET used: anything shorter is ignored (and the admin panel says so). */
export const MIN_KEY_SECRET_LENGTH = 32;

/** Whether KEY_ENCRYPTION_SECRET is set and long enough to use. */
export type KeySecretState = "on" | "off" | "too_short";
export function keySecretState(env: Env = process.env): KeySecretState {
  const secret = env.KEY_ENCRYPTION_SECRET ?? "";
  if (!secret) return "off";
  return secret.length >= MIN_KEY_SECRET_LENGTH ? "on" : "too_short";
}

function v2Key(env: Env): Buffer | null {
  if (keySecretState(env) !== "on") return null;
  return Buffer.from(hkdfSync("sha256", env.KEY_ENCRYPTION_SECRET!, Buffer.from("botchelor-keys-v2"), Buffer.from("stored-provider-keys"), 32));
}

/** M16's sealing key, from SESSION_SECRET (the same derivation as before, so every stored key still opens). */
function legacyKey(env: Env): Buffer | null {
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  return Buffer.from(hkdfSync("sha256", secret, Buffer.from("botchelor-byok-v1"), Buffer.from("user-keys"), 32));
}

/** v2's associated data: where the key is stored ("user:<id>:<provider>", "adult:openrouter"). */
const aad = (context: string) => Buffer.from(`botchelor-key:${context}`, "utf8");

/** True when a key can be sealed here at all (either secret). */
export const canSeal = (env: Env = process.env): boolean => v2Key(env) !== null || legacyKey(env) !== null;

/** The version a new seal gets right now. */
export const currentSealVersion = (env: Env = process.env): SealVersion | null => (v2Key(env) ? "v2" : legacyKey(env) ? "legacy" : null);

export const sealVersion = (sealed: { ciphertext: string }): SealVersion => (sealed.ciphertext.startsWith(V2_PREFIX) ? "v2" : "legacy");

/** Seals a key for storing at `context`: v2 when KEY_ENCRYPTION_SECRET is on, else legacy. Throws when neither secret is set. */
export function sealKey(plain: string, context: string, env: Env = process.env): Sealed {
  const v2 = v2Key(env);
  const key = v2 ?? legacyKey(env);
  if (!key) throw new Error("keys can't be stored here: neither KEY_ENCRYPTION_SECRET nor SESSION_SECRET is set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // Legacy seals carried no associated data; keeping it that way is what lets the old rows still open.
  if (v2) cipher.setAAD(aad(context));
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext: (v2 ? V2_PREFIX : "") + enc.toString("base64"), nonce: iv.toString("base64") };
}

/**
 * Opens a sealed key stored at `context`, or null: the secret it needs isn't set (a v2 key once KEY_ENCRYPTION_SECRET
 * is gone, a legacy one without SESSION_SECRET), it was sealed under another secret, or it was moved from where it
 * was sealed (v2). Never throws.
 */
export function openKey(sealed: Sealed, context: string, env: Env = process.env): string | null {
  const v2 = sealVersion(sealed) === "v2";
  const key = v2 ? v2Key(env) : legacyKey(env);
  if (!key) return null;
  try {
    const raw = Buffer.from(v2 ? sealed.ciphertext.slice(V2_PREFIX.length) : sealed.ciphertext, "base64");
    if (raw.length <= 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.nonce, "base64"));
    if (v2) decipher.setAAD(aad(context));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Whether a stored key should be sealed again as v2: it's legacy, and v2 is on. */
export const needsReseal = (sealed: { ciphertext: string }, env: Env = process.env): boolean => sealVersion(sealed) === "legacy" && v2Key(env) !== null;

/**
 * A legacy key opened and sealed again as v2, with what it opened to (the caller is about to use it): null when it
 * doesn't need it (already v2, or v2 isn't on) or can't be opened.
 */
export function reseal(sealed: Sealed, context: string, env: Env = process.env): { sealed: Sealed; plain: string } | null {
  if (!needsReseal(sealed, env)) return null;
  const plain = openKey(sealed, context, env);
  if (plain === null) return null;
  return { sealed: sealKey(plain, context, env), plain };
}
