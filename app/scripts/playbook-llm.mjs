// Playbook extraction: distill a user-provided source (book/notes; txt, md,
// pdf, epub) into actionable principles, each carrying an exact verbatim
// quote verified against the source chunk — unverified principles are
// dropped, not shown. Big books resume across runs (chunksDone cursor,
// capped chunks per run to keep token spend sane).
//
// Usage: node app/scripts/playbook-llm.mjs --file <name-in-playbooks/sources>
// Exit codes: 0 ok, 1 unexpected, 2 domain failure, 3 LLM not configured.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateText } from "ai";
import { extractJson, parsePlaybook } from "@basis/schema";
import { isLlmConfigured, llmConfig, reasoningEffort, resolveModel } from "./llm.mjs";
import { arg, readJsonMaybe, tsvCell } from "./lib/cli.mjs";
import { ensureDataDir } from "./lib/data-dir.mjs";
import { chunkSource, extractText, SUPPORTED_EXTENSIONS } from "./lib/booktext.mjs";
import { verifyQuote } from "./lib/filings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const phase = (t) => console.log(`PHASE ${tsvCell(t)}`);
const progress = (n) => console.log(`PROGRESS ${Math.round(n)}`);
const fail = (msg, code = 2) => {
  console.error(`ERROR ${msg}`);
  process.exit(code);
};

const MAX_CHUNKS_PER_RUN = 12;
const TOPICS = new Set(["spending", "debt", "saving", "investing", "goals", "income", "psychology", "other"]);

const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "playbook";

function buildPrompt(sourceTitle, chunk, retryError) {
  const parts = [
    `You are distilling actionable personal-finance principles from "${sourceTitle}" for a beginner's financial planning tool.`,
    "Hard rules:",
    "- Use ONLY the excerpt below. Every principle MUST include an exact verbatim quote (<= 2 sentences, copied character-for-character). Principles whose quotes are not exact excerpts will be deleted.",
    '- topic must be one of: "spending", "debt", "saving", "investing", "goals", "income", "psychology", "other".',
    "- A principle is a rule someone can act on ('automate transfers on payday'), not a summary of a story.",
    "- Skip anything that is a specific product recommendation, a legal/tax claim, or predicts market returns.",
    "",
    "Return ONLY this JSON (no prose, no code fences):",
    '{ "principles": [ { "topic": "spending", "text": "<the distilled rule, <= 2 sentences>", "quote": "<verbatim excerpt>" } ] }',
    "",
    "0-6 principles for this excerpt. Fewer is fine; fabricating is not.",
    "",
    `=== EXCERPT (${chunk.location}) ===`,
    chunk.text,
  ];
  if (retryError)
    parts.push("", `Your previous output was invalid: ${retryError}`, "Return corrected JSON only.");
  return parts.join("\n");
}

async function main() {
  if (!isLlmConfigured()) fail("No model configured.", 3);
  const file = arg("file");
  if (!file || path.basename(file) !== file)
    fail("usage: playbook-llm.mjs --file <name-in-playbooks/sources>");
  const dir = ensureDataDir(REPO_ROOT);
  const sourcePath = path.join(dir, "playbooks", "sources", file);
  if (!fs.existsSync(sourcePath)) fail(`source not found: ${file}`);
  if (!SUPPORTED_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
    fail(`unsupported format (use ${SUPPORTED_EXTENSIONS.join("/")})`);
  }

  phase("extracting text");
  const text = await extractText(sourcePath);
  const chunks = chunkSource(text);
  if (chunks.length === 0) fail("the source contains no extractable text");
  progress(5);

  const id = slugify(file);
  const playbookFile = path.join(dir, "playbooks", `${id}.json`);
  let playbook;
  try {
    playbook = parsePlaybook(readJsonMaybe(playbookFile) ?? { id, sourceFile: file, title: file });
  } catch {
    playbook = parsePlaybook({ id, sourceFile: file, title: file });
  }
  playbook.chunksTotal = chunks.length;
  if (playbook.chunksDone >= chunks.length) {
    console.log(`DONE ${id}: already fully extracted (${playbook.principles.length} principles)`);
    return;
  }

  const model = resolveModel();
  const start = playbook.chunksDone;
  const end = Math.min(start + MAX_CHUNKS_PER_RUN, chunks.length);
  const seenText = new Set(playbook.principles.map((p) => p.text.toLowerCase()));
  let added = 0;
  let dropped = 0;

  for (let i = start; i < end; i++) {
    const chunk = chunks[i];
    phase(`distilling ${chunk.location}`);
    let principles = null;
    let retryError = null;
    for (let attempt = 0; attempt < 2 && !principles; attempt++) {
      try {
        const { text: out } = await generateText({
          model,
          prompt: buildPrompt(playbook.title || file, chunk, retryError),
          maxOutputTokens: 3000,
          providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
        });
        const data = extractJson(out);
        if (!Array.isArray(data?.principles)) throw new Error("no principles array");
        principles = data.principles;
      } catch (err) {
        retryError = String(err?.message ?? err);
      }
    }
    for (const p of (principles ?? []).slice(0, 10)) {
      const principleText = String(p?.text ?? "")
        .trim()
        .slice(0, 500);
      const quote = String(p?.quote ?? "")
        .trim()
        .slice(0, 1500);
      if (!principleText || !quote || !verifyQuote(quote, chunk.text)) {
        dropped++;
        continue;
      }
      if (seenText.has(principleText.toLowerCase())) continue; // dedupe repeats across chunks
      if (playbook.principles.length >= 200) break;
      seenText.add(principleText.toLowerCase());
      playbook.principles.push({
        id: `p${playbook.principles.length + 1}-${chunk.index}`,
        topic: TOPICS.has(p?.topic) ? p.topic : "other",
        text: principleText,
        quote,
        location: chunk.location,
        verified: true,
      });
      added++;
    }
    playbook.chunksDone = i + 1;
    progress(5 + ((i + 1 - start) / (end - start)) * 90);
  }

  playbook.droppedPrinciples += dropped;
  playbook.extractedAt = new Date().toISOString();
  playbook.model = llmConfig().model;
  fs.writeFileSync(playbookFile, `${JSON.stringify(parsePlaybook(playbook), null, 2)}\n`);
  const remaining = chunks.length - playbook.chunksDone;
  console.log(
    `DONE ${added} principle${added === 1 ? "" : "s"} added${dropped ? ` (${dropped} dropped by citation check)` : ""}${
      remaining > 0 ? `; ${remaining} part(s) left — run again to continue` : ""
    }`,
  );
}

main().catch((err) => fail(err?.stack ?? String(err), 1));
