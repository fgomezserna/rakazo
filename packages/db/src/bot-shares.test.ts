import type { Actor } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createBotWorkspaceShare,
  listBotWorkspaceShares,
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
});
