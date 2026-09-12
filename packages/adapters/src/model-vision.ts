import type { Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { resolveDeploymentModel } from "./deployment-model.js";
import { registerLocalProvider } from "./pi-local-provider.js";
import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  registerOpenAiCompatibleCatalog,
} from "./pi-openai-compatible-provider.js";
import { registerOpenCodeGoCatalog } from "./pi-opencode-go-models.js";

/** Computer tools whose results include screenshots for the model. */
export const IMAGE_RETURNING_COMPUTER_TOOLS = new Set([
  "computer_observe",
  "computer_act",
  "open_path",
  "launch_app",
  // Clipboard capture acts on the model-visible computer and must not be
  // exposed to a text-only model that cannot verify which token is copied.
  "capture_secret_from_clipboard",
]);

export const MODEL_CANNOT_SEE_MESSAGE = "This bot's model cannot see; pick a vision-capable model.";

let catalogModelsCache: Models | undefined;

function catalogModels(): Models {
  catalogModelsCache ??= registerOpenCodeGoCatalog(
    registerOpenAiCompatibleCatalog(registerLocalProvider(builtinModels())),
  );
  return catalogModelsCache;
}

/**
 * Mirror Pi's scripted placeholder resolution so vision checks use the same
 * model the runtime will actually call.
 */
export function resolveModelRefForVisionCheck(
  provider: string,
  modelId: string,
): { provider: string; id: string } {
  const normalizedProvider = provider.trim();
  const normalizedId = modelId.trim();
  if (normalizedProvider === "scripted" || normalizedId === "scripted") {
    const deployment = resolveDeploymentModel();
    return {
      provider: deployment.provider,
      id: process.env.PI_DEFAULT_MODEL?.trim() || deployment.model,
    };
  }
  return { provider: normalizedProvider, id: normalizedId };
}

/**
 * Whether the selected model accepts image input, per the Pi model catalog's
 * declared `input` modalities. Unknown models are treated as text-only.
 * The `scripted` placeholder is resolved the same way Pi does (env default /
 * deployment default) before the catalog check.
 */
export function modelAcceptsImageInput(provider: string, modelId: string): boolean {
  const resolved = resolveModelRefForVisionCheck(provider, modelId);
  if (!resolved.provider || !resolved.id) return false;

  const models = catalogModels();
  let model = models.getModel(resolved.provider, resolved.id);
  if (
    !model &&
    resolved.provider !== "openrouter" &&
    resolved.provider !== OPENAI_COMPATIBLE_PROVIDER_ID
  ) {
    model = models.getModel("openrouter", resolved.id);
  }
  return Boolean(model?.input.includes("image"));
}

export function filterImageReturningComputerTools<T extends { name: string }>(
  tools: T[],
  acceptsImages: boolean,
): T[] {
  if (acceptsImages) return tools;
  return tools.filter((tool) => !IMAGE_RETURNING_COMPUTER_TOOLS.has(tool.name));
}
