import type { Model, MutableModels, Provider } from "@earendil-works/pi-ai";
import { DEFAULT_OPENCODE_GO_MODEL_ID, OPENCODE_GO_PROVIDER_ID } from "./deployment-model.js";

/**
 * OpenCode Go can publish a model before the static pi-ai catalog catches up.
 * Keep this small adapter overlay local to Rakazo so the provider transport,
 * auth and session handling continue to come from pi-ai.
 */
export const DEEPSEEK_V41_FLASH_MODEL: Model<"openai-completions"> = {
  id: DEFAULT_OPENCODE_GO_MODEL_ID,
  name: "DeepSeek V4.1 Flash",
  api: "openai-completions",
  provider: OPENCODE_GO_PROVIDER_ID,
  baseUrl: "https://opencode.ai/zen/go/v1",
  reasoning: true,
  input: ["text", "image"],
  thinkingLevelMap: {
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    max: "max",
  },
  contextWindow: 1_000_000,
  maxTokens: 384_000,
  cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    maxTokensField: "max_tokens",
    requiresReasoningContentOnAssistantMessages: true,
    thinkingFormat: "deepseek",
  },
};

/** Add the model once, while remaining harmless against older test doubles. */
export function registerOpenCodeGoCatalog(models: MutableModels): MutableModels {
  const registry = models as unknown as {
    getProvider?: (id: string) => Provider | undefined;
    setProvider?: (provider: Provider) => void;
  };
  if (!registry.getProvider || !registry.setProvider) return models;

  const provider = registry.getProvider(OPENCODE_GO_PROVIDER_ID);
  if (!provider || provider.getModels().some((model) => model.id === DEEPSEEK_V41_FLASH_MODEL.id)) {
    return models;
  }

  registry.setProvider({
    ...provider,
    getModels: () => [...provider.getModels(), DEEPSEEK_V41_FLASH_MODEL],
  });
  return models;
}
