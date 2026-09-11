import type { IncomingHttpHeaders } from "node:http";

const SENSITIVE_RESPONSE_HEADERS = new Set(["clear-site-data", "set-cookie", "set-cookie2"]);
const SCREEN_SANDBOX = "sandbox allow-scripts allow-same-origin allow-pointer-lock";

function contentTypeValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? undefined) : value;
}

function isSandboxableDocument(value: string | string[] | undefined) {
  const rawContentType = contentTypeValue(value);
  const contentType = rawContentType?.split(";", 1)[0]?.trim().toLowerCase();
  return (
    contentType == null ||
    contentType === "text/html" ||
    contentType === "application/xhtml+xml" ||
    contentType === "image/svg+xml"
  );
}

/** Screen listeners are untrusted even when their capability URL is opened outside an iframe. */
export function safeScreenProxyResponseHeaders(headers: IncomingHttpHeaders) {
  const safe: IncomingHttpHeaders = {};
  const policies: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase();
    if (value == null || name.startsWith(":") || SENSITIVE_RESPONSE_HEADERS.has(name)) continue;
    if (name === "content-security-policy") {
      policies.push(...(Array.isArray(value) ? value : [value]));
    } else {
      safe[name] = value;
    }
  }
  // Separate CSP policies intersect, and existing provider restrictions (including
  // frame-ancestors) remain in force. Keep the sandbox on document responses; applying it to
  // ESM assets makes Chromium reject imports from the capability document.
  const contentType = safe["content-type"];
  if (isSandboxableDocument(contentType)) {
    safe["content-security-policy"] = [...policies, SCREEN_SANDBOX];
  } else if (policies.length > 0) {
    safe["content-security-policy"] = policies;
  } else {
    delete safe["content-security-policy"];
  }
  // Keep the capability response isolated from the upstream provider's origin policy. The
  // iframe is same-origin with the app only for module loading; its CSP sandbox remains active.
  safe["access-control-allow-origin"] = "null";
  safe["access-control-allow-credentials"] = "true";
  // Screen capability paths contain short-lived, user-scoped state. Do not let a CDN or
  // browser reuse an asset response from another capability before its CORS policy is checked.
  safe["cache-control"] = "no-store";
  safe["cdn-cache-control"] = "no-store";
  return safe;
}

export function stripSensitiveHandshakeHeaders(response: Buffer) {
  const end = response.indexOf("\r\n\r\n");
  if (end < 0) return null;
  const lines = response.subarray(0, end).toString("latin1").split("\r\n");
  const safeLines = lines.filter((line, index) => {
    if (index === 0) return true;
    const separator = line.indexOf(":");
    const name = separator < 0 ? line : line.slice(0, separator);
    return !SENSITIVE_RESPONSE_HEADERS.has(name.trim().toLowerCase());
  });
  return Buffer.concat([
    Buffer.from(`${safeLines.join("\r\n")}\r\n\r\n`, "latin1"),
    response.subarray(end + 4),
  ]);
}
