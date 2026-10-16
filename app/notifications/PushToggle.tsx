"use client";

import { useEffect, useState } from "react";

/** The VAPID public key (base64url) as the bytes a browser's PushManager wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "unsupported" | "denied" | "off" | "on" | "busy";

/**
 * Browser notifications for this browser (lib/push.ts): registers the service worker, subscribes with the site's
 * public key, and stores the subscription. Off by default; the browser asks first.
 */
export default function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>("busy");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    setState("busy");
    setError(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error("save failed");
      setState("on");
    } catch {
      setError("Couldn't turn them on in this browser.");
      setState("off");
    }
  }

  async function turnOff() {
    setState("busy");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    setState("off");
  }

  if (state === "unsupported") return null;
  return (
    <section className="card">
      <h2>Browser notifications</h2>
      {state === "denied" ? (
        <p className="muted">This browser has notifications blocked for Botchelor. Allow them in the site settings to turn them on.</p>
      ) : state === "on" ? (
        <p>
          On for this browser.{" "}
          <button type="button" className="link-button" onClick={turnOff}>
            Turn off
          </button>
        </p>
      ) : (
        <p>
          <button type="button" className="primary" onClick={turnOn} disabled={state === "busy"}>
            {state === "busy" ? "…" : "Turn on browser notifications"}
          </button>{" "}
          <span className="muted small">Hear when they text, or when a second date is booked, even with the site closed.</span>
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
