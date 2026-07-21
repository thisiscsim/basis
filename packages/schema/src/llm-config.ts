/**
 * Provider-agnostic LLM configuration, resolved purely from environment
 * variables. Shared by the Electron main process (chat, routing decisions)
 * and the engine scripts (via llm.mjs) so the contract lives in exactly one
 * place. This module reads env only — the AI SDK provider instantiation stays
 * with each consumer.
 *
 *   BASIS_LLM_PROVIDER   openai | anthropic | openai-compatible   (default: openai)
 *   BASIS_LLM_MODEL      model id                                  (default: gpt-5.5)
 *   BASIS_LLM_BASE_URL   override base URL (gateways / local)      (optional)
 *   BASIS_LLM_API_KEY    generic key; falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY
 *   BASIS_REASONING_EFFORT  low | medium | high                    (default: low)
 */

// Keep this package free of @types/node: declare the one global we touch.
// (Only ever called from Node contexts — main process and engine scripts.)
declare const process: { env: Record<string, string | undefined> };

export type Env = Record<string, string | undefined>;

export type LlmProvider = "openai" | "anthropic" | "openai-compatible";
export type ReasoningEffort = "low" | "medium" | "high";

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  baseURL?: string;
  apiKey?: string;
}

export function llmConfig(env: Env = process.env): LlmConfig {
  const raw = (env["BASIS_LLM_PROVIDER"] || "openai").toLowerCase();
  const provider: LlmProvider = raw === "anthropic" || raw === "openai-compatible" ? raw : "openai";
  const model = env["BASIS_LLM_MODEL"] || "gpt-5.5";
  const baseURL = env["BASIS_LLM_BASE_URL"] || undefined;
  // Only accept the generic key or the one matching this provider. A
  // cross-provider fallback would send, e.g., an Anthropic key to
  // api.openai.com (a credential leak + a confusing 401).
  const providerKey =
    provider === "anthropic"
      ? env["ANTHROPIC_API_KEY"]
      : provider === "openai"
        ? env["OPENAI_API_KEY"]
        : undefined; // openai-compatible: only the generic key
  const apiKey = env["BASIS_LLM_API_KEY"] || providerKey;
  return { provider, model, baseURL, apiKey };
}

/** True when LLM features can run. Local/compatible endpoints may need only a baseURL. */
export function isLlmConfigured(env: Env = process.env): boolean {
  const { provider, apiKey, baseURL } = llmConfig(env);
  if (provider === "openai-compatible") return Boolean(baseURL || apiKey);
  return Boolean(apiKey);
}

/** Reasoning effort for OpenAI reasoning models (Settings -> Agent Preferences). */
export function reasoningEffort(env: Env = process.env): ReasoningEffort {
  const v = (env["BASIS_REASONING_EFFORT"] || "low").toLowerCase();
  return v === "medium" || v === "high" ? v : "low";
}
