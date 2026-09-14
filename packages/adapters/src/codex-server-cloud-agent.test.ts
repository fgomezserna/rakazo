import { type AdapterContext, CloudAgentRequestRejected } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { CodexServerCloudAgentProvider } from "./codex-server-cloud-agent.js";

const context: AdapterContext = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  signal: new AbortController().signal,
};

describe("CodexServerCloudAgentProvider", () => {
  it("keeps prompts and repository URLs out of the SSH command", async () => {
    const calls: string[][] = [];
    const runCommand = vi.fn(async (args: string[]) => {
      calls.push(args);
      return JSON.stringify({
        id: "operation-1",
        title: "Implement bridge",
        status: "running",
        latestRunId: "run-1",
        branch: "rakazo/operation-1",
      });
    });
    const provider = new CodexServerCloudAgentProvider({
      host: "192.168.1.236",
      user: "codex",
      keyPath: "/run/secrets/key",
      knownHostsPath: "/run/secrets/known-hosts",
      runCommand,
    });

    const result = await provider.launch(
      {
        idempotencyKey: "operation-1",
        prompt: "Implement bridge\nwith a second line",
        repository: "https://github.com/example/private-repo.git",
      },
      context,
    );

    expect(result).toMatchObject({
      id: "operation-1",
      status: "running",
      branch: "rakazo/operation-1",
    });
    const command = calls[0]!.at(-1)!;
    expect(command).toMatch(/^rakazo-codex-bridge launch operation-1 /);
    expect(command).not.toContain("Implement bridge");
    expect(command).not.toContain("github.com/example/private-repo");
    expect(provider.describe().id).toBe("codex-server");
  });

  it("rejects repositories that could smuggle credentials or a non-HTTPS URL", async () => {
    const provider = new CodexServerCloudAgentProvider({
      host: "codex-server",
      user: "codex",
      keyPath: "/run/secrets/key",
      runCommand: vi.fn(),
    });
    await expect(
      provider.launch(
        {
          idempotencyKey: "operation-2",
          prompt: "Task",
          repository: "https://user:password@example.com/repo.git",
        },
        context,
      ),
    ).rejects.toBeInstanceOf(CloudAgentRequestRejected);
    await expect(
      provider.launch(
        {
          idempotencyKey: "operation-3",
          prompt: "Task",
          repository: "http://example.com/repo.git",
        },
        context,
      ),
    ).rejects.toBeInstanceOf(CloudAgentRequestRejected);
  });

  it("returns the sanitized final response through status", async () => {
    const runCommand = vi.fn(async () =>
      JSON.stringify({
        id: "operation-result",
        title: "Inspect login",
        status: "finished",
        latestRunId: "run-result",
        branch: "rakazo/operation-result",
        result:
          "Logged in as fgomezserna\nrepositories: private-one, private-two\nBearer super-token",
      }),
    );
    const provider = new CodexServerCloudAgentProvider({
      host: "codex-server",
      user: "codex",
      keyPath: "/run/secrets/key",
      runCommand,
    });

    await expect(provider.get("operation-result", context, "run-result")).resolves.toMatchObject({
      status: "finished",
      result: "Logged in as fgomezserna\nrepositories: private-one, private-two\nBearer [redacted]",
    });
  });

  it("requires a repository for self-hosted Codex launches", async () => {
    const provider = new CodexServerCloudAgentProvider({
      host: "codex-server",
      user: "codex",
      keyPath: "/run/secrets/key",
      runCommand: vi.fn(),
    });

    await expect(
      provider.launch(
        { idempotencyKey: "operation-4", prompt: "Reply with exactly: ok" },
        context,
      ),
    ).rejects.toBeInstanceOf(CloudAgentRequestRejected);
  });
});
