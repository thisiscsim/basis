/**
 * Pull the first {...} JSON object out of a model response (handles code
 * fences and surrounding prose). Throws when no JSON object is present or it
 * fails to parse — callers feed the error back to the model for one repair
 * retry.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}
