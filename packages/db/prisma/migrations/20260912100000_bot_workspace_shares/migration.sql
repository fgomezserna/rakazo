CREATE TABLE "bot_workspace_shares" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "targetSpaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "bot_workspace_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_workspace_shares_botId_targetSpaceId_key"
ON "bot_workspace_shares"("botId", "targetSpaceId");

CREATE INDEX "bot_workspace_shares_targetSpaceId_revokedAt_idx"
ON "bot_workspace_shares"("targetSpaceId", "revokedAt");

CREATE INDEX "bot_workspace_shares_botId_revokedAt_idx"
ON "bot_workspace_shares"("botId", "revokedAt");

ALTER TABLE "bot_workspace_shares"
ADD CONSTRAINT "bot_workspace_shares_botId_fkey"
FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bot_workspace_shares"
ADD CONSTRAINT "bot_workspace_shares_targetSpaceId_fkey"
FOREIGN KEY ("targetSpaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
