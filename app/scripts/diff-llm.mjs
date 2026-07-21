// Filing diff: for alerts that are 10-K/10-Q/20-F filings without a summary
// yet, compare the cached document against the prior filing of the same form
// (Risk Factors + MD&A sections) and write a short "what changed and does it
// matter" summary back onto the alert. Diff-first keeps token spend sane: we
// only send the extracted sections, not whole filings.
//
// Usage: node app/scripts/diff-llm.mjs
// Exit codes: 0 ok, 1 unexpected, 2 domain failure, 3 LLM not configured.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { parseAlerts } from "@basis/schema";
import { isLlmConfigured, llmConfig, reasoningEffort, resolveModel } from "./llm.mjs";
import { readJsonMaybe, readMaybe, tsvCell } from "./lib/cli.mjs";
import { ensureDataDir } from "./lib/data-dir.mjs";
import { extractItem, htmlToText, truncate } from "./lib/filings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

const DIFFABLE_FORMS = new Set(["10-K", "10-Q", "20-F"]);
const SECTION_BUDGET = 12_000;
const MAX_DIFFS_PER_RUN = 5; // token-spend cap per run

/** Sections worth diffing, by form. */
const ITEMS_FOR_FORM = {
  "10-K": [
    ["1A", "Risk Factors"],
    ["7", "MD&A"],
  ],
  "20-F": [["3", "Key Information / Risk Factors"]],
  "10-Q": [
    ["1A", "Risk Factors"],
    ["2", "MD&A"],
  ],
};

function loadFilingText(cikDir, indexEntry) {
  const raw = readMaybe(path.join(cikDir, indexEntry.accession, indexEntry.primaryDoc));
  return raw ? htmlToText(raw) : "";
}

function sectionsFor(text, form) {
  const out = [];
  for (const [item, label] of ITEMS_FOR_FORM[form] ?? []) {
    const section = extractItem(text, item);
    if (section) out.push({ label: `Item ${item} (${label})`, text: truncate(section, SECTION_BUDGET) });
  }
  // Fall back to front matter so a formatting-quirky filing still gets a read.
  if (out.length === 0 && text) out.push({ label: "Document (front)", text: truncate(text, SECTION_BUDGET) });
  return out;
}

async function main() {
  if (!isLlmConfigured()) fail("No model configured.", 3);
  const dir = ensureDataDir(REPO_ROOT);

  const alertsFile = path.join(dir, "alerts.json");
  const alerts = parseAlerts(readJsonMaybe(alertsFile));
  const candidates = alerts.alerts
    .filter((a) => DIFFABLE_FORMS.has(a.form) && !a.summary)
    .slice(0, MAX_DIFFS_PER_RUN);
  if (candidates.length === 0) {
    console.log("DONE 0 diffs (nothing pending)");
    return;
  }

  const model = resolveModel();
  let done = 0;
  for (const alert of candidates) {
    phase(`diffing ${alert.ticker} ${alert.form}`);
    try {
      // Locate this filing + the prior same-form filing in the on-disk index.
      const cikDirs = fs.existsSync(path.join(dir, "filings"))
        ? fs.readdirSync(path.join(dir, "filings"))
        : [];
      let current = null;
      let prior = null;
      let cikDir = null;
      for (const cik of cikDirs) {
        const candidateDir = path.join(dir, "filings", cik);
        const index = readJsonMaybe(path.join(candidateDir, "index.json"));
        const hit = index?.filings?.find((f) => f.accession === alert.accession);
        if (hit) {
          cikDir = candidateDir;
          current = hit;
          prior = index.filings.find(
            (f) => f.form === hit.form && f.accession !== hit.accession && f.filedAt <= hit.filedAt,
          );
          break;
        }
      }
      if (!current || !cikDir) continue; // not cached (monitor failed to fetch); skip quietly

      const currentSections = sectionsFor(loadFilingText(cikDir, current), alert.form);
      const priorSections = prior ? sectionsFor(loadFilingText(cikDir, prior), alert.form) : [];
      if (currentSections.length === 0) continue;

      const parts = [
        "You are an analyst flagging what changed in a company's new SEC filing for a beginner investor.",
        priorSections.length > 0
          ? "Compare the NEW filing sections against the PRIOR filing and summarize the material changes: new risk factors, removed ones, shifts in tone or guidance, notable numbers. Say plainly if nothing material changed."
          : "No prior filing is available; summarize the most decision-relevant points of this filing instead.",
        "Rules: only what's in the text below; no advice, no predictions; <= 250 words; plain text.",
        "",
        `Company: ${alert.ticker} — ${alert.form} filed ${alert.filedAt}`,
      ];
      for (const s of currentSections) parts.push("", `=== NEW FILING: ${s.label} ===`, s.text);
      for (const s of priorSections)
        parts.push("", `=== PRIOR FILING (${prior.filedAt}): ${s.label} ===`, s.text);

      const { text } = await generateText({
        model,
        prompt: parts.join("\n"),
        maxOutputTokens: 1500,
        providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
      });
      alert.summary = text.trim().slice(0, 8000);
      done++;
    } catch (err) {
      console.error(`ERROR ${alert.ticker} ${alert.form}: ${err?.message ?? err}`);
    }
    progress((done / candidates.length) * 100);
  }

  fs.writeFileSync(alertsFile, `${JSON.stringify(parseAlerts(alerts), null, 2)}\n`);
  console.log(`DONE ${done} diff${done === 1 ? "" : "s"} (model: ${llmConfig().model})`);
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
