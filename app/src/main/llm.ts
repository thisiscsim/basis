import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, streamText } from "ai";
import {
  type Ips,
  isLlmConfigured,
  llmConfig,
  type Portfolio,
  reasoningEffort,
  type Xray,
} from "@basis/schema";

/**
 * In-process LLM access for the interactive surfaces (tutor/coach chat and
 * the friction gate). Batch jobs (briefs, diffs, digests) stay in the spawned
 * engine scripts; this module exists because chat needs token streaming,
 * which the PHASE/PROGRESS line protocol can't carry. Config resolution is
 * shared with the scripts via @basis/schema so the two sides can't drift.
 */

export function resolveModel() {
  const { provider, model, baseURL, apiKey } = llmConfig();
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey, baseURL })(model);
    case "openai-compatible":
      // isLlmConfigured() gates callers; an empty baseURL only occurs unconfigured.
      return createOpenAICompatible({ name: "basis-llm", apiKey: apiKey ?? "", baseURL: baseURL ?? "" })(
        model,
      );
    case "openai":
    default:
      return createOpenAI({ apiKey, baseURL })(model);
  }
}

export function llmInfo(): { provider: string; model: string; configured: boolean } {
  const { provider, model } = llmConfig();
  return { provider, model, configured: isLlmConfigured() };
}

export type ChatMode = "tutor" | "coach";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const BASE_PERSONA = [
  "You are Basis, a patient, plain-spoken investing copilot inside a desktop research app.",
  "You multiply the user's understanding, discipline, and coverage — you are not a prediction machine.",
  "Hard rules:",
  "- You are not a licensed financial advisor. Never give personalized buy/sell/hold instructions; explain the considerations and trade-offs instead.",
  "- No price predictions or market timing calls. Historical/statistical context is fine.",
  "- Be honest about uncertainty and about the boring truth: diversified low-fee index investing is the right default foundation for most people.",
  "- Define jargon in-line the first time you use it. Keep answers tight; go deeper only when asked.",
].join("\n");

export interface CoachContext {
  ips: Ips;
  portfolio: Portfolio;
  xray: Xray | null;
}

export function chatSystemPrompt(mode: ChatMode, ctx: CoachContext | null): string {
  if (mode === "tutor" || !ctx) {
    return `${BASE_PERSONA}\n\nRole right now: tutor. Teach whatever the user asks about investing, markets, and personal finance mechanics, calibrated to a smart beginner.`;
  }
  const holdings = ctx.portfolio.holdings.map((h) => h.ticker).join(", ") || "(none entered)";
  return [
    BASE_PERSONA,
    "",
    "Role right now: behavioral coach. The user wrote an Investment Policy Statement (IPS); your job is to hold them to their own rules.",
    "When they contemplate a trade or a change of plan, quote their own relevant rule back to them verbatim and ask what changed besides the price. Be direct, not preachy.",
    "",
    "=== USER'S IPS ===",
    `Goals: ${ctx.ips.goals || "(not written yet)"}`,
    `Horizon: ${ctx.ips.horizonYears != null ? `${ctx.ips.horizonYears} years` : "(unset)"} | Risk tolerance: ${ctx.ips.riskTolerance ?? "(unset)"}`,
    `Target allocation: ${ctx.ips.targetAllocation.map((a) => `${a.label} ${a.pct}%`).join(", ") || "(unset)"}`,
    "Rules:",
    ...(ctx.ips.rules.length > 0
      ? ctx.ips.rules.map((r, i) => `${i + 1}. ${r}`)
      : ["(none written yet — encourage them to write some)"]),
    "",
    "=== PORTFOLIO ===",
    `Holdings: ${holdings}`,
    ctx.xray
      ? `X-ray: top position ~${ctx.xray.concentration.top1Pct}%, top-5 ~${ctx.xray.concentration.top5Pct}%, largest sector ~${ctx.xray.concentration.sectorMaxPct}%. Warnings: ${ctx.xray.warnings.join(" | ") || "none"}`
      : "X-ray: not run yet.",
  ].join("\n");
}

/**
 * Stream a chat completion, invoking `onDelta` per token chunk. Returns the
 * full response text. Abortable via `signal` (a newer message cancels the
 * in-flight one).
 */
export async function streamChat(opts: {
  mode: ChatMode;
  context: CoachContext | null;
  messages: ChatMessage[];
  signal: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<string> {
  const result = streamText({
    model: resolveModel(),
    system: chatSystemPrompt(opts.mode, opts.context),
    messages: opts.messages,
    maxOutputTokens: 4000,
    abortSignal: opts.signal,
    providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
  });
  let full = "";
  for await (const chunk of result.textStream) {
    full += chunk;
    opts.onDelta(chunk);
  }
  return full;
}

export type GateVerdict = "consistent" | "inconsistent" | "unclear";

export interface GateResult {
  ok: boolean;
  verdict?: GateVerdict;
  argument?: string;
  error?: string;
}

/**
 * The friction gate: given an intended trade, argue from the user's own IPS
 * and return a verdict. Single non-streaming call — the renderer shows it in
 * a blocking dialog before the user proceeds.
 */
export async function evaluateGate(trade: string, ctx: CoachContext): Promise<GateResult> {
  try {
    const { text } = await generateText({
      model: resolveModel(),
      system: chatSystemPrompt("coach", ctx),
      prompt: [
        "The user is about to make this trade:",
        `"${trade}"`,
        "",
        "Evaluate it strictly against their own IPS rules and stated goals (not your opinion of the market).",
        "Respond with:",
        "1. Which of their rules apply, quoted verbatim (or say they have no applicable rule).",
        "2. The strongest argument AGAINST doing this right now, from their own framework.",
        "3. One question they should answer before proceeding.",
        "Keep it under 180 words. Then on the FINAL line, output exactly one of:",
        "VERDICT: consistent",
        "VERDICT: inconsistent",
        "VERDICT: unclear",
      ].join("\n"),
      maxOutputTokens: 1200,
      providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
    });
    const match = text.match(/VERDICT:\s*(consistent|inconsistent|unclear)\s*$/im);
    const verdict = (match?.[1]?.toLowerCase() ?? "unclear") as GateVerdict;
    const argument = text.replace(/VERDICT:\s*(consistent|inconsistent|unclear)\s*$/im, "").trim();
    return { ok: true, verdict, argument };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
