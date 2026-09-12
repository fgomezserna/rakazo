import { randomBytes } from "node:crypto";
import { BotSecretDestination, BotSecretName, SecretHttpRequest } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { combineSignals, redactConnectorPayload } from "./connector-safety.js";
import { createSafeRemoteFetch, type RemoteTransportDependencies } from "./remote-mcp.js";
import type { EncryptedSecretStore } from "./secrets.js";
import { readBodyCapped, withAbort } from "./web-ssrf.js";

export type BotSecretScope = { userId: string; spaceId: string; botId: string };
function scopeFields({ userId, spaceId, botId }: BotSecretScope): BotSecretScope {
  return { userId, spaceId, botId };
}

const metadata = { name: true, origin: true, auth: true } as const;

function credentialHeader(destination: BotSecretDestination, plaintext: string) {
  const name = destination.auth.type === "header" ? destination.auth.name : "Authorization";
  const value =
    destination.auth.type === "bearer"
      ? `Bearer ${plaintext}`
      : destination.auth.type === "basic"
        ? `Basic ${Buffer.from(`${destination.auth.username}:${plaintext}`).toString("base64")}`
        : plaintext;
  try {
    const headers = new Headers({ [name]: value });
    if (headers.get(name) !== value) throw new Error("Header value was normalized");
  } catch {
    throw new Error("Credential cannot be used with this authentication method");
  }
  return { name, value };
}

export function normalizeSecretDestination(value: unknown): BotSecretDestination {
  // Credential names are internal identifiers, not display labels. Models often
  // mirror an environment-style label such as `VANGUARD_API_KEY`; canonicalize
  // that safe identifier before applying the contract so one harmless casing
  // mistake does not prevent the masked form from opening.
  const canonical = (() => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const raw = value as Record<string, unknown>;
    return {
      ...raw,
      ...(typeof raw.name === "string" ? { name: raw.name.toLowerCase() } : {}),
    };
  })();
  const destination = BotSecretDestination.parse(canonical);
  return { ...destination, origin: new URL(destination.origin).origin };
}

export function sameSecretDestination(
  left: BotSecretDestination,
  right: BotSecretDestination,
): boolean {
  return (
    left.name === right.name &&
    left.origin === right.origin &&
    JSON.stringify(left.auth) === JSON.stringify(right.auth)
  );
}

export async function findBotSecret(prisma: PrismaClient, scope: BotSecretScope, name: string) {
  const row = await prisma.botSecret.findFirst({
    where: { ...scopeFields(scope), name },
    select: metadata,
  });
  return row ? normalizeSecretDestination(row) : null;
}

export async function storeBotSecret(input: {
  tx: Prisma.TransactionClient;
  secretStore: EncryptedSecretStore;
  scope: BotSecretScope;
  destination: BotSecretDestination;
  plaintext: string;
}): Promise<void> {
  const { tx, secretStore, scope, plaintext } = input;
  if (!plaintext || plaintext.length > 16_384) throw new Error("Invalid credential length");
  const destination = normalizeSecretDestination(input.destination);
  credentialHeader(destination, plaintext);
  // Serialize credential updates and deletions for a bot, including concurrent first saves.
  await tx.$queryRaw`SELECT id FROM bots WHERE id = ${scope.botId} FOR UPDATE`;
  const existing = await tx.botSecret.findFirst({
    where: { ...scopeFields(scope), name: destination.name },
  });
  if (existing && !sameSecretDestination(normalizeSecretDestination(existing), destination)) {
    throw new Error("Remove the existing credential before changing its destination");
  }
  if (!existing && (await tx.botSecret.count({ where: scopeFields(scope) })) >= 100) {
    throw new Error("Credential limit reached");
  }
  const id = existing?.id ?? randomBytes(12).toString("hex");
  const encrypted = await secretStore.put(
    plaintext,
    {
      operationId: id,
      traceId: id,
      userId: scope.userId,
      spaceId: scope.spaceId,
      signal: new AbortController().signal,
    },
    id,
  );
  if (existing) {
    await tx.botSecret.update({ where: { id }, data: { ciphertext: encrypted.ciphertext } });
  } else {
    await tx.botSecret.create({
      data: { id, ...scopeFields(scope), ...destination, ciphertext: encrypted.ciphertext },
    });
  }
}

/**
 * Copy a saved credential between two bots after an explicit user-approved tool
 * call. The value is decrypted and re-encrypted only inside the backend; it is
 * never returned to the model, written to a message, or placed in a prompt.
 *
 * This is deliberately a copy, not an ambient cross-bot lookup: the destination
 * gets its own bot-scoped credential that can later be revoked independently.
 */
export async function delegateBotSecret(input: {
  prisma: PrismaClient;
  secretStore: EncryptedSecretStore;
  source: BotSecretScope;
  name: string;
  sourceBotId?: string;
  sourceName?: string;
  targetBotId?: string;
  targetName?: string;
  replace?: boolean;
}) {
  const name = BotSecretName.safeParse(input.name.trim().toLowerCase());
  if (!name.success) return { ok: false as const, error: "A valid credential name is required." };

  const requestedSourceBotId = input.sourceBotId?.trim() || undefined;
  const requestedSourceName = input.sourceName?.trim() || undefined;
  if (requestedSourceBotId && requestedSourceName) {
    return { ok: false as const, error: "Choose source_bot_id or source_name, not both." };
  }
  const importing = Boolean(requestedSourceBotId || requestedSourceName);
  if (importing && (input.targetBotId || input.targetName)) {
    return {
      ok: false as const,
      error: "Choose source_bot_id when this bot receives a credential, not a destination bot.",
    };
  }
  const sourceBotId = requestedSourceBotId ?? input.source.botId;

  let sourceBot = await input.prisma.bot.findFirst({
    where: {
      id: sourceBotId,
      userId: input.source.userId,
      archivedAt: null,
      ...(sourceBotId === input.source.botId ? { spaceId: input.source.spaceId } : {}),
    },
    select: {
      id: true,
      name: true,
      spaceId: true,
      space: { select: { organizationId: true } },
    },
  });
  if (!sourceBot) return { ok: false as const, error: "The source bot is unavailable." };

  if (requestedSourceName) {
    const sourceCandidates = await input.prisma.bot.findMany({
      where: {
        userId: input.source.userId,
        archivedAt: null,
        space: { organizationId: sourceBot.space.organizationId },
      },
      select: {
        id: true,
        name: true,
        spaceId: true,
        space: { select: { organizationId: true } },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const exact = sourceCandidates.filter((candidate) => candidate.name === requestedSourceName);
    const caseInsensitive = sourceCandidates.filter(
      (candidate) => candidate.name.toLowerCase() === requestedSourceName.toLowerCase(),
    );
    const resolved =
      exact.length === 1 ? exact[0] : caseInsensitive.length === 1 ? caseInsensitive[0] : undefined;
    if (!resolved) {
      return { ok: false as const, error: "Provide one exact or unambiguous source bot name." };
    }
    sourceBot = resolved;
  }

  const targetBotId = importing ? input.source.botId : input.targetBotId;
  const targetBots = targetBotId
    ? await input.prisma.bot.findMany({
        where: {
          id: targetBotId,
          userId: input.source.userId,
          archivedAt: null,
          space: { organizationId: sourceBot.space.organizationId },
        },
        select: {
          id: true,
          name: true,
          spaceId: true,
          thread: { select: { id: true } },
        },
      })
    : await input.prisma.bot.findMany({
        where: {
          userId: input.source.userId,
          archivedAt: null,
          space: { organizationId: sourceBot.space.organizationId },
        },
        select: {
          id: true,
          name: true,
          spaceId: true,
          thread: { select: { id: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

  const targetName = input.targetName?.trim();
  const namedTargets = targetName
    ? targetBots.filter((candidate) => candidate.name === targetName)
    : [];
  const caseInsensitiveTargets = targetName
    ? targetBots.filter((candidate) => candidate.name.toLowerCase() === targetName.toLowerCase())
    : [];
  const target = targetBotId
    ? targetBots[0]
    : targetName
      ? namedTargets.length === 1
        ? namedTargets[0]
        : caseInsensitiveTargets.length === 1
          ? caseInsensitiveTargets[0]
          : undefined
      : undefined;
  if (!target) {
    return {
      ok: false as const,
      error: "Provide one exact target bot id or an unambiguous target bot name.",
    };
  }
  if (target.id === sourceBot.id) {
    return { ok: false as const, error: "A bot cannot delegate a credential to itself." };
  }
  if (!importing && targetName && target.name !== targetName) {
    return { ok: false as const, error: "target_name must exactly match the target bot name." };
  }
  if (!target.thread) {
    return { ok: false as const, error: "The target bot has no chat to receive the credential." };
  }

  try {
    return await input.prisma.$transaction(async (tx) => {
      for (const botId of [sourceBot.id, target.id].sort()) {
        await tx.$queryRaw`SELECT id FROM bots WHERE id = ${botId} FOR UPDATE`;
      }

      const source = await tx.botSecret.findFirst({
        where: {
          userId: input.source.userId,
          spaceId: sourceBot.spaceId,
          botId: sourceBot.id,
          name: name.data,
        },
      });
      if (!source) {
        return { ok: false as const, error: "Credential is unavailable on the source bot." };
      }

      const currentTarget = await tx.bot.findFirst({
        where: {
          id: target.id,
          userId: input.source.userId,
          archivedAt: null,
          space: { organizationId: sourceBot.space.organizationId },
        },
        select: { id: true, name: true, spaceId: true, thread: { select: { id: true } } },
      });
      if (!currentTarget?.thread) {
        return { ok: false as const, error: "The target bot is no longer available." };
      }

      const destination = normalizeSecretDestination({
        name: source.name,
        origin: source.origin,
        auth: source.auth,
      });
      const existing = await tx.botSecret.findFirst({
        where: {
          userId: input.source.userId,
          spaceId: currentTarget.spaceId,
          botId: currentTarget.id,
          name: destination.name,
        },
      });
      if (existing && !sameSecretDestination(normalizeSecretDestination(existing), destination)) {
        if (!input.replace) {
          return {
            ok: false as const,
            error:
              "The target already has a different credential with that name. Use replace after confirming.",
          };
        }
      } else if (existing && !input.replace) {
        return {
          ok: true as const,
          alreadyAvailable: true as const,
          targetBotId: currentTarget.id,
          targetBotName: currentTarget.name,
          ...destination,
        };
      }
      if (
        !existing &&
        (await tx.botSecret.count({
          where: {
            userId: input.source.userId,
            spaceId: currentTarget.spaceId,
            botId: currentTarget.id,
          },
        })) >= 100
      ) {
        return { ok: false as const, error: "The target bot has reached its credential limit." };
      }

      const plaintext = input.secretStore.load(source.ciphertext, source.id);
      const targetSecretId = existing?.id ?? randomBytes(12).toString("hex");
      const encrypted = await input.secretStore.put(
        plaintext,
        {
          operationId: `delegate:${sourceBot.id}:${currentTarget.id}:${destination.name}`,
          traceId: targetSecretId,
          userId: input.source.userId,
          spaceId: currentTarget.spaceId,
          botId: currentTarget.id,
          signal: new AbortController().signal,
        },
        targetSecretId,
      );
      if (existing) {
        await tx.botSecret.update({
          where: { id: existing.id },
          data: {
            origin: destination.origin,
            auth: destination.auth as Prisma.InputJsonValue,
            ciphertext: encrypted.ciphertext,
          },
        });
      } else {
        await tx.botSecret.create({
          data: {
            id: targetSecretId,
            userId: input.source.userId,
            spaceId: currentTarget.spaceId,
            botId: currentTarget.id,
            name: destination.name,
            origin: destination.origin,
            auth: destination.auth as Prisma.InputJsonValue,
            ciphertext: encrypted.ciphertext,
          },
        });
      }
      return {
        ok: true as const,
        transferred: true as const,
        sourceBotId: sourceBot.id,
        sourceBotName: sourceBot.name,
        targetBotId: currentTarget.id,
        targetBotName: currentTarget.name,
        ...destination,
      };
    });
  } catch {
    return { ok: false as const, error: "Credential transfer failed without exposing its value." };
  }
}

export function listBotSecrets(prisma: PrismaClient, scope: BotSecretScope) {
  return prisma.botSecret.findMany({
    where: scopeFields(scope),
    select: metadata,
    orderBy: { name: "asc" },
    take: 100,
  });
}

export async function forgetBotSecret(prisma: PrismaClient, scope: BotSecretScope, name: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bots WHERE id = ${scope.botId} FOR UPDATE`;
    await tx.botSecret.deleteMany({ where: { ...scopeFields(scope), name } });
  });
  return { removed: true };
}

/** Credentials are resolved only inside this destination-bound HTTP boundary. */
export async function requestWithBotSecret(input: {
  prisma: PrismaClient;
  secretStore: EncryptedSecretStore;
  scope: BotSecretScope;
  request: unknown;
  signal: AbortSignal;
  remote?: RemoteTransportDependencies;
  registerRedactions?: (values: string[]) => void;
}): Promise<unknown> {
  const request = SecretHttpRequest.parse(input.request);
  const row = await input.prisma.botSecret.findFirst({
    where: { ...scopeFields(input.scope), name: request.name },
  });
  if (!row) return { error: "Credential is unavailable. Use request_secret to save it first." };
  const destination = normalizeSecretDestination(row);
  const url = new URL(request.url);
  if (url.origin !== destination.origin || url.username || url.password || url.hash) {
    return { error: "This credential cannot be sent to that destination." };
  }
  const plaintext = input.secretStore.load(row.ciphertext, row.id);
  const headers = new Headers({ accept: "application/json", "content-type": request.contentType });
  const { name: headerName, value: headerValue } = credentialHeader(destination, plaintext);
  const redactions = [
    ...new Set([
      plaintext,
      headerValue,
      Buffer.from(plaintext).toString("base64"),
      encodeURIComponent(plaintext),
      headerValue.replace(/^Basic /, ""),
    ]),
  ].filter(Boolean);
  input.registerRedactions?.(redactions);
  const controller = new AbortController();
  const signal = combineSignals(input.signal, controller.signal, AbortSignal.timeout(30_000));
  const fetch = createSafeRemoteFetch(input.remote?.fetch, input.remote?.resolveHostname);
  try {
    headers.set(headerName, headerValue);
    const response = await withAbort(
      fetch(url, { method: request.method, headers, body: request.body, signal }),
      signal,
    );
    const bytes = await readBodyCapped(response, 1_000_000, signal);
    const text = new TextDecoder().decode(bytes);
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* Plain text responses are supported. */
    }
    // Redact before truncating, so an output boundary cannot expose part of a value.
    const safe = JSON.stringify(redactConnectorPayload(body, redactions));
    return {
      status: response.status,
      body: safe.length > 20_000 ? safe.slice(0, 20_000) : JSON.parse(safe),
      truncated: safe.length > 20_000,
    };
  } catch {
    return { error: "Authenticated request failed. Check the destination and credential." };
  } finally {
    controller.abort();
    await withAbort(fetch.close(), AbortSignal.timeout(1000)).catch(() => undefined);
  }
}
