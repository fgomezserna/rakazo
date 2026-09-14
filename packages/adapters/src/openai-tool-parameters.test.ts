import { validateToolArguments } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { builtinAgentTools } from "./builtin-tools.js";
import {
  normalizeOpenAiToolParameters,
  openAiToolParametersNeedNormalization,
} from "./openai-tool-parameters.js";
import { parametersFor } from "./pi-runtime.js";

describe("normalizeOpenAiToolParameters", () => {
  it("fills properties for a zero-argument object schema", () => {
    expect(normalizeOpenAiToolParameters({ type: "object" })).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("keeps an empty properties map and does not invent parameters", () => {
    expect(normalizeOpenAiToolParameters({ type: "object", properties: {} })).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("forces an object envelope while preserving a union", () => {
    const normalized = normalizeOpenAiToolParameters({
      anyOf: [
        { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        { type: "object", properties: { b: { type: "string" } }, required: ["b"] },
      ],
    });
    expect(normalized.type).toBe("object");
    expect(normalized.properties).toEqual({});
    expect(normalized.anyOf).toHaveLength(2);
  });

  it("preserves existing fields and properties", () => {
    expect(
      normalizeOpenAiToolParameters({
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      }),
    ).toEqual({
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    });
  });

  it("treats malformed or non-object input as an empty object schema", () => {
    expect(normalizeOpenAiToolParameters({ type: "string" })).toEqual({
      type: "object",
      properties: {},
    });
    expect(normalizeOpenAiToolParameters(undefined)).toEqual({
      type: "object",
      properties: {},
    });
    expect(normalizeOpenAiToolParameters(null)).toEqual({
      type: "object",
      properties: {},
    });
    expect(normalizeOpenAiToolParameters([])).toEqual({
      type: "object",
      properties: {},
    });
  });
});

describe("openAiToolParametersNeedNormalization", () => {
  it("accepts a complete object schema", () => {
    expect(openAiToolParametersNeedNormalization({ type: "object", properties: {} })).toBe(false);
  });

  it("requires normalization when type or properties are missing or malformed", () => {
    expect(openAiToolParametersNeedNormalization({ type: "object" })).toBe(true);
    expect(openAiToolParametersNeedNormalization({ anyOf: [] })).toBe(true);
    expect(openAiToolParametersNeedNormalization({ type: "object", properties: [] })).toBe(true);
    expect(openAiToolParametersNeedNormalization({ type: "string", properties: {} })).toBe(true);
  });
});

describe("parametersFor OpenAI wire fidelity", () => {
  it("serializes zero-argument tools with an object envelope", () => {
    const tool = builtinAgentTools.find((entry) => entry.name === "list_secrets");
    if (!tool) throw new Error("missing list_secrets");
    const wire = JSON.parse(JSON.stringify(parametersFor(tool))) as {
      type?: unknown;
      properties?: unknown;
    };
    expect(wire.type).toBe("object");
    expect(wire.properties).toEqual({});
  });

  it("serializes schedule_create with an object envelope and all timing branches", () => {
    const tool = builtinAgentTools.find((entry) => entry.name === "schedule_create");
    if (!tool) throw new Error("missing schedule_create");
    const wire = JSON.parse(JSON.stringify(parametersFor(tool))) as {
      type?: unknown;
      properties?: unknown;
      anyOf?: unknown[];
      oneOf?: unknown[];
    };
    expect(wire.type).toBe("object");
    expect(wire.properties).toEqual({});
    expect((wire.anyOf ?? wire.oneOf ?? []).length).toBe(5);
  });

  it("keeps every schedule timing mode valid after wire normalization", () => {
    const source = builtinAgentTools.find((entry) => entry.name === "schedule_create");
    if (!source) throw new Error("missing schedule_create");
    const tool = {
      name: source.name,
      description: source.description,
      parameters: parametersFor(source),
    };
    const common = { name: "outreach", prompt: "send the next batch" };
    const modes = [
      { ...common, cron: "0 10 * * 1-5" },
      { ...common, every: 30, unit: "minutes" },
      { ...common, runAt: "2030-01-01T10:00:00.000Z" },
      { ...common, delayMinutes: 15 },
      { ...common, delaySeconds: 45 },
    ];
    for (const [index, arguments_] of modes.entries()) {
      expect(
        validateToolArguments(tool, {
          type: "toolCall",
          id: `schedule-${index}`,
          name: source.name,
          arguments: arguments_,
        }),
      ).toMatchObject(arguments_);
    }
    expect(() =>
      validateToolArguments(tool, {
        type: "toolCall",
        id: "schedule-empty",
        name: source.name,
        arguments: {},
      }),
    ).toThrow();
    expect(() =>
      validateToolArguments(tool, {
        type: "toolCall",
        id: "schedule-mixed",
        name: source.name,
        arguments: { ...common, cron: "0 10 * * 1-5", delayMinutes: 15 },
      }),
    ).toThrow();
  });

  it("serializes request_secret unions with an object envelope", () => {
    const tool = builtinAgentTools.find((entry) => entry.name === "request_secret");
    if (!tool) throw new Error("missing request_secret");
    const wire = JSON.parse(JSON.stringify(parametersFor(tool))) as {
      type?: unknown;
      properties?: unknown;
      anyOf?: unknown[];
      oneOf?: unknown[];
    };
    expect(wire.type).toBe("object");
    expect(wire.properties).toEqual({});
    expect((wire.anyOf ?? wire.oneOf ?? []).length).toBe(2);
  });
});
