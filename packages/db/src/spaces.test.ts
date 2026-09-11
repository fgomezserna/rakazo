import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import {
  CannotConfigureSpaceAsNonOwnerError,
  InvalidSpaceAvatarError,
  updateSpaceProfileForMember,
} from "./spaces.js";

function database() {
  const spaceMember = { findUnique: vi.fn() };
  const space = { update: vi.fn() };
  return {
    prisma: { spaceMember, space } as unknown as PrismaClient,
    spaceMember,
    space,
  };
}

describe("updateSpaceProfileForMember", () => {
  it("updates the name and avatar for the owning member", async () => {
    const db = database();
    db.spaceMember.findUnique.mockResolvedValue({ role: "owner", space: { deletingAt: null } });
    db.space.update.mockResolvedValue({
      id: "space-1",
      name: "Support",
      avatarUrl: "data:image/png;base64,AAAA",
    });

    await expect(
      updateSpaceProfileForMember(db.prisma, {
        spaceId: "space-1",
        userId: "user-1",
        name: "  Support  ",
        avatarUrl: "data:image/png;base64,AAAA",
      }),
    ).resolves.toEqual({
      id: "space-1",
      name: "Support",
      avatarUrl: "data:image/png;base64,AAAA",
    });
    expect(db.space.update).toHaveBeenCalledWith({
      where: { id: "space-1" },
      data: { name: "Support", avatarUrl: "data:image/png;base64,AAAA" },
      select: { id: true, name: true, avatarUrl: true },
    });
  });

  it("does not let a non-owner change the workspace profile", async () => {
    const db = database();
    db.spaceMember.findUnique.mockResolvedValue({ role: "member", space: { deletingAt: null } });

    await expect(
      updateSpaceProfileForMember(db.prisma, {
        spaceId: "space-1",
        userId: "user-1",
        name: "Support",
      }),
    ).rejects.toBeInstanceOf(CannotConfigureSpaceAsNonOwnerError);
    expect(db.space.update).not.toHaveBeenCalled();
  });

  it("rejects unsupported or oversized avatar data before touching the database", async () => {
    const db = database();
    await expect(
      updateSpaceProfileForMember(db.prisma, {
        spaceId: "space-1",
        userId: "user-1",
        avatarUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      }),
    ).rejects.toBeInstanceOf(InvalidSpaceAvatarError);
    expect(db.spaceMember.findUnique).not.toHaveBeenCalled();
  });
});
