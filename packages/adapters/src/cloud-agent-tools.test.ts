import { toolRequiresApproval } from "@rakazo/core";
import { describe, expect, it, vi } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
import { cloudAgentToolSnapshot, executeCloudAgentTool } from "./cloud-agent-service.js";
import { validCloudAgentArgs } from "./cloud-agent-tools.js";
import { CLOUD_AGENT_TOOL_NAMES, selectCloudAgentTools } from "./cloud-agent-tools-select.js";

describe("cloud agent tool boundary", () => {
  it("hides every cloud tool when no provider is authorized", () => {
    expect(
      selectCloudAgentTools(builtinAgentTools, false).some((tool) =>
        CLOUD_AGENT_TOOL_NAMES.has(tool.name),
      ),
    ).toBe(false);
    expect(selectCloudAgentTools(builtinAgentTools, true)).toBe(builtinAgentTools);
  });
  it("classifies every mutation as consequential", () => {
    for (const name of ["cloud_agent_launch", "cloud_agent_reply", "cloud_agent_cancel"])
      expect(toolRequiresApproval(name, false)).toBe(true);
    expect(toolRequiresApproval("cloud_agent_status", false)).toBe(false);
  });
  it("forwards a provider final response only through the explicit status tool", () => {
    expect(
      cloudAgentToolSnapshot({
        id: "agent",
        title: "Inspect login",
        status: "finished",
        url: "https://codex-server.local/rakazo/agents/agent",
        latestRunId: "run-1",
        result: "Logged in as fgomezserna",
      }),
    ).toMatchObject({
      id: "agent",
      status: "finished",
      result: "Logged in as fgomezserna",
    });
    expect(
      builtinAgentTools.find((tool) => tool.name === "cloud_agent_status")?.description,
    ).toContain("final response");
  });
  it("reads the live provider result when status is requested", async () => {
    const provider = {
      describe: () => ({
        id: "codex-server",
        contractVersion: "1",
        adapterVersion: "test",
        capabilities: { launch: true, reply: true, cancel: true, offline: false },
      }),
      get: vi.fn(async () => ({
        id: "agent",
        title: "Inspect login",
        status: "finished" as const,
        url: "https://codex-server.local/rakazo/agents/agent",
        latestRunId: "run-1",
        result: "Logged in as fgomezserna",
      })),
    };
    const result = await executeCloudAgentTool(
      {
        prisma: {
          cloudAgent: {
            findFirst: vi.fn(async () => ({
              id: "agent",
              remoteId: "remote-agent",
              latestRunId: "run-1",
              cancelRequested: false,
            })),
          },
        },
        cloudAgent: { key: "codex:test", spaceId: "space", provider } as never,
      } as never,
      {
        operationId: "status-effect",
        traceId: "trace",
        spaceId: "space",
        userId: "user",
        botId: "bot",
        signal: new AbortController().signal,
      },
      { id: "run", threadId: "thread" },
      "cloud_agent_status",
      { id: "agent" },
    );

    expect(provider.get).toHaveBeenCalledWith(
      "remote-agent",
      expect.objectContaining({ operationId: "status-effect" }),
      "run-1",
    );
    expect(result).toMatchObject({ status: "finished", result: "Logged in as fgomezserna" });
  });
  it("rejects raw environment variables and malformed arguments before effect persistence", () => {
    for (const args of [
      { prompt: "Task", environment: { TOKEN: "fake-secret" } },
      { prompt: "" },
      { prompt: "Task", openPr: "false" },
      { prompt: "Task", images: [{ url: "http://example.test/image.png" }] },
      { prompt: "Task", images: [{ url: "https://user:password@example.test/image.png" }] },
    ]) {
      expect(validCloudAgentArgs("cloud_agent_launch", args)).toBe(false);
    }
    expect(validCloudAgentArgs("cloud_agent_launch", { prompt: "Task", openPr: false })).toBe(true);
    expect(validCloudAgentArgs("cloud_agent_reply", { id: "agent", prompt: "Tests" })).toBe(true);
    expect(validCloudAgentArgs("cloud_agent_cancel", { id: "" })).toBe(false);
  });
});
