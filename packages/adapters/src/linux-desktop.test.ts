import type { AdapterContext, ComputerRef } from "@rakazo/adapter-kit";
import { COMPUTER_CLIPBOARD_MAX_BYTES } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  consumeClipboardCommand,
  LinuxDesktop,
  type LinuxDesktopHost,
  PREPARE_LINUX_DESKTOP,
} from "./linux-desktop.js";

const context: AdapterContext = {
  operationId: "clipboard-test",
  traceId: "clipboard-test",
  spaceId: "workspace",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
};

const computer: ComputerRef = {
  id: "computer",
  botId: "bot",
  kind: "e2b",
  providerRef: "computer",
};

describe("LinuxDesktop clipboard", () => {
  it("reads and clears the current display clipboard without putting the value in the command", async () => {
    const commands: string[] = [];
    const host: LinuxDesktopHost = {
      environment: vi.fn(async () => ({
        homeDir: "/home/user",
        workspaceDir: "/home/user/rakazo-home",
        browserProfilesDir: "/home/user/rakazo-home/.browser-profiles",
        displayStart: 20,
        portStart: 6100,
      })),
      run: vi.fn(async (_computer, command) => {
        commands.push(command);
        if (command.includes("RAKAZO_DESKTOP=")) {
          return { code: 0, stdout: "RAKAZO_DESKTOP=0:view-token", stderr: "" };
        }
        return { code: 0, stdout: "clipboard-token", stderr: "" };
      }),
      screenUrl: vi.fn(async () => "https://screen.test"),
    };

    const result = await new LinuxDesktop(host).consumeClipboard(computer, context);

    expect(result).toEqual({ text: "clipboard-token" });
    const command = commands.at(-1)!;
    expect(command).toContain("DISPLAY=':20'");
    expect(command).toContain("xsel --clipboard --output");
    expect(command).toContain(`head -c ${COMPUTER_CLIPBOARD_MAX_BYTES + 1}`);
    expect(command).toContain("xsel --clipboard --clear");
    expect(command).toContain("trap clear_clipboard EXIT");
    expect(command.lastIndexOf("--clear")).toBeLessThan(command.indexOf('cat "$tmp"'));
    expect(command).not.toContain("clipboard-token");
  });

  it("rejects clipboard output over the provider bound", async () => {
    const host: LinuxDesktopHost = {
      environment: vi.fn(async () => ({
        homeDir: "/home/user",
        workspaceDir: "/home/user/rakazo-home",
        browserProfilesDir: "/home/user/rakazo-home/.browser-profiles",
        displayStart: 20,
        portStart: 6100,
      })),
      run: vi.fn(async (_computer, command) =>
        command.includes("RAKAZO_DESKTOP=")
          ? { code: 0, stdout: "RAKAZO_DESKTOP=0:view-token", stderr: "" }
          : { code: 0, stdout: "x".repeat(COMPUTER_CLIPBOARD_MAX_BYTES + 1), stderr: "" },
      ),
      screenUrl: vi.fn(async () => "https://screen.test"),
    };

    await expect(new LinuxDesktop(host).consumeClipboard(computer, context)).rejects.toThrow(
      `computer clipboard exceeds ${COMPUTER_CLIPBOARD_MAX_BYTES} bytes`,
    );
  });

  it("generates shell-safe bounded consume commands", () => {
    const command = consumeClipboardCommand(":3");
    expect(command).toContain("set -eu");
    expect(command).toContain(`-gt ${COMPUTER_CLIPBOARD_MAX_BYTES}`);
    expect(command).toContain(`head -c ${COMPUTER_CLIPBOARD_MAX_BYTES + 1}`);
    expect(command).toContain("trap clear_clipboard EXIT");
    expect(command).not.toContain("$(xsel");
    expect(PREPARE_LINUX_DESKTOP).toContain("xsel:xsel");
  });
});
