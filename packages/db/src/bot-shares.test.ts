import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createBotWorkspaceShare,
  listBotsInSharedTargetSpaces,
  listBotWorkspaceShares,
  listSharedBotsForSpace,
  revokeBotWorkspaceShare,
} from "./bot-shares.js";
import type { PrismaClient } from "./client.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-owner",
  email: "owner@example.test",
  isDeploymentOwner: false,
};

describe("bot workspace shares", () => {
  it("creates an idempotent share only for a member space in the same organization", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "share-1",
      botId: "bot-1",
      targetSpaceId: "space-target",
      createdAt: new Date("2026-09-12T10:00:00.000Z"),
      targetSpace: { name: "Target" },
    });
    const tx = {
      bot: {
        findFirst: vi.fn().mockResolvedValue({
          id: "bot-1",
          spaceId: "space-owner",
          space: { organizationId: "org-1" },
        }),
      },
      space: { findFirst: vi.fn().mockResolvedValue({ id: "space-target", name: "Target" }) },
      botWorkspaceShare: { upsert },
    };
    const prisma = {
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createBotWorkspaceShare(prisma, actor, {
        botId: "bot-1",
        targetSpaceId: "space-target",
      }),
    ).resolves.toEqual({
      id: "share-1",
      botId: "bot-1",
      targetSpaceId: "space-target",
      targetSpaceName: "Target",
      createdAt: "2026-09-12T10:00:00.000Z",
    });
    expect(tx.space.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "space-target",
          organizationId: "org-1",
          memberships: { some: { userId: "user-1" } },
        }),
      }),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { botId_targetSpaceId: { botId: "bot-1", targetSpaceId: "space-target" } },
        update: { revokedAt: null },
      }),
    );
  });

  it("lists only active shares owned by the current space", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "share-1",
        botId: "bot-1",
        targetSpaceId: "space-target",
        createdAt: new Date("2026-09-12T10:00:00.000Z"),
        targetSpace: { name: "Target" },
      },
    ]);
    const prisma = {
      bot: { findFirst: vi.fn().mockResolvedValue({ id: "bot-1" }) },
      botWorkspaceShare: { findMany },
    } as unknown as PrismaClient;

    await expect(listBotWorkspaceShares(prisma, actor, "bot-1")).resolves.toEqual([
      expect.objectContaining({ targetSpaceName: "Target" }),
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { botId: "bot-1", revokedAt: null } }),
    );
  });

  it("revokes an existing share without deleting its audit row", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      bot: { findFirst: vi.fn().mockResolvedValue({ id: "bot-1" }) },
      botWorkspaceShare: { updateMany },
    } as unknown as PrismaClient;

    await expect(
      revokeBotWorkspaceShare(prisma, actor, {
        botId: "bot-1",
        targetSpaceId: "space-target",
      }),
    ).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        botId: "bot-1",
        targetSpaceId: "space-target",
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("lists active shared bots addressable from the current workspace", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        bot: {
          id: "bot-shared",
          name: "Shared Analyst",
          color: "#6366f1",
          title: "CRM specialist",
          description: "Handles CRM requests",
          spaceId: "space-owner",
          space: { name: "Owner" },
          thread: { id: "thread-shared" },
        },
      },
    ]);
    const prisma = { botWorkspaceShare: { findMany } } as unknown as PrismaClient;

    await expect(
      listSharedBotsForSpace(prisma, { spaceId: "space-target", userId: "user-1" }),
    ).resolves.toEqual([
      {
        id: "bot-shared",
        name: "Shared Analyst",
        color: "#6366f1",
        title: "CRM specialist",
        description: "Handles CRM requests",
        spaceId: "space-owner",
        spaceName: "Owner",
        threadId: "thread-shared",
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          targetSpaceId: "space-target",
          revokedAt: null,
        }),
      }),
    );
  });

  it("lists bots in workspaces the source bot was shared into", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        targetSpace: {
          name: "Target",
          bots: [
            {
              id: "bot-target",
              name: "Commercial",
              color: "#f97316",
              title: "Commercial specialist",
              description: "Handles commercial requests",
              spaceId: "space-target",
              thread: { id: "thread-target" },
            },
          ],
        },
      },
    ]);
    const prisma = { botWorkspaceShare: { findMany } } as unknown as PrismaClient;

    await expect(
      listBotsInSharedTargetSpaces(prisma, { botId: "bot-source", userId: "user-1" }),
    ).resolves.toEqual([
      {
        id: "bot-target",
        name: "Commercial",
        color: "#f97316",
        title: "Commercial specialist",
        description: "Handles commercial requests",
        spaceId: "space-target",
        spaceName: "Target",
        threadId: "thread-target",
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          botId: "bot-source",
          revokedAt: null,
        }),
      }),
    );
  });
});
