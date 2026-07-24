// Cited life plan: compute the deterministic core, then have the model draft
// 5-10 concrete steps — every step citing playbook principles BY ID. Steps
// with citations that don't resolve are dropped deterministically; the
// numbers may not be contradicted. Falls back to numbers-only when no
// playbooks exist.
//
// Usage: node app/scripts/lifeplan-llm.mjs
// Exit codes: 0 ok, 1 unexpected, 2 domain failure, 3 LLM not configured.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { extractJson, parseLifePlan, parsePlaybook } from "@basis/schema";
import { isLlmConfigured, llmConfig, reasoningEffort, resolveModel } from "./llm.mjs";
import { readJsonMaybe, tsvCell } from "./lib/cli.mjs";
import { ensureDataDir } from "./lib/data-dir.mjs";
import { computeCore, validateSteps } from "./lib/lifeplan-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

function loadPlaybooks(dir) {
  const out = [];
  try {
    for (const file of fs.readdirSync(path.join(dir, "playbooks"))) {
      if (!file.endsWith(".json")) continue;
      try {
        const pb = parsePlaybook(readJsonMaybe(path.join(dir, "playbooks", file)));
        if (pb.principles.length > 0) out.push(pb);
      } catch {
        // skip invalid playbooks
      }
    }
  } catch {
    // no playbooks dir
  }
  return out.slice(0, 10);
}

function buildPrompt({ core, finances, goals, playbooks, retryErrors }) {
  const parts = [
    "You are drafting a personal financial plan for a beginner, grounded in the playbook principles they chose to follow.",
    "Hard rules:",
    "- The DETERMINISTIC NUMBERS below are ground truth. Never contradict them or invent numbers.",
    "- Every step MUST cite at least one playbook principle by its exact playbookId + principleId. Steps with citations that don't resolve will be deleted.",
    "- Steps are concrete actions in their situation ('move the $X surplus to attack the Visa first'), not generic advice.",
    "- No product recommendations, no tax/legal specifics (say 'verify with a professional' where it matters), no market predictions.",
    "",
    "Return ONLY this JSON (no prose, no code fences):",
    "{",
    '  "steps": [ { "title": "<= 10 words", "body": "2-4 sentences, concrete to their numbers", "citations": [{ "playbookId": "...", "principleId": "..." }] } ],',
    '  "narrative": "<3-5 sentence honest overview of where this plan takes them>"',
    "}",
    "",
    "5-10 steps, ordered by impact.",
    "",
    "=== DETERMINISTIC NUMBERS (ground truth) ===",
    JSON.stringify(
      {
        assumptions: core.assumptions,
        surplus: core.surplus,
        debtSchedule: core.debtSchedule,
        debtTotals: core.debtTotals,
        goalFunding: core.goalFunding,
        netWorthFinalYear: core.netWorth[core.netWorth.length - 1],
        warnings: core.warnings,
      },
      null,
      2,
    ),
    "",
    "=== THEIR SITUATION ===",
    JSON.stringify(
      {
        income: finances.income,
        fixedMonthly: finances.fixedMonthly,
        debts: finances.debts,
        assets: finances.assets,
        savingsMonthly: finances.savingsMonthly,
        measuredMonthlySpend: finances.measuredMonthlySpend,
        goals: goals.goals,
      },
      null,
      2,
    ),
  ];
  for (const pb of playbooks) {
    parts.push(
      "",
      `=== PLAYBOOK "${pb.title || pb.id}" (playbookId: ${pb.id}) ===`,
      ...pb.principles.map((p) => `[${p.id}] (${p.topic}) ${p.text} — "${p.quote.slice(0, 200)}"`),
    );
  }
  if (retryErrors) {
    parts.push(
      "",
      "Your previous output was invalid:",
      ...retryErrors.map((e) => `- ${e}`),
      "Return corrected JSON only.",
    );
  }
  return parts.join("\n");
}

async function main() {
  if (!isLlmConfigured()) fail("No model configured.", 3);
  const dir = ensureDataDir(REPO_ROOT);

  phase("computing the plan");
  const { core, finances, goals } = await computeCore(dir, REPO_ROOT);
  progress(30);

  const playbooks = loadPlaybooks(dir);
  if (playbooks.length === 0) {
    // Numbers-only plan; the UI nudges the user to add a playbook.
    const plan = parseLifePlan({ ...core, steps: [], playbooksUsed: [] });
    fs.writeFileSync(path.join(dir, "lifeplan.json"), `${JSON.stringify(plan, null, 2)}\n`);
    console.log("DONE lifeplan.json (numbers only — add a playbook for cited steps)");
    return;
  }

  phase(`drafting steps with ${llmConfig().model}`);
  const model = resolveModel();
  let drafted = null;
  let errors = null;
  for (let attempt = 0; attempt < 2 && !drafted; attempt++) {
    try {
      const { text } = await generateText({
        model,
        prompt: buildPrompt({ core, finances, goals, playbooks, retryErrors: errors }),
        maxOutputTokens: 6000,
        providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
      });
      const data = extractJson(text);
      if (!Array.isArray(data?.steps)) throw new Error("no steps array");
      drafted = data;
    } catch (err) {
      errors = [String(err?.message ?? err)];
    }
  }
  progress(80);

  let steps = [];
  let droppedSteps = 0;
  let narrative;
  if (drafted) {
    const validated = validateSteps(drafted.steps, playbooks);
    steps = validated.steps;
    droppedSteps = validated.droppedSteps;
    narrative = typeof drafted.narrative === "string" ? drafted.narrative.slice(0, 8000) : undefined;
  }

  const plan = parseLifePlan({
    ...core,
    model: llmConfig().model,
    steps,
    narrative,
    playbooksUsed: playbooks.map((pb) => pb.id),
  });
  fs.writeFileSync(path.join(dir, "lifeplan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  progress(100);
  console.log(
    `DONE ${steps.length} step${steps.length === 1 ? "" : "s"}${droppedSteps ? ` (${droppedSteps} dropped: unresolved citations)` : ""}`,
  );
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
