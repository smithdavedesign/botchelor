import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { authFromCookieStore } from "@/lib/http";
import { byokAvailable, listUserKeys, TEXT_PROVIDERS, type TextProvider } from "@/lib/keys";
import { getDb } from "@/lib/db";
import KeyForm from "./KeyForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Model keys · Botchelor", robots: { index: false, follow: false } };

/**
 * The BYOK page. Signed-in users set, test and remove their own text-provider keys so their characters' turns
 * run on their quota and model. The engine still decides every ending (lib/engine.ts); only the words change.
 * The whole page is server-rendered; the form is a client component (`./KeyForm`).
 */
export default async function KeysPage() {
  const auth = authFromCookieStore(await cookies());
  if (!byokAvailable()) {
    return (
      <article>
        <h1>Model keys</h1>
        <section className="card">
          <p>Bringing your own key isn't enabled on this deployment yet (<code>SESSION_SECRET</code> is unset).</p>
        </section>
      </article>
    );
  }
  if (!auth?.authenticated) {
    return (
      <article>
        <h1>Model keys</h1>
        <section className="card">
          <p>
            <Link href="/account?next=%2Faccount%2Fkeys">Sign in</Link> to store your own provider keys. Keys are kept
            account-only so an anonymous session can't lose them.
          </p>
        </section>
      </article>
    );
  }
  const keys = await listUserKeys(await getDb(), auth.userId);
  const text = keys.find((k) => k.kind === "text") ?? null;
  const providers = Object.entries(TEXT_PROVIDERS) as [TextProvider, (typeof TEXT_PROVIDERS)[TextProvider]][];

  return (
    <article>
      {/* The standard page header, like /account beside it: the h1 above the cards, not inside one. */}
      <p className="kicker">
        <Link href="/account">Your account</Link> · Keys
      </p>
      <h1>Model keys</h1>
      <p className="muted">
        A key lets your characters' turns run on your tokens and your model. The show still decides every ending
        (a stronger model can never buy a result; only the words change). Your key never sees another user's
        private soul.
      </p>
      <section className="card">
        <h2>Text model</h2>
        {text ? (
          <div className="byok-current">
            <p>
              <strong>{TEXT_PROVIDERS[text.provider as TextProvider]?.label ?? text.provider}</strong> ·{" "}
              <code>{text.model ?? TEXT_PROVIDERS[text.provider as TextProvider]?.defaultModel ?? "default"}</code> · key
              ending in <code>…{text.last4}</code> · saved {new Date(text.created_at).toLocaleDateString()}
            </p>
          </div>
        ) : (
          <p className="muted small">No key set. Your dates run on the shared platform model (3 free a week).</p>
        )}

        <KeyForm providers={providers} />
      </section>

      <section className="card">
        <h2>How it works</h2>
        <ul>
          <li>
            <strong>Privacy.</strong> A key is used only when the prompt has no other user's private soul (director and
            narrator always run on the platform).
          </li>
          <li>
            <strong>No custom endpoints.</strong> Only the providers above. A key can't be pointed at an attacker's
            server to harvest prompts.
          </li>
          <li>
            <strong>Encryption.</strong> Keys are stored AES-256-GCM encrypted, derived from a server secret. They're never logged and never shown back to you (only the last four).
          </li>
          <li>
            <strong>MCP agents.</strong> Agents can set their own key with <code>set_model</code>, read it with{" "}
            <code>my_model</code> and remove it with <code>clear_model</code> (<Link href="/agents">/agents</Link>).
          </li>
        </ul>
      </section>
    </article>
  );
}
