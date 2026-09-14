import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AdapterContext,
  CloudAgentHandle,
  CloudAgentLaunchRequest,
  CloudAgentProvider,
  CloudAgentReplyRequest,
  CloudAgentSnapshot,
} from "@rakazo/adapter-kit";
import { CloudAgentRequestRejected } from "@rakazo/adapter-kit";

const OPERATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_KNOWN_HOSTS = "/run/secrets/codex_server_known_hosts";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_RESULT_BYTES = 100_000;

export interface CodexServerCloudAgentOptions {
  host: string;
  user: string;
  keyPath: string;
  knownHostsPath?: string;
  port?: number;
  timeoutMs?: number;
  /** Offline seam for deterministic tests; production uses OpenSSH. */
  runCommand?: (args: string[], signal: AbortSignal) => Promise<string>;
}

/**
 * Rakazo's self-hosted CloudAgent adapter. It talks to a forced-command SSH
 * identity on the Codex LXC; the LXC-side command owns the detached Codex
 * process and durable job directory. No bot computer gets this key.
 */
export class CodexServerCloudAgentProvider implements CloudAgentProvider {
  private readonly host: string;
  private readonly user: string;
  private readonly keyPath: string;
  private readonly knownHostsPath: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly runCommand: (args: string[], signal: AbortSignal) => Promise<string>;

  constructor(options: CodexServerCloudAgentOptions) {
    this.host = requireNonEmpty(options.host, "CODEX_SERVER_HOST");
    this.user = requireNonEmpty(options.user, "CODEX_SERVER_USER");
    this.keyPath = requireNonEmpty(options.keyPath, "CODEX_SSH_KEY_PATH");
    this.knownHostsPath = options.knownHostsPath?.trim() || DEFAULT_KNOWN_HOSTS;
    this.port = options.port ?? 22;
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65_535)
      throw new Error("CODEX_SERVER_PORT must be a valid TCP port");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1_000)
      throw new Error("CODEX_SSH_TIMEOUT_MS must be at least 1000ms");
    this.runCommand =
      options.runCommand ??
      ((args, signal) => runOpenSsh(args, signal, this.timeoutMs, this.keyPath));
  }

  describe() {
    return {
      id: "codex-server",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { launch: true, reply: true, cancel: true, offline: false },
    };
  }

  async launch(
    request: CloudAgentLaunchRequest,
    context: AdapterContext,
  ): Promise<CloudAgentHandle> {
    context.signal.throwIfAborted();
    const id = validateOperationId(request.idempotencyKey);
    const prompt = validatePrompt(request.prompt);
    const repository = validateRepository(request.repository);
    const response = await this.command(
      "launch",
      [id, encode(prompt), encode(repository)],
      request.signal ?? context.signal,
    );
    return toHandle(response, id, prompt);
  }

  async get(id: string, context: AdapterContext, _runId?: string): Promise<CloudAgentSnapshot> {
    const operationId = validateOperationId(id);
    const response = await this.command("status", [operationId], context.signal);
    return toSnapshot(response, operationId);
  }

  async reply(
    id: string,
    request: CloudAgentReplyRequest,
    context: AdapterContext,
  ): Promise<CloudAgentHandle> {
    const operationId = validateOperationId(id);
    const prompt = validatePrompt(request.prompt);
    const response = await this.command(
      "reply",
      [operationId, encode(prompt)],
      request.signal ?? context.signal,
    );
    return toHandle(response, operationId, prompt);
  }

  async cancel(id: string, context: AdapterContext, _runId?: string): Promise<CloudAgentSnapshot> {
    const operationId = validateOperationId(id);
    const response = await this.command("cancel", [operationId], context.signal);
    return toSnapshot(response, operationId);
  }

  private async command(
    verb: string,
    args: string[],
    signal: AbortSignal,
  ): Promise<BridgeResponse> {
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    const command = `rakazo-codex-bridge ${verb} ${args.join(" ")}`;
    const response = await this.runCommand(
      [
        "-i",
        this.keyPath,
        "-p",
        String(this.port),
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${this.knownHostsPath}`,
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        "ServerAliveInterval=10",
        "-o",
        "ServerAliveCountMax=2",
        `${this.user}@${this.host}`,
        command,
      ],
      boundedSignal,
    );
    const line = response
      .trim()
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .at(-1);
    if (!line) throw new Error("Codex bridge returned no response");
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error("Codex bridge returned invalid JSON");
    }
    if (!isRecord(parsed)) throw new Error("Codex bridge returned an invalid response");
    if (typeof parsed.error === "string") throw new CloudAgentRequestRejected();
    return parsed;
  }
}

interface BridgeResponse {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  latestRunId?: unknown;
  branch?: unknown;
  result?: unknown;
}

function toHandle(response: BridgeResponse, fallbackId: string, prompt: string): CloudAgentHandle {
  const snapshot = toSnapshot(response, fallbackId, prompt);
  return snapshot;
}

function toSnapshot(
  response: BridgeResponse,
  fallbackId: string,
  prompt?: string,
): CloudAgentSnapshot {
  const id = typeof response.id === "string" && response.id ? response.id : fallbackId;
  const status = response.status;
  if (
    status !== "running" &&
    status !== "finished" &&
    status !== "failed" &&
    status !== "cancelled"
  )
    throw new Error("Codex bridge returned an invalid status");
  const title =
    typeof response.title === "string" && response.title.trim()
      ? response.title
      : prompt?.split(/\r?\n/, 1)[0]?.slice(0, 80) || "Codex task";
  const latestRunId = typeof response.latestRunId === "string" ? response.latestRunId : undefined;
  const branch =
    typeof response.branch === "string" && response.branch ? response.branch : undefined;
  const result = normalizeResult(response.result);
  return {
    id,
    title,
    status,
    url: `https://codex-server.local/rakazo/agents/${encodeURIComponent(id)}`,
    ...(latestRunId ? { latestRunId } : {}),
    ...(branch ? { branch } : {}),
    ...(result ? { result } : {}),
  };
}

function normalizeResult(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const sanitized = value
    .replace(/gh(?:p|o|s|r|u)_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/Bearer\s+[^\s"',;&]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      "[redacted private key]",
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|password|secret|token|authorization|auth)\s*[=:]\s*)[^\s"',;&]+/gi,
      "$1[redacted]",
    );
  if (!sanitized) return undefined;
  if (Buffer.byteLength(sanitized, "utf8") <= MAX_RESULT_BYTES) return sanitized;
  return `${Buffer.from(sanitized, "utf8").subarray(0, MAX_RESULT_BYTES).toString("utf8")}\n[output truncated]`;
}

function validateOperationId(value: string): string {
  if (!OPERATION_ID.test(value)) throw new CloudAgentRequestRejected();
  return value;
}

function validatePrompt(value: string): string {
  const prompt = value.trim();
  if (!prompt || Buffer.byteLength(prompt, "utf8") > 100_000) throw new CloudAgentRequestRejected();
  return prompt;
}

function validateRepository(value: string | undefined): string {
  if (!value) throw new CloudAgentRequestRejected();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CloudAgentRequestRejected();
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new CloudAgentRequestRejected();
  return parsed.href;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function requireNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is required`);
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function runOpenSsh(
  args: string[],
  signal: AbortSignal,
  timeoutMs: number,
  sourceKeyPath: string,
): Promise<string> {
  // OpenSSH rejects group-readable private keys. Compose mounts the host file
  // read-only so the worker can read it, therefore copy it to a 0600 ephemeral
  // path for the short-lived SSH process and remove it in all outcomes.
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "rakazo-codex-key-"));
  const temporaryKeyPath = join(temporaryDirectory, "id_ed25519");
  await copyFile(sourceKeyPath, temporaryKeyPath);
  await chmod(temporaryKeyPath, 0o600);
  const sshArgs = [...args];
  const keyIndex = sshArgs.indexOf("-i");
  if (keyIndex < 0 || !sshArgs[keyIndex + 1]) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw new Error("Codex bridge SSH key argument is missing");
  }
  sshArgs[keyIndex + 1] = temporaryKeyPath;
  try {
    return await runOpenSshProcess(sshArgs, signal, timeoutMs);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function runOpenSshProcess(
  args: string[],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string> {
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("/usr/bin/ssh", args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal: boundedSignal,
    });
    let stdout = "";
    let stderrBytes = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (Buffer.byteLength(stdout, "utf8") > MAX_RESPONSE_BYTES) {
        child.kill("SIGTERM");
        fail(new Error("Codex bridge response exceeded the limit"));
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrBytes += Buffer.byteLength(chunk.toString(), "utf8");
      if (stderrBytes > MAX_RESPONSE_BYTES) child.kill("SIGTERM");
    });
    child.once("error", (error) => fail(error));
    child.once("close", (code, signalName) => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error(`Codex bridge SSH failed (${code ?? signalName ?? "unknown"})`));
        return;
      }
      settled = true;
      resolve(stdout);
    });
  });
}

export function codexServerConnectionKey(options: {
  host: string;
  user: string;
  port: number;
  keyFingerprint: string;
}) {
  const material = `${options.host.trim()}\0${options.user.trim()}\0${options.port}\0${options.keyFingerprint.trim()}`;
  return `codex-server:${createHash("sha256").update(material).digest("hex")}`;
}
