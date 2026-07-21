// Idea-log helpers shared by the engine scripts. The log is append-mostly:
// every surfaced brief / gate decision / note lands here and is graded later
// against what actually happened (grade-ideas.mjs).
import fs from "node:fs";
import path from "node:path";
import { parseIdeas } from "@basis/schema";

/** Append one idea to ideas.json (validated, capped, newest first). */
export function appendIdea(dir, idea) {
  const file = path.join(dir, "ideas.json");
  let ideas;
  try {
    ideas = parseIdeas(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    ideas = parseIdeas({});
  }
  if (idea.id && ideas.ideas.some((i) => i.id === idea.id)) return;
  ideas.ideas.unshift({ at: new Date().toISOString(), ...idea });
  ideas.ideas = ideas.ideas.slice(0, 500);
  fs.writeFileSync(file, `${JSON.stringify(parseIdeas(ideas), null, 2)}\n`);
}
