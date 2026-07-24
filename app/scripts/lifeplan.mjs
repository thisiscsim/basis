// Deterministic life-plan pass: compute the plan core (surplus, debt
// avalanche, goal feasibility, 3-scenario net-worth projection) and write
// lifeplan.json, preserving any LLM steps/narrative from a previous
// lifeplan-llm.mjs run. Projections are assumption math, not predictions.
//
// Usage: node app/scripts/lifeplan.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLifePlan } from "@basis/schema";
import { tsvCell } from "./lib/cli.mjs";
import { ensureDataDir } from "./lib/data-dir.mjs";
import { computeCore } from "./lib/lifeplan-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

async function main() {
  const dir = ensureDataDir(REPO_ROOT);
  phase("computing the plan");
  const { core, existing } = await computeCore(dir, REPO_ROOT);
  progress(80);
  const plan = parseLifePlan({
    ...core,
    model: existing.model,
    steps: existing.steps,
    narrative: existing.narrative,
    playbooksUsed: existing.playbooksUsed,
  });
  fs.writeFileSync(path.join(dir, "lifeplan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  progress(100);
  console.log("DONE lifeplan.json");
}

main().catch((err) => fail(err?.message ?? String(err), err?.message ? 2 : 1));
