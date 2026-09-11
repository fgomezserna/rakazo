CREATE TABLE "chat_group_guests" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "mentionOnly" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_group_guests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_group_guests_groupId_botId_key"
ON "chat_group_guests"("groupId", "botId");

CREATE INDEX "chat_group_guests_botId_idx" ON "chat_group_guests"("botId");

ALTER TABLE "chat_group_guests"
ADD CONSTRAINT "chat_group_guests_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "chat_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_group_guests"
ADD CONSTRAINT "chat_group_guests_botId_fkey"
FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "chat_group_invocations" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "groupThreadId" TEXT NOT NULL,
    "groupMessageId" TEXT NOT NULL,
    "sourceSpaceId" TEXT NOT NULL,
    "targetBotId" TEXT NOT NULL,
    "targetSpaceId" TEXT NOT NULL,
    "targetThreadId" TEXT NOT NULL,
    "targetRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "prompt" TEXT NOT NULL,
    "response" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "chat_group_invocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_group_invocations_targetRunId_key"
ON "chat_group_invocations"("targetRunId");

CREATE UNIQUE INDEX "chat_group_invocations_groupMessageId_targetBotId_key"
ON "chat_group_invocations"("groupMessageId", "targetBotId");

CREATE INDEX "chat_group_invocations_groupId_createdAt_idx"
ON "chat_group_invocations"("groupId", "createdAt");

CREATE INDEX "chat_group_invocations_targetBotId_status_idx"
ON "chat_group_invocations"("targetBotId", "status");

ALTER TABLE "chat_group_invocations"
ADD CONSTRAINT "chat_group_invocations_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "chat_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
