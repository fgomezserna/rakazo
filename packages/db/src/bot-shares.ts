import type { Actor, BotWorkspaceShare } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";

type ShareRow = {
  id: string;
  botId: string;
  targetSpaceId: string;
  createdAt: Date;
  targetSpace: { name: string };
};

function mapShare(row: ShareRow): BotWorkspaceShare {
  return {
    id: row.id,
    botId: row.botId,
    targetSpaceId: row.targetSpaceId,
    targetSpaceName: row.targetSpace.name,
    createdAt: row.createdAt.toISOString(),
  };
}

async function ownedBot(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
  includeArchived = false,
) {
  const bot = await prisma.bot.findFirst({
    where: {
      id: botId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    select: { id: true, spaceId: true, space: { select: { organizationId: true } } },
  });
  if (!bot) throw new IsolationError();
  return bot;
}

export async function listBotWorkspaceShares(
  prisma: PrismaClient,
  actor: Actor,
  botId: string,
): Promise<BotWorkspaceShare[]> {
  await ownedBot(prisma, actor, botId);
  const rows = await prisma.botWorkspaceShare.findMany({
    where: { botId, revokedAt: null },
    include: { targetSpace: { select: { name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(mapShare);
}

export async function createBotWorkspaceShare(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId: string; targetSpaceId: string },
): Promise<BotWorkspaceShare> {
  const row = await prisma.$transaction(async (tx) => {
    const bot = await tx.bot.findFirst({
      where: {
        id: input.botId,
        spaceId: actor.spaceId,
        userId: actor.userId,
        archivedAt: null,
      },
      select: { id: true, spaceId: true, space: { select: { organizationId: true } } },
    });
    if (!bot || bot.spaceId === input.targetSpaceId) throw new IsolationError();
    const targetSpace = await tx.space.findFirst({
      where: {
        id: input.targetSpaceId,
        organizationId: bot.space.organizationId,
        memberships: { some: { userId: actor.userId } },
      },
      select: { id: true, name: true },
    });
    if (!targetSpace) throw new IsolationError();
    return tx.botWorkspaceShare.upsert({
      where: { botId_targetSpaceId: { botId: bot.id, targetSpaceId: targetSpace.id } },
      create: { botId: bot.id, targetSpaceId: targetSpace.id },
      update: { revokedAt: null },
      include: { targetSpace: { select: { name: true } } },
    });
  });
  return mapShare(row);
}

export async function revokeBotWorkspaceShare(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId: string; targetSpaceId: string },
): Promise<void> {
  await ownedBot(prisma, actor, input.botId, true);
  const updated = await prisma.botWorkspaceShare.updateMany({
    where: {
      botId: input.botId,
      targetSpaceId: input.targetSpaceId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  if (updated.count !== 1) throw new IsolationError();
}

export type SharedBotAddress = {
  id: string;
  name: string;
  title: string;
  description: string;
  spaceId: string;
  spaceName: string;
  threadId: string;
};

/** Bots explicitly shared into the actor's current space. */
export async function listSharedBotsForSpace(
  prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId">,
): Promise<SharedBotAddress[]> {
  // A few provider-neutral adapter fakes intentionally omit optional models.
  // Treat those as no shares; the generated production client always exposes it.
  const shares = (prisma as PrismaClient & {
    botWorkspaceShare?: PrismaClient["botWorkspaceShare"];
  }).botWorkspaceShare;
  if (!shares) return [];
  const rows = await shares.findMany({
    where: {
      targetSpaceId: actor.spaceId,
      revokedAt: null,
      bot: {
        userId: actor.userId,
        archivedAt: null,
        thread: { isNot: null },
      },
      targetSpace: { memberships: { some: { userId: actor.userId } } },
    },
    select: {
      bot: {
        select: {
          id: true,
          name: true,
          title: true,
          description: true,
          spaceId: true,
          space: { select: { name: true } },
          thread: { select: { id: true } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.flatMap((row) => {
    if (!row.bot.thread) return [];
    return [{ ...row.bot, spaceName: row.bot.space.name, threadId: row.bot.thread.id }];
  });
}
