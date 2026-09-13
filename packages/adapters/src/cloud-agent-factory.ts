import { createHash } from "node:crypto";
import type { CloudAgentProvider } from "@rakazo/adapter-kit";
import { EmulatorCloudAgentProvider } from "./cloud-agent-emulator.js";
import { resolveCloudAgentProvider } from "./cloud-agent-provider-env.js";
import {
  CodexServerCloudAgentProvider,
  codexServerConnectionKey,
} from "./codex-server-cloud-agent.js";
import { CursorCloudAgentProvider } from "./cursor-cloud-agent.js";

/** The composition root binds a credential to exactly one authorized Space. */
export interface CloudAgentConnection {
  provider: CloudAgentProvider;
  /** Opaque credential binding. Rotation fails closed for existing agents. */
  key: string;
  /** Only the offline emulator may be available in every Space. */
  spaceId?: string;
}

export function cloudAgentsEnabled(
  connection: CloudAgentConnection | null | undefined,
  spaceId: string,
) {
  return Boolean(
    connection &&
      (connection.spaceId === spaceId ||
        (!connection.spaceId && connection.provider.describe().capabilities.offline)),
  );
}

export function createCloudAgentConnection(
  source: NodeJS.ProcessEnv = process.env,
): CloudAgentConnection | null {
  const kind = resolveCloudAgentProvider(source);
  if (kind === "emulator") {
    return { provider: new EmulatorCloudAgentProvider(), key: "emulator" };
  }
  if (kind !== "cursor" && kind !== "codex-server") return null;
  if (kind === "codex-server") {
    const host = source.CODEX_SERVER_HOST!.trim();
    const user = source.CODEX_SERVER_USER!.trim();
    const port = Number(source.CODEX_SERVER_PORT ?? 22);
    const keyPath = source.CODEX_SSH_KEY_PATH!.trim();
    const keyFingerprint = source.CODEX_SSH_KEY_FINGERPRINT!.trim();
    return {
      provider: new CodexServerCloudAgentProvider({
        host,
        user,
        port,
        keyPath,
        knownHostsPath: source.CODEX_SERVER_KNOWN_HOSTS_PATH,
        timeoutMs: optionalNumber(source.CODEX_SSH_TIMEOUT_MS),
      }),
      key: codexServerConnectionKey({ host, user, port, keyFingerprint }),
      spaceId: source.CLOUD_AGENT_SPACE_ID!.trim(),
    };
  }
  const apiKey = source.CURSOR_API_KEY!.trim();
  const spaceId = source.CLOUD_AGENT_SPACE_ID!.trim();
  return {
    provider: new CursorCloudAgentProvider({ apiKey }),
    key: `cursor:${createHash("sha256").update(apiKey).digest("hex")}`,
    spaceId,
  };
}

function optionalNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
