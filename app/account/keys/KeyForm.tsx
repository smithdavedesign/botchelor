"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/app/request";
import { CAP_MAX_USD, DEFAULT_ON_CAP, type CapSettings, type Feel, type Job, type ModelOption, type OnCap, type PlainError, type UserProvider } from "@/lib/connections-shared";
import FeelPicker, { feelValue, type FeelValue } from "./FeelPicker";
import ModelPicker from "./ModelPicker";
import ProviderMark from "./ProviderMark";

/** A provider the flow offers for this job, with the key already stored for it (its last four), if any. */
export type FlowProvider = {
  id: UserProvider;
  label: string;
  blurb: string;
  keyHint: string;
  keysUrl: string;
  stored: { last4: string } | null;
  /** The curated models to start from; the key's own list replaces them once it's known (a Test, or a stored key's). */
  models: ModelOption[];
};

/** Another job this key could do too, offered as "Also use it for …" when that job has no key yet. */
export type AlsoJob = { job: Job; title: string; providers: UserProvider[]; note: string };

type Check = { state: "busy" } | { state: "ok"; text: string } | { state: "error"; error: PlainError };

const fixLink = (e: PlainError) =>
  e.fix &&
  (e.fix.href ? (
    <>
      {" "}
      →{" "}
      <a href={e.fix.href} target="_blank" rel="noopener noreferrer">
        {e.fix.label}
      </a>
    </>
  ) : (
    <> → {e.fix.label}</>
  ));

/**
 * Connecting a key for one job (docs/PRDs/connections.md "The connect flow"): pick the provider, paste the key, Test it
 * live (free: the provider's key or model list, nothing spent), pick the model from the ones the key can use (M2: tagged
 * and priced), pick the feel (Dates & texts: Steady, Lively, Wild, or Advanced), Save. A key already stored for the
 * provider can be used again without pasting. The key lives only in this form until it's saved; after that it's never
 * sent back, and the page shows its last four.
 */
export default function KeyForm({
  job,
  jobTitle,
  providers,
  current,
  also,
  onDone,
}: {
  job: Job;
  jobTitle: string;
  providers: FlowProvider[];
  current: { provider: string | null; model: string | null; feel?: Feel | null; cap?: CapSettings | null };
  also: AlsoJob[];
  onDone: () => void;
}) {
  const router = useRouter();
  const ids = useId();
  const first = providers.find((p) => p.id === current.provider) ?? (providers.length === 1 ? providers[0] : null);
  const [providerId, setProviderId] = useState<UserProvider | null>(first?.id ?? null);
  const provider = providers.find((p) => p.id === providerId) ?? null;
  const [useStored, setUseStored] = useState<boolean>(Boolean(first?.stored));
  const [key, setKey] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const recommended = (p: FlowProvider | null) => p?.models.find((m) => m.tags.includes("recommended"))?.id ?? p?.models[0]?.id ?? "";
  const [model, setModel] = useState<string>(current.provider === first?.id && current.model ? current.model : recommended(first));
  // The models the step offers: the curated ones until the key's own list arrives (from Test, or fetched for a stored key).
  const [options, setOptions] = useState<{ provider: UserProvider | null; models: ModelOption[]; source: "provider" | "curated"; loading: boolean }>({
    provider: first?.id ?? null,
    models: first?.models ?? [],
    source: "curated",
    loading: false,
  });
  const [feel, setFeel] = useState<FeelValue>(feelValue(current.feel ?? null));
  // M3: the monthly cap ("" is none) and, for Dates & texts, what happens at it or when the key fails.
  const [cap, setCap] = useState<string>(current.cap?.cap_usd != null ? String(current.cap.cap_usd) : "");
  const [onCap, setOnCap] = useState<OnCap>(current.cap?.on_cap ?? DEFAULT_ON_CAP);
  const [alsoJobs, setAlsoJobs] = useState<Set<Job>>(new Set(also.filter((a) => first && a.providers.includes(first.id)).map((a) => a.job)));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<PlainError | string | null>(null);

  function pick(next: FlowProvider) {
    setProviderId(next.id);
    setUseStored(Boolean(next.stored));
    setKey("");
    setCheck(null);
    setSaveError(null);
    setModel(current.provider === next.id && current.model ? current.model : recommended(next));
    setOptions({ provider: next.id, models: next.models, source: "curated", loading: false });
    setAlsoJobs(new Set(also.filter((a) => a.providers.includes(next.id)).map((a) => a.job)));
  }

  // A stored key goes straight to the model step: fetch the models it listed at its last check (OpenRouter's live list).
  const storedPick = useStored && provider?.stored ? provider.id : null;
  useEffect(() => {
    if (!storedPick) return;
    let gone = false;
    setOptions((o) => ({ ...o, loading: true }));
    fetch(`/api/me/connections/models?provider=${encodeURIComponent(storedPick)}&job=${encodeURIComponent(job)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { models?: ModelOption[]; source?: "provider" | "curated" } | null) => {
        if (gone) return;
        if (d?.models?.length) setOptions({ provider: storedPick, models: d.models, source: d.source ?? "provider", loading: false });
        else setOptions((o) => ({ ...o, loading: false }));
      })
      .catch(() => !gone && setOptions((o) => ({ ...o, loading: false })));
    return () => {
      gone = true;
    };
  }, [storedPick, job]);

  async function test() {
    if (!provider || !key.trim()) return setCheck({ state: "error", error: { kind: "invalid_key", message: "Paste a key first.", fix: null } });
    setCheck({ state: "busy" });
    const r = await requestJson("/api/me/connections/check", { provider: provider.id, key, job }).catch(() => null);
    if (!r) return setCheck({ state: "error", error: { kind: "unreachable", message: "Couldn't reach Botchelor.", fix: { label: "Try again", href: null } } });
    const d = r.data as { ok?: boolean; models_count?: number | null; models?: ModelOption[]; error?: PlainError };
    if (r.ok && d.ok) {
      const count = typeof d.models_count === "number" ? ` · ${d.models_count} models on this key` : "";
      setCheck({ state: "ok", text: `✓ ${provider.label} accepted it${count}. Nothing is stored until you save.` });
      if (d.models?.length) {
        setOptions({ provider: provider.id, models: d.models, source: "provider", loading: false });
        if (!d.models.some((m) => m.id === model)) setModel(d.models.find((m) => m.tags.includes("recommended"))?.id ?? d.models[0].id);
      }
    } else setCheck({ state: "error", error: d.error ?? { kind: "unknown", message: r.message, fix: null } });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!provider) return;
    if (!useStored && !key.trim()) return setSaveError("Paste a key first.");
    setSaving(true);
    setSaveError(null);
    const sampling =
      job === "text"
        ? {
            preset: feel.preset,
            ...(feel.temperature !== null ? { temperature: feel.temperature } : {}),
            ...(feel.frequency_penalty !== null ? { frequency_penalty: feel.frequency_penalty } : {}),
            ...(feel.presence_penalty !== null ? { presence_penalty: feel.presence_penalty } : {}),
          }
        : {};
    const capUsd = cap.trim() === "" ? null : Math.min(CAP_MAX_USD, Math.max(0, Number(cap) || 0));
    const limits = { cap_usd: capUsd, ...(job === "text" ? { on_cap: onCap } : {}) };
    const body = { job, provider: provider.id, model: model || undefined, also: [...alsoJobs], ...sampling, ...limits, ...(useStored ? {} : { key }) };
    const r = await requestJson("/api/me/connections", body, "PUT").catch(() => null);
    setSaving(false);
    if (!r) return setSaveError("Couldn't reach Botchelor. Try again.");
    const d = r.data as { message?: string; kind?: PlainError["kind"]; fix?: PlainError["fix"] };
    if (!r.ok) return setSaveError(d.kind ? { kind: d.kind, message: d.message ?? r.message, fix: d.fix ?? null } : r.message);
    setKey(""); // gone from the page: from here on it's the last four only
    onDone();
    router.refresh();
  }

  const ready = Boolean(provider) && (useStored || check?.state === "ok");
  const offered = also.filter((a) => provider && a.providers.includes(provider.id));
  // The current model stays on offer even when the list doesn't carry it (a model picked before, or one it dropped).
  const shownOptions =
    options.provider === provider?.id
      ? model && !options.models.some((m) => m.id === model)
        ? [{ id: model, note: "your current model", tags: [], price: null, perDate: null }, ...options.models]
        : options.models
      : (provider?.models ?? []);
  const n = providers.length > 1 ? 1 : 0;

  return (
    <form className="connect-flow" onSubmit={save} aria-label={`Connect a key for ${jobTitle}`}>
      {providers.length > 1 && (
        <fieldset className="connect-step">
          <legend>1. Provider</legend>
          <div className="connect-providers">
            {providers.map((p) => (
              <label key={p.id} className={`connect-provider${p.id === providerId ? " is-picked" : ""}`}>
                <input type="radio" name={`${ids}-provider`} value={p.id} checked={p.id === providerId} onChange={() => pick(p)} />
                <ProviderMark provider={p.id} size={30} />
                <span>
                  <strong>{p.label}</strong>
                  <span className="muted small">{p.stored ? `Your key •••• ${p.stored.last4} ✓` : p.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {provider && (
        <fieldset className="connect-step">
          <legend>{n + 1}. Key</legend>
          {provider.stored && (
            <div className="connect-choice">
              <label>
                <input type="radio" name={`${ids}-key`} checked={useStored} onChange={() => setUseStored(true)} /> Use your {provider.label} key (•••• {provider.stored.last4})
              </label>
              <label>
                <input type="radio" name={`${ids}-key`} checked={!useStored} onChange={() => setUseStored(false)} /> Paste a different key
              </label>
            </div>
          )}
          {!useStored && (
            <>
              <label className="connect-key">
                <span>{provider.label} API key</span>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setCheck(null);
                  }}
                  placeholder={provider.keyHint}
                  minLength={8}
                  maxLength={400}
                  aria-describedby={`${ids}-key-hint`}
                />
              </label>
              <p id={`${ids}-key-hint`} className="muted small">
                {provider.keyHint}.{" "}
                <a href={provider.keysUrl} target="_blank" rel="noopener noreferrer">
                  Make a key on {provider.label}
                </a>
                , and set a spend limit on it there.
              </p>
              <div className="byok-actions">
                <button type="button" className="secondary" onClick={test} disabled={check?.state === "busy" || !key.trim()}>
                  {check?.state === "busy" ? "Testing…" : "Test"}
                </button>
              </div>
              <p className="connect-check" aria-live="polite">
                {check?.state === "ok" && <span className="byok-status ok">{check.text}</span>}
                {check?.state === "error" && (
                  <span className="byok-status err">
                    {check.error.message}
                    {fixLink(check.error)}
                  </span>
                )}
              </p>
            </>
          )}
        </fieldset>
      )}

      {ready && provider && (
        <>
          <fieldset className="connect-step">
            <legend>{n + 2}. Model</legend>
            <ModelPicker options={shownOptions} value={model} onChange={setModel} loading={options.loading} source={options.provider === provider.id ? options.source : "curated"} />
          </fieldset>
          {job === "text" && (
            <fieldset className="connect-step">
              <legend>{n + 3}. Feel</legend>
              <FeelPicker provider={provider.id} value={feel} onChange={setFeel} />
            </fieldset>
          )}
          <fieldset className="connect-step">
            <legend>{n + (job === "text" ? 4 : 3)}. Monthly cap</legend>
            <label className="connect-cap">
              <span>Spend at most</span>
              <span className="cap-input">
                <span aria-hidden="true">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={CAP_MAX_USD}
                  step={1}
                  value={cap}
                  placeholder="no cap"
                  onChange={(e) => setCap(e.target.value)}
                  aria-describedby={`${ids}-cap-note`}
                />
              </span>
            </label>
            <p id={`${ids}-cap-note`} className="muted small">
              A month, on this job (it resets on the 1st). You&apos;ll hear at 80%. The provider&apos;s own spend limit on the key still applies.
            </p>
            {job === "text" ? (
              <div className="connect-choice" role="radiogroup" aria-label="At the cap, or when the key fails">
                <span className="muted small">At the cap, or when the key fails:</span>
                <label>
                  <input type="radio" name={`${ids}-oncap`} checked={onCap === "fallback"} onChange={() => setOnCap("fallback")} /> Botchelor&apos;s free model stands in, so dates (and a few texts a day) carry on
                </label>
                <label>
                  <input type="radio" name={`${ids}-oncap`} checked={onCap === "pause"} onChange={() => setOnCap("pause")} /> My dates wait until it&apos;s fixed
                </label>
              </div>
            ) : (
              <p className="muted small">At the cap, {job === "image" ? "portraits" : "clips"} wait until the 1st: there&apos;s no free model for them.</p>
            )}
          </fieldset>
          {offered.length > 0 && (
            <fieldset className="connect-step">
              <legend>Also use this key for</legend>
              {offered.map((a) => (
                <label key={a.job} className="connect-also">
                  <input
                    type="checkbox"
                    checked={alsoJobs.has(a.job)}
                    onChange={(e) =>
                      setAlsoJobs((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.add(a.job);
                        else next.delete(a.job);
                        return next;
                      })
                    }
                  />{" "}
                  {a.title} <span className="muted small">({a.note})</span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="byok-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="link-button" onClick={onDone}>
              Cancel
            </button>
          </div>
        </>
      )}
      {saveError && (
        <p className="byok-status err" role="status">
          {typeof saveError === "string" ? (
            saveError
          ) : (
            <>
              {saveError.message}
              {fixLink(saveError)}
            </>
          )}
        </p>
      )}
    </form>
  );
}
