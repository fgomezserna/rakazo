import Keyboard from "/usr/share/novnc/core/input/keyboard.js";
import KeyTable from "/usr/share/novnc/core/input/keysym.js";
import keysyms from "/usr/share/novnc/core/input/keysymdef.js";
import RFB from "/usr/share/novnc/core/rfb.js";
import { attachHostClipboardPaste } from "./clipboard-bridge.js";
import { attachMobileKeyboard, attachMobileTrackpad, isTouchBrowser } from "./mobile-keyboard.js";

// This entry point is bundled into one classic script in the computer image.
// Keeping the noVNC dependency graph behind one request avoids a burst of
// dozens of module requests through the public screen proxy/Cloudflare edge.
window.__rakazoNovncMarkModuleStarted?.();

function query(name, fallback) {
  const match = `${document.location.href}${window.location.hash}`.match(
    new RegExp(`.*[?&]${name}=([^&#]*)`),
  );
  return match ? decodeURIComponent(match[1]) : fallback;
}

function flag(name) {
  const value = String(query(name, "false")).toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

const path = String(query("path", "websockify")).replace(/^\//, "");
const prefix = window.location.pathname.replace(/[^/]+$/, "");
const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const url = `${protocol}://${window.location.host}${prefix}${path}`;

function reportConnection(status, detail) {
  if (!window.parent || window.parent === window) return;
  window.parent.postMessage(
    {
      source: "rakazo-novnc",
      status,
      ...(detail ? { detail } : {}),
    },
    "*",
  );
}

let rfb;
try {
  rfb = new RFB(document.getElementById("screen"), url);
} catch (error) {
  window.__rakazoNovncReportError?.(error?.stack || error);
  throw error;
}
rfb.addEventListener("connect", () => reportConnection("connected"));
rfb.addEventListener("disconnect", (event) =>
  reportConnection("disconnected", event.detail?.clean ? "clean" : "connection-lost"),
);
rfb.addEventListener("securityfailure", (event) =>
  reportConnection("disconnected", event.detail?.reason ?? "security-failure"),
);
reportConnection("connecting");
rfb.viewOnly = flag("view_only");
rfb.scaleViewport = true;
rfb.clipViewport = false;
if (!rfb.viewOnly) attachHostClipboardPaste(rfb);
if (!rfb.viewOnly && isTouchBrowser()) {
  attachMobileKeyboard(rfb, {
    button: document.getElementById("mobile-keyboard"),
    input: document.getElementById("mobile-keyboard-input"),
    Keyboard,
    backspaceKeysym: KeyTable.XK_BackSpace,
    lookupKeysym: keysyms.lookup,
  });
  attachMobileTrackpad(rfb, {
    button: document.getElementById("mobile-trackpad"),
    surface: document.getElementById("screen"),
  });
}
