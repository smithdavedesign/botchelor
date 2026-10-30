/**
 * A Node preload for the browser tests (scripts/e2e-studio.mjs, e2e-after-dark-theater.mjs): loaded with
 * NODE_OPTIONS=--import into the app's own process, it sends every call to an image provider, a picture check or After
 * Dark's text model (OpenRouter) to E2E_PROVIDER_STUB (a local stub), keeping the path and query. Nothing in the app
 * changes, and the app's own checks still run: they just ask the stub. Without E2E_PROVIDER_STUB it does nothing. Never
 * loaded anywhere but a test run.
 */
const stub = process.env.E2E_PROVIDER_STUB;
const HOSTS = new Set(["api.venice.ai", "api.thehive.ai", "api.replicate.com", "queue.fal.run", "fal.run", "api.sightengine.com", "openrouter.ai"]);

if (stub) {
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    if (!HOSTS.has(url.hostname)) return real(input, init);
    const to = new URL(`${url.pathname}${url.search}`, stub);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("x-original-host", url.hostname);
    return real(to, { ...init, headers, method: init?.method ?? (input instanceof Request ? input.method : "GET"), body: init?.body ?? (input instanceof Request ? input.body : undefined), duplex: "half" });
  };
}
