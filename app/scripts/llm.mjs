// Provider-agnostic LLM resolver. Default is GPT-5.5 via OpenAI; the escape
// hatch lets you point at Anthropic or ANY OpenAI-compatible endpoint
// (self-hosted models via Ollama/vLLM, an enterprise gateway, Azure, etc.)
// purely through environment variables — no code change to rotate models.
// Config resolution lives in @basis/schema (llm-config) so the Electron main
// process and these scripts can never drift.
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { llmConfig } from "@basis/schema";

export { isLlmConfigured, llmConfig, reasoningEffort } from "@basis/schema";

export function resolveModel() {
  const { provider, model, baseURL, apiKey } = llmConfig();
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey, baseURL })(model);
    case "openai-compatible":
      return createOpenAICompatible({ name: "basis-llm", apiKey: apiKey ?? "", baseURL })(model);
    case "openai":
    default:
      return createOpenAI({ apiKey, baseURL })(model);
  }
}
