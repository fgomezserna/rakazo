-- Make DeepSeek V4.1 Flash the deployment default. Existing choices for other
-- providers remain untouched; OpenCode Go selections are safe to update because
-- the provider identity and credential stay the same.
UPDATE "deployment_settings"
SET "defaultModelProvider" = 'opencode-go',
    "defaultModelId" = 'deepseek-v4.1-flash',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default';

UPDATE "space_model_preferences" AS preference
SET "modelId" = 'deepseek-v4.1-flash',
    "updatedAt" = CURRENT_TIMESTAMP
FROM "user_model_credentials" AS credential
WHERE preference."credentialId" = credential."id"
  AND preference."userId" = credential."userId"
  AND credential."provider" = 'opencode-go';

UPDATE "bots"
SET "modelId" = 'deepseek-v4.1-flash',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "modelProvider" = 'opencode-go'
  AND "modelId" IS NOT NULL;
