"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Provider = {
  label: string;
  baseUrl: string;
  defaultModel: string;
  models: readonly { readonly id: string; readonly note: string }[];
};

type ProviderPair = [string, Provider];

/** The BYOK form: pick a provider, paste a key, optionally override the model, test it, save it. */
export default function KeyForm({ providers }: { providers: ProviderPair[] }) {
  const router = useRouter();
  const [provider, setProvider] = useState<string>(providers[0][0]);
  const [key, setKey] = useState("");
  const [model, setModel] = useState<string>("");
  const [status, setStatus] = useState<null | { kind: "ok" | "err" | "busy"; text: string }>(null);
  const current = providers.find(([id]) => id === provider)![1];

  // Pre-fill the model with the provider's default when the dropdown changes.
  function onProvider(next: string) {
    setProvider(next);
    const def = providers.find(([id]) => id === next)![1].defaultModel;
    setModel(def);
  }

  async function test() {
    if (!key.trim()) return setStatus({ kind: "err", text: "Paste a key first." });
    setStatus({ kind: "busy", text: "Testing…" });
    try {
      const res = await fetch("/api/me/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, key, model: model || undefined }),
      });
      const body = await res.json();
      if (body?.test?.ok) {
        setStatus({ kind: "ok", text: `OK: ${body.test.model} replied in ${body.test.latency_ms}ms.` });
      } else {
        setStatus({ kind: "err", text: `Test failed: ${body?.test?.error ?? body?.message ?? "unknown"}.` });
      }
    } catch (e) {
      setStatus({ kind: "err", text: `Test failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function save() {
    if (!key.trim()) return setStatus({ kind: "err", text: "Paste a key first." });
    setStatus({ kind: "busy", text: "Saving…" });
    try {
      const res = await fetch("/api/me/keys", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, kind: "text", key, model: model || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setStatus({ kind: "err", text: `Save failed: ${body?.message ?? res.statusText}` });
      }
      setKey("");
      setStatus({ kind: "ok", text: "Saved." });
      router.refresh();
    } catch (e) {
      setStatus({ kind: "err", text: `Save failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function remove() {
    if (!confirm("Remove the key? Your dates go back to the shared platform model.")) return;
    setStatus({ kind: "busy", text: "Removing…" });
    try {
      const res = await fetch("/api/me/keys", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, kind: "text" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setStatus({ kind: "err", text: `Remove failed: ${body?.message ?? res.statusText}` });
      }
      setStatus({ kind: "ok", text: "Removed." });
      router.refresh();
    } catch (e) {
      setStatus({ kind: "err", text: `Remove failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  return (
    <form className="byok-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <label>
        <span>Provider</span>
        <select value={provider} onChange={(e) => onProvider(e.target.value)}>
          {providers.map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Model</span>
        <select value={model || current.defaultModel} onChange={(e) => setModel(e.target.value)}>
          {current.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id} — {m.note}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>API key</span>
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={`Your ${current.label} key`}
          minLength={8}
          maxLength={400}
          required
        />
      </label>
      <div className="byok-actions">
        <button type="submit" disabled={status?.kind === "busy"}>Save</button>
        <button type="button" className="secondary" onClick={test} disabled={status?.kind === "busy"}>
          Test
        </button>
        <button type="button" onClick={remove} disabled={status?.kind === "busy"} className="link-button danger">
          Remove
        </button>
      </div>
      {status && <p className={`byok-status ${status.kind}`}>{status.text}</p>}
      <p className="muted small">
        Keys are AES-256-GCM encrypted at rest, never logged, never shown back to you (only the last four). The
        test button runs one tiny call to the provider at your chosen model to confirm it works before you save.
      </p>
    </form>
  );
}
