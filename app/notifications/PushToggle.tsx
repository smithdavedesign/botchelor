"use client";

import { useEffect, useState } from "react";
import { installSteps, platformOf } from "@/lib/pwa";

/** The VAPID public key (base64url) as the bytes a browser's PushManager wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "unsupported" | "install" | "denied" | "off" | "on" | "busy";

/** An iPhone or iPad in the browser rather than the Home Screen app: there, web push only works once it's installed. */
function needsInstall(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  const installed = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  return !installed && platformOf(nav.userAgent, nav.maxTouchPoints) === "ios";
}

/**
 * Browser notifications for this browser (lib/push.ts): registers the service worker, subscribes with the site's
 * public key, and stores the subscription. Off by default; the browser asks first. In ⚙ Settings it shows every state;
 * as a prompt above the list (2026-10-31 UX audit) it's one row while it's off and could be on, and goes once it's on.
 */
export default function PushToggle({ publicKey, prompt = false }: { publicKey: string; prompt?: boolean }) {
  const [state, setState] = useState<State>("busy");
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState(needsInstall() ? "install" : "unsupported");
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

  if (prompt) {
    if (asked && state === "on") {
      return (
        <p className="push-prompt-done" role="status">
          ✓ Browser notifications are on. Turn them off in ⚙ Settings.
        </p>
      );
    }
    if (state !== "off" && !(asked && state === "busy")) return null;
    return (
      <section className="card invite-row push-prompt" aria-label="Browser notifications">
        <span className="invite-row-icon" aria-hidden="true">
          🔔
        </span>
        <div className="invite-row-text">
          <strong>Hear it as it happens</strong>
          <span className="muted small">When they text, or a second date is booked, even with the site closed.</span>
          {error && <span className="error">{error}</span>}
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setAsked(true);
            void turnOn();
          }}
          disabled={state === "busy"}
        >
          {state === "busy" ? "…" : "Turn on"}
        </button>
      </section>
    );
  }
  if (state === "unsupported") return null;
  return (
    <div className="notif-setting">
      <h3>Browser notifications</h3>
      {state === "install" ? (
        <p className="muted">On an iPhone they come through the Home Screen app. {installSteps("ios")}</p>
      ) : state === "denied" ? (
        <p className="muted">This browser has notifications blocked for Botchelor. Allow them in the site settings to turn them on.</p>
      ) : state === "on" ? (
        <p>
          On for this browser.{" "}
          <button type="button" className="link-button" onClick={turnOff}>
            Turn off
          </button>
        </p>
      ) : (
        <>
          <p className="muted small">Hear when they text, or when a second date is booked, even with the site closed.</p>
          <p>
            <button type="button" className="primary" onClick={turnOn} disabled={state === "busy"}>
              {state === "busy" ? "…" : "Turn on browser notifications"}
            </button>
          </p>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
