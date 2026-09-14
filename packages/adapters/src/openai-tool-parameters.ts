/**
 * OpenAI chat-completions `tools[].function.parameters` must be a JSON Schema
 * object. Hosted proxies can be lenient, but OpenAI-compatible local servers
 * commonly reject schemas that omit `type: "object"` or `properties`.
 *
 * Normalize at the adapter boundary so every OpenAI-compatible path receives
 * the required envelope without inventing parameter names.
 */
export function normalizeOpenAiToolParameters(parameters: unknown): Record<string, unknown> {
  const schema =
    parameters && typeof parameters === "object" && !Array.isArray(parameters)
      ? { ...(parameters as Record<string, unknown>) }
      : {};
  const properties =
    schema.properties != null &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
      ? schema.properties
      : {};
  return { ...schema, type: "object", properties };
}

/** True when a schema would fail stricter OpenAI-compatible tool validators. */
export function openAiToolParametersNeedNormalization(parameters: unknown): boolean {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return true;
  const schema = parameters as Record<string, unknown>;
  if (schema.type !== "object") return true;
  return (
    schema.properties == null ||
    typeof schema.properties !== "object" ||
    Array.isArray(schema.properties)
  );
}
