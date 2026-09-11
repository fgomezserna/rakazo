import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

const computerRoot = path.resolve(import.meta.dirname, "../../../infra/sandboxes/computer");

test("touch users can open and dismiss the remote computer keyboard", async ({
  page,
}, testInfo) => {
  // The production embed loads one bundled entry instead of the noVNC ESM
  // graph. Keep this browser fixture self-contained while still exercising the
  // real clipboard/mobile helpers and entry wiring.
  const clipboardBridge = (
    await readFile(path.join(computerRoot, "clipboard-bridge.js"), "utf8")
  ).replaceAll("export ", "");
  const mobileKeyboard = (
    await readFile(path.join(computerRoot, "mobile-keyboard.js"), "utf8")
  ).replaceAll("export ", "");
  const entry = (await readFile(path.join(computerRoot, "novnc-entry.js"), "utf8")).replace(
    /^import[^\n]*\n/gm,
    "",
  );
  const bundle = `(function () {
${clipboardBridge}
${mobileKeyboard}
  class RFB extends EventTarget {
    constructor() {
      super();
      this.viewOnly = false;
      this.focusOnClick = true;
      this._rfbConnectionState = "connected";
      globalThis.__rfbKeys = [];
    }
    sendKey(...args) { globalThis.__rfbKeys.push(args); }
    clipboardPasteFrom() {}
  }
  class Keyboard {
    constructor() { this.onkeyevent = null; }
    grab() {}
    ungrab() {}
  }
  const KeyTable = { XK_BackSpace: 0xff08 };
  const keysyms = { lookup: (codePoint) => codePoint };
${entry}
})();`;
  const assets = new Map([
    ["/embed.html", await readFile(path.join(computerRoot, "embed.html"), "utf8")],
    [
      "/clipboard-bridge.js",
      await readFile(path.join(computerRoot, "clipboard-bridge.js"), "utf8"),
    ],
    ["/mobile-keyboard.js", await readFile(path.join(computerRoot, "mobile-keyboard.js"), "utf8")],
    ["/rakazo-novnc.bundle.js", bundle],
  ]);

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 1 });
    const viewport = new EventTarget();
    Object.defineProperties(viewport, {
      height: { configurable: true, value: 420 },
      offsetTop: { configurable: true, value: 12 },
    });
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("http://keyboard.test/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = assets.get(pathname);
    if (body == null) return route.fulfill({ status: 404, body: "Not found" });
    return route.fulfill({
      contentType: pathname.endsWith(".html") ? "text/html" : "text/javascript",
      body,
    });
  });

  await page.goto("http://keyboard.test/embed.html");
  const keyboardButton = page.getByRole("button", { name: "Show keyboard" });
  const trackpadButton = page.getByRole("button", { name: "Use trackpad" });
  const keyboardInput = page.getByRole("textbox", { name: "Remote computer keyboard input" });
  await expect(keyboardButton).toBeVisible();
  await expect(trackpadButton).toBeVisible();

  await trackpadButton.click();
  await expect(page.getByRole("button", { name: "Use direct touch" })).toBeVisible();

  await keyboardButton.click();
  await expect(page.getByRole("button", { name: "Hide keyboard" })).toBeVisible();
  await expect(keyboardInput).toBeFocused();
  await expect(page.locator("html")).toHaveClass(/mobile-keyboard-open/);
  await expect(page.locator("#screen")).toHaveCSS("height", "420px");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        height: document.documentElement.style.getPropertyValue("--mobile-visual-height"),
        top: document.documentElement.style.getPropertyValue("--mobile-visual-top"),
      })),
    )
    .toEqual({ height: "420px", top: "12px" });
  await keyboardInput.pressSequentially("mobile typing");
  const forwardedKeysyms = await page.evaluate(() =>
    Reflect.get(globalThis, "__rfbKeys").map(([keysym]: [number]) => keysym),
  );
  expect(forwardedKeysyms).toEqual(
    Array.from("mobile typing", (character) => character.codePointAt(0)),
  );
  await captureScreenshot(page, testInfo, "mobile-computer-keyboard-open");

  await page.getByRole("button", { name: "Hide keyboard" }).click();
  await expect(keyboardButton).toBeVisible();
  await expect(keyboardInput).not.toBeFocused();
  await expect(page.locator("html")).not.toHaveClass(/mobile-keyboard-open/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--mobile-visual-height"),
      ),
    )
    .toBe("");
});
