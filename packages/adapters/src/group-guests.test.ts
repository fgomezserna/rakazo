import type { JobPublisher } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { queueGroupGuestInvocation, relayGroupGuestInvocation } from "./group-guests.js";

const actor = { spaceId: "space-host", userId: "user-1" };

function baseThreadTx() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "thread" }]),
    thread: {
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: { nextMessageSeq?: unknown } }) =>
          data.nextMessageSeq ? { nextMessageSeq: 1 } : { nextEventSeq: 1 },
        ),
    },
    message: {
      create: vi.fn().mockResolvedValue({ id: "inbound-message", seq: 0 }),
      update: vi.fn().mockResolvedValue({}),
    },
    run: {
      findUnique: vi.fn().mockResolvedValue({ status: "queued", startedAt: null }),
      create: vi.fn().mockResolvedValue({ id: "guest-run" }),
    },
    task: { create: vi.fn().mockResolvedValue({ id: "task-guest" }) },
    event: { create: vi.fn().mockResolvedValue({ seq: 0 }) },
  };
}

function jobs(enqueue: ReturnType<typeof vi.fn>): JobPublisher {
  return {
    enqueue: enqueue as JobPublisher["enqueue"],
    cancel: vi.fn(),
    close: vi.fn(),
  };
}

describe("shared group bots", () => {
  it("creates the guest run in the invited bot's workspace", async () => {
    const tx = baseThreadTx();
    const invocationCreate = vi.fn().mockResolvedValue({ id: "invocation-1", status: "queued" });
    Object.assign(tx, {
      space: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
      chatGroupInvocation: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: invocationCreate,
      },
      chatGroupGuest: {
        findFirst: vi.fn().mockResolvedValue({
          group: { id: "group-1", name: "Operations", spaceId: "space-host" },
          bot: {
            id: "bot-guest",
            name: "Analyst",
            spaceId: "space-guest",
            thread: { id: "thread-guest" },
          },
        }),
      },
      task: { create: vi.fn().mockResolvedValue({ id: "task-guest" }) },
      message: {
        ...tx.message,
        findFirst: vi.fn().mockResolvedValue({ id: "group-message" }),
      },
    });
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      space: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
      chatGroupInvocation: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    await queueGroupGuestInvocation(
      { prisma, events: { notify } as never, jobs: jobs(enqueue) },
      actor,
      {
        groupId: "group-1",
        groupThreadId: "thread-host",
        groupMessageId: "group-message",
        targetBotId: "bot-guest",
        text: "@Analyst resume el pipeline",
      },
    );

    expect(tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          spaceId: "space-guest",
          botId: "bot-guest",
          threadId: "thread-guest",
        }),
      }),
    );
    expect(tx.run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          spaceId: "space-guest",
          botId: "bot-guest",
          trigger: "bot_message",
        }),
      }),
    );
    expect(invocationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceSpaceId: "space-host",
          targetSpaceId: "space-guest",
          targetRunId: "guest-run",
        }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run.continue", payload: { runId: "guest-run" } }),
    );
    expect(notify).toHaveBeenCalledWith("thread-guest", 0);
  });

  it("relays a completed guest answer once into the host group thread", async () => {
    const tx = baseThreadTx();
    const invocationUpdate = vi.fn().mockResolvedValue({});
    Object.assign(tx, {
      chatGroupInvocation: {
        findUnique: vi.fn().mockResolvedValue({
          id: "invocation-1",
          groupThreadId: "thread-host",
          sourceSpaceId: "space-host",
          targetBotId: "bot-guest",
          targetRunId: "guest-run",
          status: "queued",
          completedAt: null,
          groupMessageId: "group-message",
        }),
        update: invocationUpdate,
      },
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      chatGroupInvocation: {
        findUnique: vi.fn().mockResolvedValue({
          id: "invocation-1",
          groupThreadId: "thread-host",
          sourceSpaceId: "space-host",
          targetBotId: "bot-guest",
          targetRunId: "guest-run",
          status: "queued",
          groupMessageId: "group-message",
        }),
      },
      run: { findUnique: vi.fn().mockResolvedValue({ status: "completed" }) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      relayGroupGuestInvocation(
        { prisma, events: { notify } as never, jobs: jobs(vi.fn()) },
        { id: "guest-run" },
        "Pipeline completado.",
      ),
    ).resolves.toBe(true);

    expect(tx.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: "thread-host",
          role: "bot",
          botId: "bot-guest",
          blocks: [{ kind: "text", text: "Pipeline completado." }],
        }),
      }),
    );
    expect(invocationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "completed", response: "Pipeline completado." }),
      }),
    );
    expect(notify).toHaveBeenCalledWith("thread-host", 0);
  });
});
