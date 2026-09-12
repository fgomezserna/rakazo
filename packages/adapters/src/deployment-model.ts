export const DEFAULT_OPENROUTER_MODEL_ID = "openai/gpt-5.6-luna";
export const OPENCODE_GO_PROVIDER_ID = "opencode-go";
export const DEFAULT_OPENCODE_GO_MODEL_ID = "deepseek-v4.1-flash";
export const DEFAULT_DEPLOYMENT_PROVIDER = OPENCODE_GO_PROVIDER_ID;

/**
 * The deployment-wide model default: which provider a run falls back to when no user
 * credential applies, and the key for that provider.
 *
 * Vendor env names and model ids live here, in the adapter layer, not in core.
 */
export function resolveDeploymentModel(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.PI_DEFAULT_PROVIDER?.trim() || DEFAULT_DEPLOYMENT_PROVIDER;
  // A row per provider that ships a deployment key. A third one adds a row here, not a
  // branch at each call site — and an unknown provider gets no key rather than another
  // vendor's, which a ternary on one provider would not give.
  const keys: Record<string, string | undefined> = {
    openrouter: env.OPENROUTER_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    [OPENCODE_GO_PROVIDER_ID]: env.OPENCODE_API_KEY,
  };
  const models: Record<string, string> = {
    openrouter: DEFAULT_OPENROUTER_MODEL_ID,
    anthropic: "claude-sonnet-5",
    [OPENCODE_GO_PROVIDER_ID]: DEFAULT_OPENCODE_GO_MODEL_ID,
  };
  return {
    provider,
    model: env.PI_DEFAULT_MODEL?.trim() || models[provider] || models.openrouter!,
    key: keys[provider],
  };
}
