#!/usr/bin/env python3
"""
After Dark's processor settings, set up in one go once a merchant account exists (docs/after-dark-processor-application.md
"Go live"). Secrets go into the keychain (provision/botchelor/<NAME>, recorded so RepoHQ Settings → Keys shows them) and
never into a file, the terminal or a commit. The postback URLs to paste into the processor's portal carry
SEGPAY_POSTBACK_SECRET, so they go to the clipboard, never the screen.

  python3 -I scripts/after-dark/provision-billing.py check
  python3 -I scripts/after-dark/provision-billing.py segpay  [--host https://ad.botchelor.com] [--push-vercel]
  python3 -I scripts/after-dark/provision-billing.py verotel [--host https://ad.botchelor.com] [--push-vercel]

`--push-vercel` sets the settings on the Vercel project's PRODUCTION environment only (never previews: a preview must not
take real payments) and redeploys. Leave it off once After Dark runs on its own host: there, the settings go into that
host's environment (docs/after-dark-hosting.md), read from the keychain.
"""
import argparse
import getpass
import importlib.machinery
import importlib.util
import os
import secrets
import subprocess
import sys
import urllib.parse
import urllib.request

REPO = "botchelor"
DEFAULT_HOST = "https://ad.botchelor.com"

_spec = importlib.util.spec_from_loader(
    "provision", importlib.machinery.SourceFileLoader("provision", os.path.expanduser("~/ai-stack/bin/provision"))
)
p = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(p)

# Each processor's settings: (name, how it's asked for, required, check). Matches lib/adult/billing-segpay.ts and
# billing-verotel.ts (segpayConfig / verotelConfig): a processor is on only when all its required settings are set.
SETTINGS = {
    "segpay": [
        ("SEGPAY_PACKAGE_ID", "Segpay package ID (Merchant Portal; digits)", True, str.isdigit),
        ("SEGPAY_PRICE_POINT_ID", "Segpay price point ID for the monthly price (digits)", True, str.isdigit),
        ("SEGPAY_POSTBACK_SECRET", None, True, lambda v: len(v) >= 32),  # ours: generated, never typed
        ("SEGPAY_POSTBACK_IPS", "Segpay's postback IPs, comma-separated (optional: Enter to skip)", False, lambda v: True),
    ],
    "verotel": [
        ("VEROTEL_SHOP_ID", "Verotel shop ID (Control Center; digits)", True, str.isdigit),
        ("VEROTEL_SIGNATURE_KEY", "Verotel FlexPay signature key", True, lambda v: len(v) >= 8),
        ("VEROTEL_PERIOD", "Billing period, e.g. P1M or P30D (optional: Enter for P1M)", False, lambda v: v.upper().startswith("P")),
    ],
}


def service(name):
    return p.value_service(REPO, name)


def have(name):
    return bool(p.keychain_get(service(name)))


def ask(name, prompt, required, ok):
    """A value from David, hidden as it's typed; Enter keeps what's stored."""
    stored = have(name)
    while True:
        v = getpass.getpass("%s%s: " % (prompt, " [stored: Enter keeps it]" if stored else "")).strip()
        if not v and stored:
            return None
        if not v and not required:
            return None
        if v and ok(v):
            return v
        print("  that doesn't look right; try again", file=sys.stderr)


def postback_urls(processor, host):
    """What goes in the processor's portal (docs/after-dark.md "What David pastes into each merchant portal")."""
    base = host.rstrip("/")
    if processor == "verotel":
        return "\n".join([
            "FlexPay postback URL: %s/api/after-dark/billing/verotel" % base,
            "Success URL: %s/after-dark/subscribe?done=1" % base,
            "Decline URL: %s/after-dark/subscribe?declined=1" % base,
            "Signature: SHA-256 (FlexPay version 4)",
        ])
    secret = p.keychain_get(service("SEGPAY_POSTBACK_SECRET"))
    q = "secret=%s" % urllib.parse.quote(secret)
    transaction = ("%s/api/after-dark/billing/segpay?%s&action=<action>&stage=<stage>&approved=<approved>&trantype=<trantype>"
                   "&purchaseid=<purchaseid>&tranid=<tranid>&relatedtranid=<relatedtranid>&price=<price>&currencycode=<currencycode>"
                   "&eticketid=<eticketid>&iint=<iint>&rint=<rint>&ref1=<extra ref1>&transtime=<transtime>") % (base, q)
    member = "%s/api/after-dark/billing/segpay?%s&action=<action>&purchaseid=<purchaseid>&nextbilldate=<nextbilldate>" % (base, q)
    return "\n".join([
        "Expected Response: OK · Error Response: ERROR · retries: on",
        "Transaction postback:\n" + transaction,
        "Cancellation, Disable and Reactivation postbacks:\n" + member,
        "Payment page approval link: %s/after-dark/subscribe?done=1" % base,
    ])


def to_clipboard(text):
    subprocess.run(["pbcopy"], input=text.encode(), check=True)


def push_vercel(names):
    """Production only, then a redeploy so the values apply."""
    for name in names:
        value = p.keychain_get(service(name))
        if not value:
            continue
        p.http("POST", "%s/v10/projects/%s/env%s" % (p.VERCEL, urllib.parse.quote(REPO), p.vercel_q({"upsert": "true"})), p.token("vercel"),
               {"key": name, "value": value, "type": "encrypted", "target": ["production"]})
        p.record(REPO, name, "after-dark-billing", ["keychain", "vercel-production"])
    return p.vercel_redeploy(REPO)


def live_state(host):
    """Whether each processor's postback route is switched on where After Dark runs (off answers not found)."""
    out = {}
    for processor in ("segpay", "verotel"):
        url = "%s/api/after-dark/billing/%s" % (host.rstrip("/"), processor)
        try:
            code = urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "botchelor-live-check"}), timeout=15).status
        except urllib.error.HTTPError as e:
            code = e.code
        except Exception as e:  # the host isn't up yet
            code = "unreachable (%s)" % type(e).__name__
        out[processor] = "off (404)" if code == 404 else "on (%s)" % code if isinstance(code, int) else code
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("what", choices=["check", "segpay", "verotel"])
    ap.add_argument("--host", default=DEFAULT_HOST, help="where After Dark runs (default %s)" % DEFAULT_HOST)
    ap.add_argument("--push-vercel", action="store_true", help="also set the Vercel project's production env, and redeploy")
    a = ap.parse_args()

    if a.what == "check":
        for processor, settings in SETTINGS.items():
            missing = [n for n, _, req, _ in settings if req and not have(n)]
            print("%-8s %s" % (processor, "ready in the keychain" if not missing else "missing: " + ", ".join(missing)))
        for host in dict.fromkeys([a.host, "https://botchelor.com"]):
            print("%s → %s" % (host, ", ".join("%s %s" % kv for kv in live_state(host).items())))
        return

    settings = SETTINGS[a.what]
    for name, prompt, required, ok in settings:
        if prompt is None:  # SEGPAY_POSTBACK_SECRET: ours, made once and kept
            if not have(name):
                p.keychain_set(service(name), secrets.token_hex(32))
                print("made %s (64 hex characters) and stored it" % name)
            p.record(REPO, name, "generated", ["keychain"])
            continue
        value = ask(name, prompt, required, ok)
        if value:
            p.keychain_set(service(name), value.upper() if name == "VEROTEL_PERIOD" else value)
            p.record(REPO, name, a.what + "-portal", ["keychain"])
            print("stored %s" % name)
    missing = [n for n, _, req, _ in settings if req and not have(n)]
    if missing:
        sys.exit("not complete yet: %s" % ", ".join(missing))

    to_clipboard(postback_urls(a.what, a.host))
    print("The portal settings for %s (postback URLs for %s) are on your clipboard: paste them into the portal." % (a.what, a.host))
    if a.what == "segpay":
        print("Also set AD_SUBSCRIPTION_PRICE_USD to the price point's amount if it isn't 12.99 (Segpay charges its price point).")
    if a.push_vercel:
        print("redeploying: %s" % push_vercel([n for n, *_ in settings]))
    else:
        print("Not pushed anywhere yet: put them in After Dark's host environment, or rerun with --push-vercel while it's on Vercel.")
    p.emit("after-dark-billing", "ok", "%s settings stored%s" % (a.what, " and pushed to Vercel production" if a.push_vercel else ""))


if __name__ == "__main__":
    main()
