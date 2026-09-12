import { describe, expect, it } from "vitest";
import { jsonSchemaParameters } from "./pi-runtime.js";

describe("jsonSchemaParameters", () => {
  it("keeps function parameter roots explicitly object-shaped for unions", () => {
    const schema = jsonSchemaParameters({
      oneOf: [
        { type: "object", properties: { credential: { type: "string" } } },
        { type: "object", properties: { connectionId: { type: "string" } } },
      ],
    }) as unknown as { type?: unknown; anyOf?: unknown[] };
    expect(schema.type).toBe("object");
    expect(schema.anyOf).toHaveLength(2);
  });

  it("keeps primitive enums as literal unions", () => {
    const schema = jsonSchemaParameters({
      type: "object",
      properties: { mode: { type: "string", enum: ["fast", "slow"] } },
      required: ["mode"],
    }) as unknown as { properties: { mode: { anyOf: { const: unknown }[] } } };
    expect(schema.properties.mode.anyOf.map((member) => member.const)).toEqual(["fast", "slow"]);
  });

  it("accepts a nullable enum without throwing", () => {
    expect(() =>
      jsonSchemaParameters({
        type: "object",
        properties: { cursor: { type: ["string", "null"], enum: ["a", "b", null] } },
      }),
    ).not.toThrow();
  });

  it("accepts enums whose members are objects or arrays", () => {
    expect(() =>
      jsonSchemaParameters({
        type: "object",
        properties: { filter: { type: "object", enum: [{ kind: "all" }, ["x"]] } },
      }),
    ).not.toThrow();
  });
});
